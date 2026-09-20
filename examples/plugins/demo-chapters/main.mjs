import { createInterface } from 'node:readline';

const entry = {
  ref: 'demo-book',
  title: '插件示例书',
  authors: ['Reader'],
  description: '用于验证外部插件的发现、获取和章节阅读协议。',
};

const methods = {
  validateConfig: () => null,
  browse: () => ({ title: '示例书库', items: [entry] }),
  search: ({ request }) => ({ items: entry.title.includes(request.query) ? [entry] : [] }),
  detail: ({ entryRef }) => {
    if (entryRef !== entry.ref) throw Object.assign(new Error('书籍不存在'), { code: 'RESOURCE_GONE' });
    return entry;
  },
  acquire: ({ request }) => {
    if (request.entryRef !== entry.ref) throw Object.assign(new Error('书籍不存在'), { code: 'RESOURCE_GONE' });
    return { kind: 'chapters', publicationRef: entry.ref };
  },
  getManifest: ({ publicationRef }) => {
    if (publicationRef !== entry.ref) throw Object.assign(new Error('书籍不存在'), { code: 'RESOURCE_GONE' });
    return {
      publicationRef,
      version: '1',
      items: [{ id: 'chapter-one', seq: 0, title: '第一章', kind: 'chapter', mediaType: 'text/plain', ref: 'chapter-one' }],
    };
  },
  readResource: ({ request }) => {
    if (request.publicationRef !== entry.ref || request.ref !== 'chapter-one') {
      throw Object.assign(new Error('章节不存在'), { code: 'RESOURCE_GONE' });
    }
    return { mediaType: 'text/plain; charset=utf-8', text: '第一章\n\n这是通过独立 Node 进程提供的示例章节。' };
  },
};

const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
for await (const line of input) {
  let request;
  try {
    request = JSON.parse(line);
    if (request.method === '$/cancelRequest') continue;
    const method = methods[request.method];
    if (!method) throw Object.assign(new Error('不支持的方法'), { code: 'UNSUPPORTED_OPERATION' });
    const result = await method(request.params);
    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: request.id, result }) + '\n');
  } catch (error) {
    process.stdout.write(JSON.stringify({
      jsonrpc: '2.0', id: request?.id,
      error: { code: error.code ?? 'PLUGIN_ERROR', message: error.message },
    }) + '\n');
  }
}
