// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AiAssistSheet, type AssistAction } from '../src/ui/ai-assist.tsx';
import { AnnotationPopover } from '../src/ui/annotation-popover.tsx';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('AiAssistSheet', () => {
  let host: HTMLElement, root: Root;
  beforeEach(() => { host = document.createElement('div'); document.body.append(host); root = createRoot(host); });
  afterEach(() => { act(() => root.unmount()); host.remove(); });

  const button = (name: string) => [...host.querySelectorAll('button')].find(candidate => candidate.textContent === name)!;
  const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });

  it('translates and explains the passage, showing one answer at a time', async () => {
    const ask = vi.fn(async (action: AssistAction) => action === 'translate' ? '译文' : '解释');
    act(() => root.render(<AiAssistSheet quote="To be, or not to be" ask={ask} onClose={() => undefined} />));
    expect(host.querySelector('blockquote')?.textContent).toBe('To be, or not to be');
    act(() => button('翻译').click());
    expect(host.querySelector('[role=status]')?.textContent).toBe('正在翻译…');
    await flush();
    expect(host.querySelector('.ai-assist-answer')?.textContent).toBe('译文');
    expect(host.querySelector('[role=status]')).toBeNull();
    act(() => button('解释').click());
    expect(host.querySelector('.ai-assist-answer')).toBeNull();
    await flush();
    expect(host.querySelector('.ai-assist-answer')?.textContent).toBe('解释');
    expect(ask.mock.calls).toEqual([['translate', ''], ['explain', '']]);
  });

  it('asks the reader\'s own question, and only when there is one', async () => {
    const ask = vi.fn(async () => '是哈姆雷特');
    act(() => root.render(<AiAssistSheet quote="To be" ask={ask} onClose={() => undefined} />));
    expect(button('提问').disabled).toBe(true);
    const input = host.querySelector('input')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, '  这是谁说的？ ');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(button('提问').disabled).toBe(false);
    act(() => host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    await flush();
    expect(ask).toHaveBeenCalledWith('ask', '这是谁说的？');
    expect(host.querySelector('.ai-assist-answer')?.textContent).toBe('是哈姆雷特');
  });

  it('says why a request failed, and lets a slow answer lose to the one asked after it', async () => {
    let finishSlow!: (value: string) => void;
    const ask = vi.fn((action: AssistAction) => action === 'translate'
      ? new Promise<string>(resolve => { finishSlow = resolve; })
      : Promise.reject(new Error('AI 功能未启用')));
    act(() => root.render(<AiAssistSheet quote="文" ask={ask} onClose={() => undefined} />));
    act(() => button('翻译').click());
    act(() => button('解释').click());
    await flush();
    expect(host.querySelector('[role=alert]')?.textContent).toBe('AI 功能未启用');
    await act(async () => { finishSlow('迟到的译文'); await Promise.resolve(); });
    expect(host.querySelector('.ai-assist-answer')).toBeNull();
    expect(host.querySelector('[role=alert]')?.textContent).toBe('AI 功能未启用');
  });
});

describe('AnnotationPopover 问AI', () => {
  let host: HTMLElement, root: Root;
  beforeEach(() => { host = document.createElement('div'); document.body.append(host); root = createRoot(host); });
  afterEach(() => { act(() => root.unmount()); host.remove(); });
  const target = { anchor: { sectionId: 's', start: 0, end: 2, quote: '选区', prefix: '', suffix: '' }, rect: new DOMRect(10, 10, 40, 20) };
  const props = { target, save: async () => undefined, remove: async () => undefined, close: () => undefined };
  const labels = () => [...host.querySelectorAll('.annotation-actions button')].map(candidate => candidate.textContent);

  it('is offered on a selection only when the server has it', () => {
    act(() => root.render(<AnnotationPopover {...props} />));
    expect(labels()).not.toContain('问AI');
    const askAi = vi.fn();
    act(() => root.render(<AnnotationPopover {...props} askAi={askAi} />));
    expect(labels()).toContain('问AI');
    act(() => [...host.querySelectorAll<HTMLButtonElement>('.annotation-actions button')].find(candidate => candidate.textContent === '问AI')!.click());
    expect(askAi).toHaveBeenCalledTimes(1);
  });
});
