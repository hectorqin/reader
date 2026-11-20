/**
 * Ask about a passage: translate it, explain it, or put a question to it.
 *
 * The passage is what the reader selected, and every answer is about that
 * passage alone — there is no conversation to scroll back through. A second
 * question replaces the first answer, because the thing being read is the book.
 *
 * The sheet stays closable while a request is in flight: an answer the reader no
 * longer wants is not worth holding them for, and the server keeps what it
 * produced, so asking again costs nothing.
 *
 * An answer worth keeping becomes an annotation on the passage (存为批注), which is
 * how it reaches 读书笔记 and the export; nothing is kept otherwise.
 */
import { type JSX, useRef, useState } from 'react';
import { Sheet } from './sheet.tsx';
import { Button } from './toolkit.tsx';

export type AssistAction = 'translate' | 'explain' | 'ask';

const WORKING: Record<AssistAction, string> = { translate: '正在翻译…', explain: '正在解释…', ask: '正在思考…' };
const MAX_QUESTION = 500;
/** The annotation editor's own limit: a kept answer must stay editable there. */
export const MAX_KEPT_ANSWER = 4000;

/** The annotation an answer is kept as: what was asked, then the answer, cut to what an annotation holds. */
export function keptAnswer(action: AssistAction, question: string, answer: string): string {
  const heading = action === 'translate' ? 'AI 翻译' : action === 'explain' ? 'AI 解释' : `问：${question}`;
  const text = `${heading}\n${answer.trim()}`;
  return text.length > MAX_KEPT_ANSWER ? `${text.slice(0, MAX_KEPT_ANSWER - 1)}…` : text;
}

export function AiAssistSheet({
  quote,
  ask,
  keep,
  onClose,
}: {
  quote: string;
  ask(action: AssistAction, question: string): Promise<string>;
  /** Saves the answer as an annotation on the passage. Absent where notes cannot be written. */
  keep?(comment: string): Promise<void>;
  onClose(): void;
}): JSX.Element {
  const [asked, setAsked] = useState<{ action: AssistAction; question: string } | null>(null);
  const [kept, setKept] = useState<'' | 'saving' | 'saved'>('');
  const [busy, setBusy] = useState<AssistAction | null>(null);
  const [answer, setAnswer] = useState(''),
    [error, setError] = useState(''),
    [question, setQuestion] = useState('');
  /** Only the latest request may write: a slow 翻译 must not overwrite the 解释 asked after it. */
  const latest = useRef(0);

  async function run(action: AssistAction, text = ''): Promise<void> {
    const id = ++latest.current;
    setBusy(action);
    setError('');
    setAnswer('');
    setKept('');
    try {
      const result = await ask(action, text);
      if (id === latest.current) {
        setAnswer(result);
        setAsked({ action, question: text });
      }
    } catch (failure) {
      if (id === latest.current) setError(failure instanceof Error ? failure.message : 'AI 请求失败');
    } finally {
      if (id === latest.current) setBusy(null);
    }
  }

  return (
    <Sheet title="AI 助手" className="ai-assist-sheet" onClose={onClose}>
      <div className="ai-assist">
        <blockquote>{quote}</blockquote>
        <div className="ai-assist-actions">
          <Button aria-pressed={busy === 'translate'} onClick={() => void run('translate')}>
            翻译
          </Button>
          <Button aria-pressed={busy === 'explain'} onClick={() => void run('explain')}>
            解释
          </Button>
        </div>
        <form
          className="ai-assist-ask"
          onSubmit={(event) => {
            event.preventDefault();
            const text = question.trim();
            if (text) void run('ask', text);
          }}
        >
          <label className="sheet-field">
            <span>就这段话提问</span>
            <input
              value={question}
              maxLength={MAX_QUESTION}
              enterKeyHint="send"
              placeholder="例如：这里指的是谁？"
              onInput={(event) => setQuestion(event.currentTarget.value)}
            />
          </label>
          <Button type="submit" className="primary" disabled={!question.trim()}>
            提问
          </Button>
        </form>
        {busy && (
          <p className="ai-assist-status" role="status">
            {WORKING[busy]}
          </p>
        )}
        {error && (
          <p className="ai-assist-error" role="alert">
            {error}
          </p>
        )}
        {answer && (
          <article className="ai-assist-answer" aria-live="polite">
            {answer}
          </article>
        )}
        {answer && keep && asked && (
          <div className="ai-assist-keep">
            <Button
              disabled={kept !== ''}
              onClick={() => {
                setKept('saving');
                setError('');
                void keep(keptAnswer(asked.action, asked.question, answer)).then(
                  () => setKept('saved'),
                  (failure: unknown) => {
                    setKept('');
                    setError(failure instanceof Error ? failure.message : '保存失败，请重试');
                  },
                );
              }}
            >
              {kept === 'saved' ? '已存为批注' : kept === 'saving' ? '正在保存…' : '存为批注'}
            </Button>
          </div>
        )}
        <p className="ai-assist-hint">选中的文字和它的前后文会发送给管理员配置的 AI 服务；回答可能有误。</p>
      </div>
    </Sheet>
  );
}
