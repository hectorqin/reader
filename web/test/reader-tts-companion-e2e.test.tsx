// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { ReaderView } from '../src/ui/reader-view.ts';
import type { BookDoc } from '../src/formats/types.ts';
import { AiCompanionSheet, type CompanionData } from '../src/ui/ai-companion.tsx';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function makeRect(left: number, top: number, width: number, height: number): DOMRect {
  return {
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
    x: left,
    y: top,
    toJSON() {
      return this;
    },
  } as DOMRect;
}

function makeDoc(html: string): BookDoc {
  return {
    format: 'epub',
    layout: 'reflowable',
    render: 'reflowable',
    direction: 'ltr',
    toc: [],
    orderedByBook: true,
    styles: [],
    resources: new Map(),
    sections: [{ id: 'ch1', label: '第一章', depth: 0, html }],
  };
}

describe('ReaderView E2E: Shadow DOM chapterText, TTS anchor & highlight', () => {
  it('extracts chapterText through Shadow DOM while skipping style and reader-mark overlays', async () => {
    const container = document.createElement('div');
    document.body.append(container);
    const view = new ReaderView({
      container,
      doc: makeDoc('<p>第一段正文，包含<em>重点</em>词语。</p><p>第二段正文在这里。</p>'),
    });
    await view.open(0, 0);

    // Light DOM textContent is empty because content lives inside Shadow DOM,
    // which was the root cause of "当前章节没有可总结的正文".
    expect(container.textContent?.trim() || '').toBe('');

    // Add a glossary overlay button inside shadow flow to ensure it is skipped.
    const host = container.querySelector('book-content') as HTMLElement & { flow: HTMLElement };
    const overlay = document.createElement('button');
    overlay.dataset['readerMark'] = 'glossary';
    overlay.textContent = '不应被提取的覆盖层';
    host.flow.append(overlay);

    const extracted = view.chapterText();
    expect(extracted).toContain('第一段正文，包含重点词语。');
    expect(extracted).toContain('第二段正文在这里。');
    expect(extracted).not.toContain('不应被提取的覆盖层');

    view.dispose();
    container.remove();
  });

  it('picks the visible sentence in scroll mode (not chunk 0) and paints multi-rect speech highlights', async () => {
    const container = document.createElement('div');
    document.body.append(container);
    const view = new ReaderView({
      container,
      doc: makeDoc('<p>第一句在顶部。</p><p>第二句在当前屏幕。</p><p>第三句在下面。</p>'),
    });
    await view.open(0, 0);
    view.applySettings({ mode: 'scroll' });

    const host = container.querySelector('book-content') as HTMLElement & { flow: HTMLElement };
    // Simulate scroll mode where host (the viewport scroller) is at top=48..648,
    // while host.flow (the full chapter) has been scrolled up to top=-952.
    host.getBoundingClientRect = () => makeRect(0, 48, 400, 600);
    host.flow.getBoundingClientRect = () => makeRect(0, -952, 400, 2000);

    // Mock Range geometry per sentence text.
    const origCreateRange = document.createRange.bind(document);
    const spyRange = vi.spyOn(document, 'createRange').mockImplementation(() => {
      const r = origCreateRange();
      const rectFor = (): DOMRect => {
        const txt = r.toString();
        if (txt.includes('第一句')) return makeRect(20, -900, 200, 24);
        if (txt.includes('第二句')) return makeRect(20, 120, 240, 24);
        return makeRect(20, 420, 220, 24);
      };
      r.getBoundingClientRect = () => rectFor();
      r.getClientRects = () => {
        const main = rectFor();
        return [main, makeRect(main.left, main.top + 28, main.width / 2, 24)] as unknown as DOMRectList;
      };
      return r;
    });

    const anchor = view.speechAnchor();
    expect(anchor).not.toBeNull();
    expect(anchor?.text).toBe('第二句在当前屏幕。');

    // Highlight the anchored chunk and verify multiple line overlays are painted with data-reader-mark="speech".
    view.highlightSpokenChunk(anchor);
    const marks = host.flow.querySelectorAll('[data-reader-mark="speech"]');
    expect(marks.length).toBe(2);
    expect(marks[0]?.className).toBe('reader-speech-highlight');

    // Clear removes all painted overlays.
    view.clearSpeechHighlight();
    expect(host.flow.querySelectorAll('[data-reader-mark="speech"]').length).toBe(0);

    spyRange.mockRestore();
    view.dispose();
    container.remove();
  });

  it('picks the sentence on the current column in paged mode', async () => {
    const container = document.createElement('div');
    document.body.append(container);
    const view = new ReaderView({
      container,
      doc: makeDoc('<p>第一页的句子。</p><p>第二页的句子。</p>'),
    });
    await view.open(0, 0);
    view.applySettings({ mode: 'paged' });

    const host = container.querySelector('book-content') as HTMLElement & { flow: HTMLElement };
    host.flow.getBoundingClientRect = () => makeRect(0, 0, 400, 600);

    const origCreateRange = document.createRange.bind(document);
    const spyRange = vi.spyOn(document, 'createRange').mockImplementation(() => {
      const r = origCreateRange();
      const rectFor = (): DOMRect => {
        const txt = r.toString();
        if (txt.includes('第一页')) return makeRect(-380, 40, 320, 24);
        return makeRect(24, 40, 320, 24);
      };
      r.getBoundingClientRect = () => rectFor();
      r.getClientRects = () => [rectFor()] as unknown as DOMRectList;
      return r;
    });

    const anchor = view.speechAnchor();
    expect(anchor?.text).toBe('第二页的句子。');

    spyRange.mockRestore();
    view.dispose();
    container.remove();
  });
});

