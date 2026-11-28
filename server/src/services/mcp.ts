import { randomUUID } from 'node:crypto';
import type { AppContext } from '../http/context.ts';
import type { AssetPayload, ContentItem, Manifest } from '../indexer/formats/index.ts';
import { FilePublications } from '../publications/files.ts';
import { BookViewModes } from './book-view-modes.ts';
import { BookReviewService } from './book-reviews.ts';
import { NotesLibraryService } from './notes-library.ts';
import { ReadingOverrideService } from './reading-overrides.ts';
import { correctedSearchText, htmlSearchText, plainSearchText, searchBookPage } from './book-search.ts';
import { AiCompanionService, COMPANION_ENTITY_CATEGORIES, type CompanionEntityCategory } from './ai-companion.ts';
import { LibraryFtsService } from './library-fts.ts';
import { BusinessSettingsReader } from './business-settings.ts';
import type { ReadingState } from './shelf.ts';
import type { McpPrincipal } from './mcp-credentials.ts';
import { AppError, badRequest, forbidden } from '../lib/errors.ts';

export const MCP_PROTOCOL_VERSION = '2025-03-26';
const DEFAULT_PASSAGE_LIMIT = 4000;
const MAX_PASSAGE_LIMIT = 12_000;
const MAX_TOC_LIMIT = 200;

export interface JsonRpcRequest {
  jsonrpc: '2.0';
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
}

export interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: string | number | null;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

interface McpToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  write?: boolean;
}

const TOOLS: readonly McpToolDef[] = [
  {
    name: 'search_books',
    description: '按书名、作者、标签或阅读状态筛选个人书架中的书籍，返回精简元数据与阅读进度。',
    inputSchema: {
      type: 'object',
      properties: {
        search: { type: 'string', description: '书名或作者关键词' },
        author: { type: 'string', description: '按作者筛选' },
        tag: { type: 'string', description: '按标签筛选' },
        status: { type: 'string', enum: ['reading', 'want', 'finished'], description: '阅读状态筛选' },
        page: { type: 'integer', minimum: 1, default: 1 },
        pageSize: { type: 'integer', minimum: 1, maximum: 50, default: 20 },
      },
    },
  },
  {
    name: 'get_book_detail',
    description: '获取单本书的详细信息、当前阅读进度与个人书评。',
    inputSchema: {
      type: 'object',
      required: ['bookId'],
      properties: {
        bookId: { type: 'string', description: '书籍 ID' },
      },
    },
  },
  {
    name: 'get_book_toc',
    description: '获取书籍目录（章节序号与标题），支持分页浏览大部头或长篇网文。',
    inputSchema: {
      type: 'object',
      required: ['bookId'],
      properties: {
        bookId: { type: 'string', description: '书籍 ID' },
        offset: { type: 'integer', minimum: 0, default: 0 },
        limit: { type: 'integer', minimum: 1, maximum: MAX_TOC_LIMIT, default: 100 },
      },
    },
  },
  {
    name: 'read_passage',
    description: '按章节序号与字符偏移分片读取书籍正文。可开启 respectProgress 防止读取超出当前阅读进度的未读章节。',
    inputSchema: {
      type: 'object',
      required: ['bookId', 'sectionIndex'],
      properties: {
        bookId: { type: 'string', description: '书籍 ID' },
        sectionIndex: { type: 'integer', minimum: 0, description: '0 起始的章节序号（来自 get_book_toc）' },
        offset: { type: 'integer', minimum: 0, default: 0, description: '章内字符偏移量' },
        limit: {
          type: 'integer',
          minimum: 100,
          maximum: MAX_PASSAGE_LIMIT,
          default: DEFAULT_PASSAGE_LIMIT,
          description: '单次最多返回的字符数',
        },
        respectProgress: {
          type: 'boolean',
          default: false,
          description: '为 true 时拒绝读取超出当前阅读进度的章节（防剧透）',
        },
      },
    },
  },
  {
    name: 'search_book_content',
    description: '在单本书的正文中检索关键词，返回命中章节与上下文摘录。可开启 respectProgress 仅检索已读章节。',
    inputSchema: {
      type: 'object',
      required: ['bookId', 'query'],
      properties: {
        bookId: { type: 'string', description: '书籍 ID' },
        query: { type: 'string', minLength: 1, maxLength: 200, description: '搜索关键词' },
        cursor: { type: 'string', description: '上一页返回的 nextCursor' },
        respectProgress: {
          type: 'boolean',
          default: false,
          description: '为 true 时只搜索用户已读到的章节（防剧透）',
        },
      },
    },
  },
  {
    name: 'get_notes',
    description: '按书籍、关键词、类型或标签查询读书笔记、高亮划线和书签。',
    inputSchema: {
      type: 'object',
      properties: {
        bookId: { type: 'string', description: '可选，限定某本书' },
        q: { type: 'string', description: '可选，搜索正文/批注/书名关键词' },
        type: { type: 'string', enum: ['note', 'highlight', 'bookmark'], description: '笔记类型' },
        tag: { type: 'string', description: '按标签筛选' },
        page: { type: 'integer', minimum: 1, default: 1 },
        pageSize: { type: 'integer', minimum: 1, maximum: 100, default: 30 },
      },
    },
  },
  {
    name: 'export_notes_markdown',
    description: '将匹配条件的划线、批注与书评导出为结构化 Markdown 文档（适合归档到 Obsidian/Logseq）。',
    inputSchema: {
      type: 'object',
      properties: {
        bookId: { type: 'string', description: '可选，限定某本书' },
        q: { type: 'string', description: '可选关键词过滤' },
        tag: { type: 'string', description: '可选标签过滤' },
      },
    },
  },
  {
    name: 'search_library_content',
    description: '基于 SQLite FTS5 懒索引跨书库全文检索正文段落，支持指定书籍集合与 respectProgress 防剧透边界。',
    inputSchema: {
      type: 'object',
      required: ['query'],
      properties: {
        query: { type: 'string', minLength: 1, maxLength: 200, description: '搜索关键词' },
        bookIds: { type: 'array', items: { type: 'string' }, maxItems: 50, description: '可选，限定搜索的书籍 ID 列表' },
        limit: { type: 'integer', minimum: 1, maximum: 50, default: 20 },
        autoIndex: { type: 'boolean', default: true, description: '是否自动为尚未建索引的书架书籍懒建 FTS5 索引' },
        respectProgress: {
          type: 'boolean',
          default: false,
          description: '为 true 时仅返回各本书已读进度之前的命中结果（防剧透）',
        },
      },
    },
  },
  {
    name: 'get_spoiler_free_companion',
    description: '获取指定书籍截至用户当前阅读进度的已缓存防剧透摘要、人物关系图谱与未解伏笔。',
    inputSchema: {
      type: 'object',
      required: ['bookId'],
      properties: {
        bookId: { type: 'string', description: '书籍 ID' },
      },
    },
  },
  {
    name: 'lookup_book_glossary',
    description: '防剧透书内词典检索：按名称/别名/分类（人物、物品、地点、势力、术语）查询截至用户当前进度的设定与演变轨迹（零额外 LLM 开销）。',
    inputSchema: {
      type: 'object',
      required: ['bookId'],
      properties: {
        bookId: { type: 'string', description: '书籍 ID' },
        query: { type: 'string', description: '可选，按名称、别名或说明搜索' },
        category: {
          type: 'string',
          enum: ['character', 'item', 'place', 'organization', 'term'],
          description: '可选，按词条分类筛选',
        },
      },
    },
  },
  {
    name: 'append_note',
    description: '为指定书籍新增一条读书笔记或划线批注，并自动进入多端同步队列（需要 write 权限凭据）。',
    write: true,
    inputSchema: {
      type: 'object',
      required: ['bookId', 'comment'],
      properties: {
        bookId: { type: 'string', description: '书籍 ID' },
        type: { type: 'string', enum: ['note', 'highlight'], default: 'note' },
        text: { type: 'string', description: '可选，原书摘录文字' },
        comment: { type: 'string', minLength: 1, description: '笔记或批注内容' },
        chapterTitle: { type: 'string', description: '可选，章节标题' },
        locator: { type: 'string', description: '可选，定位锚点（r1: 或 rt1:）' },
        color: { type: 'string', description: '可选，高亮颜色' },
        tags: { type: 'array', items: { type: 'string' }, maxItems: 10, description: '可选标签列表' },
      },
    },
  },
];