describe('AiCompanionSheet E2E: tabs, backfill button visibility, and character graph', () => {
  function sampleData(overrides: Partial<CompanionData> = {}): CompanionData {
    return {
      bookId: 'b1',
      title: '测试书',
      uptoSeq: 1,
      chapterTitle: '第二章',
      totalChapters: 20,
      coveredChapters: 2,
      newlyExtracted: 0,
      recap: '前两章的防剧透前情提要。',
      recapCached: true,
      entities: [
        {
          name: '林远',
          category: 'character',
          aliases: ['小林'],
          role: '主角',
          note: '调查古镜的年轻人',
          firstSeenSeq: 0,
          lastSeenSeq: 1,
          mentions: 2,
          timeline: [{ seq: 0, note: '出场' }],
        },
        {
          name: '苏晴',
          category: 'character',
          aliases: [],
          role: '搭档',
          note: '档案管理员',
          firstSeenSeq: 1,
          lastSeenSeq: 1,
          mentions: 1,
          timeline: [{ seq: 1, note: '协助调查' }],
        },
      ],
      relations: [
        {
          from: '林远',
          to: '苏晴',
          label: '搭档',
          firstSeenSeq: 1,
          lastSeenSeq: 1,
          history: [{ seq: 1, label: '搭档' }],
        },
      ],
      openThreads: ['古镜为何在雨夜发光？'],
      ...overrides,
    };
  }

  it('hides backfill button on chapter 2 and shows underline tabs + interactive graph', async () => {
    const load = vi.fn(async () => sampleData({ uptoSeq: 1, coveredChapters: 2 }));
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(<AiCompanionSheet load={load} onClose={() => undefined} />);
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(host.textContent).toContain('已缓存 2/2 章记忆');
    expect(host.textContent).not.toContain('补提更早未缓存章节');

    // Tabs use role="tab" with .ai-companion-tab (underline style).
    const tabs = [...host.querySelectorAll('[role="tab"]')];
    expect(tabs.length).toBe(3);
    expect(tabs[0]?.className).toContain('ai-companion-tab');

    // Switch to character graph tab and verify SVG graph renders.
    await act(async () => {
      (tabs[1] as HTMLButtonElement).click();
    });
    expect(host.querySelector('svg[aria-label="人物关系图谱"]')).not.toBeNull();

    await act(async () => root.unmount());
    host.remove();
  });

  it('shows smart backfill button only when earlier chapters are uncached beyond window', async () => {
    const load = vi.fn(async () => sampleData({ uptoSeq: 9, coveredChapters: 8, chapterTitle: '第十章' }));
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(<AiCompanionSheet load={load} onClose={() => undefined} />);
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(host.textContent).toContain('补提更早未缓存章节（共 10 章）');

    await act(async () => root.unmount());
    host.remove();
  });
});