/**
 * Extracts a section identifier from a client locator (`r1:`, `rt1:`, legacy `section:offset`,
 * or bare section id) and maps it onto the book's ordered manifest items.
 *
 * Shared by MCP spoiler protection and Step 2 spoiler-free AI companion.
 */
export function resolveProgressSectionIndex(
  locator: string,
  percentage: number,
  items: readonly ContentItem[],
): number | null {
  if (!items.length) return null;
  const matchSection = (sectionId: string): number => {
    const clean = sectionId.replace(/^xhtml:/, '');
    return items.findIndex(
      (item) =>
        item.href === sectionId ||
        item.id === sectionId ||
        item.href.replace(/^xhtml:/, '') === clean ||
        item.id.replace(/^xhtml:/, '') === clean,
    );
  };

  if (locator) {
    if (locator.startsWith('r1:')) {
      const rest = locator.slice(3);
      const sep = rest.indexOf(':');
      if (sep !== -1) {
        const idx = matchSection(rest.slice(sep + 1));
        if (idx >= 0) return idx;
      }
    } else if (locator.startsWith('rt1:')) {
      try {
        const parsed = JSON.parse(locator.slice(4)) as { sectionId?: unknown };
        if (typeof parsed.sectionId === 'string') {
          const idx = matchSection(parsed.sectionId);
          if (idx >= 0) return idx;
        }
      } catch {
        // Fall through to percentage fallback.
      }
    } else {
      const exact = matchSection(locator);
      if (exact >= 0) return exact;
      const legacy = /^([^:]+):(-?[\d.]+)$/.exec(locator);
      if (legacy) {
        const idx = matchSection(legacy[1]!);
        if (idx >= 0) return idx;
      }
      const page = Number.parseInt(locator, 10);
      if (Number.isSafeInteger(page) && page >= 0 && page < items.length) return page;
    }
  }

  if (Number.isFinite(percentage) && percentage > 0) {
    return Math.min(items.length - 1, Math.max(0, Math.floor(percentage * items.length)));
  }
  return null;
}

export class McpService {
  private readonly notes: NotesLibraryService;
  private readonly reviews: BookReviewService;

  constructor(private readonly ctx: AppContext) {
    this.notes = new NotesLibraryService(ctx.db, ctx.shelf);
    this.reviews = new BookReviewService(ctx.db);
  }

  async handle(principal: McpPrincipal, request: JsonRpcRequest, signal: AbortSignal): Promise<JsonRpcResponse | null> {
    const id = request.id ?? null;
    const isNotification = request.id === undefined;

    if (request.jsonrpc !== '2.0' || typeof request.method !== 'string') {
      return { jsonrpc: '2.0', id, error: { code: -32600, message: 'Invalid JSON-RPC request' } };
    }

    if (request.method === 'notifications/initialized' || request.method === 'notifications/cancelled') {
      return null;
    }

    try {
      const result = await this.dispatch(principal, request.method, request.params ?? {}, signal);
      return isNotification ? null : { jsonrpc: '2.0', id, result };
    } catch (error) {
      if (isNotification) return null;
      if (error instanceof JsonRpcMethodError) {
        return { jsonrpc: '2.0', id, error: { code: error.code, message: error.message } };
      }
      const message = error instanceof Error ? error.message : 'Internal error';
      const code = error instanceof AppError && error.statusCode === 400 ? -32602 : -32603;
      return { jsonrpc: '2.0', id, error: { code, message } };
    }
  }

  private async dispatch(
    principal: McpPrincipal,
    method: string,
    params: Record<string, unknown>,
    signal: AbortSignal,
  ): Promise<unknown> {
    switch (method) {
      case 'initialize':
        return {
          protocolVersion: MCP_PROTOCOL_VERSION,
          capabilities: {
            tools: { listChanged: false },
            resources: { subscribe: false, listChanged: false },
            prompts: { listChanged: false },
          },
          serverInfo: { name: 'reader-pro', version: '0.1.0' },
        };
      case 'ping':
        return {};
      case 'resources/list':
        return {
          resources: [
            {
              uri: 'reader://library/recent',
              name: 'Recent Reading & Notes',
              description: '当前在读书单、阅读进度以及最近 20 条读书笔记。',
              mimeType: 'application/json',
            },
          ],
        };
      case 'resources/read':
        return this.readResource(principal.userId, String(params.uri ?? ''));
      case 'prompts/list':
        return {
          prompts: [
            {
              name: 'review_book_notes',
              description: '将指定书籍的划线、批注与书评整理成带引用的结构化 Markdown 读书笔记。',
              arguments: [{ name: 'bookId', description: '书籍 ID', required: true }],
            },
          ],
        };
      case 'prompts/get':
        return this.getPrompt(principal.userId, String(params.name ?? ''), (params.arguments ?? {}) as Record<string, unknown>);
      case 'tools/list':
        return {
          tools: TOOLS.filter((tool) => !tool.write || principal.scope === 'write').map(
            ({ name, description, inputSchema }) => ({ name, description, inputSchema }),
          ),
        };
      case 'tools/call':
        return this.callTool(
          principal,
          String(params.name ?? ''),
          (params.arguments ?? {}) as Record<string, unknown>,
          signal,
        );
      default:
        throw new JsonRpcMethodError(-32601, `Method not found: ${method}`);
    }
  }

  private readResource(userId: string, uri: string) {
    if (uri !== 'reader://library/recent') {
      throw new JsonRpcMethodError(-32602, `Unknown resource URI: ${uri}`);
    }
    const recentBooks = this.ctx.sync.recentlyRead(userId, 15).map((item) => ({
      bookId: item.id,
      title: item.title,
      author: item.author,
      format: item.format,
      percentage: item.percentage,
      chapterTitle: item.chapterTitle,
      lastReadAt: item.lastReadAt,
    }));
    const recentNotes = this.notes.list(userId, { page: 1, pageSize: 20 }).items;
    return {
      contents: [
        {
          uri,
          mimeType: 'application/json',
          text: JSON.stringify({ recentBooks, recentNotes }, null, 2),
        },
      ],
    };
  }

  private getPrompt(userId: string, name: string, args: Record<string, unknown>) {
    if (name !== 'review_book_notes') {
      throw new JsonRpcMethodError(-32602, `Unknown prompt: ${name}`);
    }
    const bookId = requireString(args.bookId, 'bookId');
    const book = this.ctx.shelf.getVisible(userId, bookId);
    const exported = this.notes.export(userId, { bookId, format: 'markdown' });
    return {
      description: `整理《${book.title}》的读书笔记`,
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: [
              `请帮我将《${book.title}》${book.author ? `（作者：${book.author}）` : ''}的划线、批注与书评整理成一份结构清晰、保留原书关键引用的 Markdown 读书笔记。`,
              '',
              exported.content || '（当前该书暂无笔记与书评）',
            ].join('\n'),
          },
        },
      ],
    };
  }

  private async callTool(
    principal: McpPrincipal,
    name: string,
    args: Record<string, unknown>,
    signal: AbortSignal,
  ): Promise<{ content: Array<{ type: 'text'; text: string }>; isError?: boolean }> {
    const def = TOOLS.find((t) => t.name === name);
    if (!def) throw new JsonRpcMethodError(-32602, `Unknown tool: ${name}`);
    if (def.write && principal.scope !== 'write') {
      return toolError('当前 MCP 凭据为只读权限（read），无法执行写入操作；请创建 write 权限凭据。');
    }

    try {
      const payload = await this.executeTool(principal.userId, name, args, signal);
      return {
        content: [
          {
            type: 'text',
            text: typeof payload === 'string' ? payload : JSON.stringify(payload, null, 2),
          },
        ],
      };
    } catch (error) {
      if (error instanceof AppError) {
        return toolError(`${error.code}: ${error.message}`);
      }
      return toolError(error instanceof Error ? error.message : 'Tool execution failed');
    }
  }

  private async executeTool(
    userId: string,
    name: string,
    args: Record<string, unknown>,
    signal: AbortSignal,
  ): Promise<unknown> {
    switch (name) {
      case 'search_books': {
        const page = clampInt(args.page, 1, 1, 10000);
        const pageSize = clampInt(args.pageSize, 20, 1, 50);
        const result = this.ctx.shelf.list(userId, {
          ...(typeof args.search === 'string' && args.search.trim() ? { search: args.search.trim() } : {}),
          ...(typeof args.author === 'string' && args.author.trim() ? { author: args.author.trim() } : {}),
          ...(typeof args.tag === 'string' && args.tag.trim() ? { tag: args.tag.trim() } : {}),
          ...(typeof args.status === 'string' && args.status ? { status: args.status as ReadingState } : {}),
          page,
          pageSize,
        });
        return {
          total: result.total,
          page: result.page,
          pageSize: result.pageSize,
          items: result.items.map((book) => {
            const progress = this.ctx.sync.progressFor(userId, book.id);
            return {
              bookId: book.id,
              title: book.title,
              author: book.author,
              format: book.format,
              series: book.series || undefined,
              tags: book.tags,
              readingState: book.readingState ?? undefined,
              percentage: progress?.percentage ?? 0,
              chapterTitle: progress?.chapterTitle || undefined,
            };
          }),
        };
      }

      case 'get_book_detail': {
        const bookId = requireString(args.bookId, 'bookId');
        const book = this.ctx.shelf.getVisible(userId, bookId);
        const progress = this.ctx.sync.progressFor(userId, bookId);
        const review = this.reviews.get(userId, bookId);
        return {
          book: {
            bookId: book.id,
            title: book.title,
            author: book.author,
            publisher: book.publisher,
            language: book.language,
            description: book.description,
            series: book.series,
            seriesIndex: book.seriesIndex,
            tags: book.tags,
            format: book.format,
            pageCount: book.pageCount,
          },
          progress,
          review: review?.body ?? null,
        };
      }

      case 'get_book_toc': {
        const bookId = requireString(args.bookId, 'bookId');
        const offset = clampInt(args.offset, 0, 0, 1_000_000);
        const limit = clampInt(args.limit, 100, 1, MAX_TOC_LIMIT);
        const { book, manifest } = await this.loadManifest(userId, bookId);
        const progress = this.ctx.sync.progressFor(userId, bookId);
        const currentSectionIndex = progress
          ? resolveProgressSectionIndex(progress.locator, progress.percentage, manifest.items)
          : null;
        return {
          bookId,
          title: book.title,
          total: manifest.items.length,
          offset,
          limit,
          currentSectionIndex,
          items: manifest.items.slice(offset, offset + limit).map((item, idx) => ({
            sectionIndex: offset + idx,
            title: item.title,
            href: item.href,
            ...(item.volume ? { volume: item.volume } : {}),
          })),
        };
      }

      case 'read_passage': {
        const bookId = requireString(args.bookId, 'bookId');
        const sectionIndex = requireInt(args.sectionIndex, 'sectionIndex', 0, 1_000_000);
        const offset = clampInt(args.offset, 0, 0, 10_000_000);
        const limit = clampInt(args.limit, DEFAULT_PASSAGE_LIMIT, 100, MAX_PASSAGE_LIMIT);
        const respectProgress = args.respectProgress === true;

        const { book, manifest } = await this.loadManifest(userId, bookId);
        if (!['text', 'reflowable'].includes(manifest.kind)) {
          throw badRequest('此格式暂不支持纯文本读取', 'UNSUPPORTED_FORMAT');
        }
        if (sectionIndex >= manifest.items.length) {
          throw badRequest(`章节序号超出范围（总章节数 ${manifest.items.length}）`);
        }

        if (respectProgress) {
          const maxIndex = this.requireProgressCap(userId, bookId, manifest);
          if (sectionIndex > maxIndex) {
            throw forbidden(
              `防剧透保护已开启：当前阅读进度位于第 ${maxIndex + 1} 章（sectionIndex=${maxIndex}），禁止读取第 ${sectionIndex + 1} 章。`,
              'SPOILER_GUARD',
            );
          }
        }

        const item = manifest.items[sectionIndex]!;
        const overrides = new ReadingOverrideService(this.ctx.db).get(userId, bookId);
        const text = await this.loadSectionText(userId, bookId, book.format, item, overrides);
        const slice = text.slice(offset, offset + limit);
        const nextOffset = offset + slice.length;
        return {
          bookId,
          title: book.title,
          sectionIndex,
          chapterTitle: item.title,
          totalLength: text.length,
          offset,
          nextOffset: nextOffset < text.length ? nextOffset : null,
          hasMore: nextOffset < text.length,
          text: slice,
        };
      }

      case 'search_book_content': {
        const bookId = requireString(args.bookId, 'bookId');
        const query = requireString(args.query, 'query');
        const cursor = typeof args.cursor === 'string' && args.cursor ? args.cursor : undefined;
        const respectProgress = args.respectProgress === true;

        const { book, manifest } = await this.loadManifest(userId, bookId);
        if (!['text', 'reflowable'].includes(manifest.kind)) {
          throw badRequest('此格式暂不支持正文搜索', 'UNSUPPORTED_FORMAT');
        }

        let effectiveManifest = manifest;
        let maxSectionIndex: number | null = null;
        if (respectProgress) {
          maxSectionIndex = this.requireProgressCap(userId, bookId, manifest);
          effectiveManifest = {
            ...manifest,
            items: manifest.items.slice(0, maxSectionIndex + 1),
            total: maxSectionIndex + 1,
          };
        }

        const overrides = new ReadingOverrideService(this.ctx.db).get(userId, bookId);
        const isChapters = this.ctx.sources?.chapters.has(bookId) ?? false;
        const files = new FilePublications(this.ctx.db, this.ctx.config);
        const handler = isChapters ? null : files.handler(book.format);

        const result = await searchBookPage(
          effectiveManifest,
          query,
          cursor,
          overrides,
          async (item) => {
            if (isChapters) return this.loadCachedChapterPayload(bookId, item);
            if (!handler) throw badRequest('此格式暂不支持正文搜索', 'UNSUPPORTED_FORMAT');
            const ref =
              item.resourceRef ??
              (item.format === 'html' && item.href.startsWith('chapter:')
                ? item.href.replace('chapter:', 'chapter-full:')
                : item.href);
            return handler.asset({ ...files.context(bookId), bookId }, { ref });
          },
          signal,
          8,
        );

        const sectionIndexByHref = new Map(effectiveManifest.items.map((item, idx) => [item.href, idx]));
        return {
          bookId,
          title: book.title,
          ...(maxSectionIndex !== null ? { maxSectionIndex } : {}),
          scanned: result.scanned,
          total: result.total,
          limited: result.limited,
          nextCursor: result.nextCursor ?? null,
          hits: result.hits.map((hit) => ({
            sectionIndex: sectionIndexByHref.get(hit.anchor.sectionId) ?? null,
            title: hit.title,
            excerpt: hit.excerpt,
            start: hit.anchor.start,
          })),
        };
      }

      case 'get_notes': {
        return this.notes.list(userId, {
          ...(typeof args.bookId === 'string' && args.bookId ? { bookId: args.bookId } : {}),
          ...(typeof args.q === 'string' && args.q ? { q: args.q } : {}),
          ...(typeof args.type === 'string' && args.type ? { type: args.type } : {}),
          ...(typeof args.tag === 'string' && args.tag ? { tag: args.tag } : {}),
          page: clampInt(args.page, 1, 1, 10000),
          pageSize: clampInt(args.pageSize, 30, 1, 100),
        });
      }

      case 'export_notes_markdown': {
        const exported = this.notes.export(userId, {
          ...(typeof args.bookId === 'string' && args.bookId ? { bookId: args.bookId } : {}),
          ...(typeof args.q === 'string' && args.q ? { q: args.q } : {}),
          ...(typeof args.tag === 'string' && args.tag ? { tag: args.tag } : {}),
          format: 'markdown',
        });
        return {
          filename: exported.filename,
          noteCount: exported.count,
          reviewCount: exported.reviews,
          markdown: exported.content,
        };
      }

      case 'search_library_content': {
        const query = requireString(args.query, 'query');
        const bookIds = Array.isArray(args.bookIds)
          ? args.bookIds.filter((id): id is string => typeof id === 'string' && !!id.trim())
          : undefined;
        const fts = new LibraryFtsService(this.ctx);
        return fts.search(userId, query, {
          ...(bookIds?.length ? { bookIds } : {}),
          limit: clampInt(args.limit, 20, 1, 50),
          autoIndex: args.autoIndex !== false,
          respectProgress: args.respectProgress === true,
        });
      }

      case 'get_spoiler_free_companion': {
        const bookId = requireString(args.bookId, 'bookId');
        const companion = new AiCompanionService(this.ctx, () => new BusinessSettingsReader(this.ctx.db).read('ai'));
        return companion.readCachedSnapshot(userId, bookId);
      }

      case 'lookup_book_glossary': {
        const bookId = requireString(args.bookId, 'bookId');
        const rawCategory = typeof args.category === 'string' ? args.category.trim() : '';
        if (rawCategory && !(COMPANION_ENTITY_CATEGORIES as readonly string[]).includes(rawCategory)) {
          throw badRequest('无效的词典分类');
        }
        const companion = new AiCompanionService(this.ctx, () => new BusinessSettingsReader(this.ctx.db).read('ai'));
        return companion.lookupGlossary(userId, bookId, {
          ...(typeof args.query === 'string' && args.query.trim() ? { query: args.query.trim() } : {}),
          ...(rawCategory ? { category: rawCategory as CompanionEntityCategory } : {}),
        });
      }

      case 'append_note': {
        const bookId = requireString(args.bookId, 'bookId');
        const comment = requireString(args.comment, 'comment');
        const type = args.type === 'highlight' ? 'highlight' : 'note';
        const text = typeof args.text === 'string' ? args.text.trim() : '';
        const chapterTitle = typeof args.chapterTitle === 'string' ? args.chapterTitle.trim() : '';
        const locator = typeof args.locator === 'string' ? args.locator.trim() : '';
        const color = typeof args.color === 'string' ? args.color.trim() : '';
        const tags = Array.isArray(args.tags) ? args.tags.filter((t): t is string => typeof t === 'string') : [];

        // Ensure the user can see this book before attaching a note to it.
        const book = this.ctx.shelf.getVisible(userId, bookId);
        const id = randomUUID();
        const updatedAt = Date.now();
        const result = this.ctx.sync.push(userId, {
          notes: [
            {
              id,
              bookId,
              type,
              locator,
              text,
              comment,
              color,
              ...(chapterTitle ? { chapterTitle } : {}),
              ...(tags.length ? { tags } : {}),
              updatedAt,
              deleted: false,
            },
          ],
        });
        if (result.accepted !== 1) {
          throw badRequest('笔记写入被拒绝，请检查参数');
        }
        return { id, bookId, bookTitle: book.title, type, updatedAt, synced: true };
      }

      default:
        throw new JsonRpcMethodError(-32602, `Unknown tool: ${name}`);
    }
  }

  private async loadManifest(userId: string, bookId: string) {
    const book = this.ctx.shelf.getVisible(userId, bookId);
    let manifest: Manifest | null = null;
    if (this.ctx.sources?.chapters.has(bookId)) {
      manifest = this.ctx.sources.chapters.manifest(userId, bookId);
    } else {
      const files = new FilePublications(this.ctx.db, this.ctx.config);
      const handler = files.handler(book.format);
      if (handler) {
        const base = { ...files.context(bookId), bookId };
        const context =
          book.format === 'pdf'
            ? { ...base, variant: new BookViewModes(this.ctx.db).get(userId, bookId).pdfMode }
            : base;
        manifest = await handler.manifest(context);
      }
    }
    if (!manifest) throw badRequest(`格式 ${book.format} 暂不支持章节读取`, 'UNSUPPORTED_FORMAT');
    return { book, manifest };
  }

  private requireProgressCap(userId: string, bookId: string, manifest: Manifest): number {
    const progress = this.ctx.sync.progressFor(userId, bookId);
    if (!progress) {
      throw forbidden('防剧透保护已开启：尚未记录该书的阅读进度，请先在阅读器中打开阅读。', 'SPOILER_GUARD');
    }
    const maxIndex = resolveProgressSectionIndex(progress.locator, progress.percentage, manifest.items);
    if (maxIndex === null) {
      throw forbidden('防剧透保护已开启：无法解析当前阅读进度对应的章节位置。', 'SPOILER_GUARD');
    }
    return maxIndex;
  }

  private async loadSectionText(
    userId: string,
    bookId: string,
    format: string,
    item: ContentItem,
    overrides: ReturnType<ReadingOverrideService['get']>,
  ): Promise<string> {
    const isChapters = this.ctx.sources?.chapters.has(bookId) ?? false;
    let payload: AssetPayload | undefined;
    try {
      if (isChapters) {
        payload = this.loadCachedChapterPayload(bookId, item);
      } else {
        const files = new FilePublications(this.ctx.db, this.ctx.config);
        const handler = files.handler(format);
        if (!handler) throw badRequest(`格式 ${format} 暂不支持正文读取`, 'UNSUPPORTED_FORMAT');
        const ref =
          item.resourceRef ??
          (item.format === 'html' && item.href.startsWith('chapter:')
            ? item.href.replace('chapter:', 'chapter-full:')
            : item.href);
        payload = await handler.asset({ ...files.context(bookId), bookId }, { ref });
      }
      if (!payload.data || payload.data.length > 8 * 1024 * 1024) {
        throw badRequest('章节内容过大或不可用', 'CHAPTER_UNAVAILABLE');
      }
      const raw = payload.data.toString('utf8');
      return correctedSearchText(
        /html|xml/i.test(payload.contentType) ? htmlSearchText(raw) : plainSearchText(raw),
        item.href,
        overrides,
      );
    } finally {
      payload?.stream?.destroy();
    }
  }

  /**
   * Reads only locally cached chapter text for remote chapter publications so an
   * autonomous MCP agent can never trigger upstream scraping traffic.
   */
  private loadCachedChapterPayload(bookId: string, item: ContentItem): AssetPayload {
    const ref = item.resourceRef ?? '';
    const match = /^chapter-resource:([^:]+):([^:]+)$/.exec(ref);
    if (!match) throw badRequest('该章节尚未缓存到本地，请先在阅读器中打开', 'CHAPTER_NOT_CACHED');
    const row = this.ctx.db.get<{ media_type: string; body: string | null }>(
      'SELECT media_type, body FROM chapter_resources WHERE book_id = ? AND revision = ? AND chapter_id = ?',
      bookId,
      match[1]!,
      match[2]!,
    );
    if (!row || row.body === null) {
      throw badRequest('该章节尚未缓存到本地，请先在阅读器中打开', 'CHAPTER_NOT_CACHED');
    }
    return {
      data: Buffer.from(row.body, 'utf8'),
      contentType: row.media_type || 'text/plain; charset=utf-8',
    };
  }
}

class JsonRpcMethodError extends Error {
  constructor(
    readonly code: number,
    message: string,
  ) {
    super(message);
  }
}

function toolError(text: string) {
  return { content: [{ type: 'text' as const, text }], isError: true };
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) throw badRequest(`${field} is required`);
  return value.trim();
}

function requireInt(value: unknown, field: string, min: number, max: number): number {
  const num = typeof value === 'number' ? value : Number.parseInt(String(value ?? ''), 10);
  if (!Number.isSafeInteger(num) || num < min || num > max) {
    throw badRequest(`${field} must be an integer between ${min} and ${max}`);
  }
  return num;
}

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  if (value === undefined || value === null || value === '') return fallback;
  const num = typeof value === 'number' ? value : Number.parseInt(String(value), 10);
  if (!Number.isFinite(num)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(num)));
}
