/**
 * The reader's chrome: everything around the page.
 *
 * Split out from the screen on purpose, and along the line that matters: the
 * *stage* below is imperative DOM work the paginator measures, and this is state
 * and events. All of it is a function of `ChromeState` — the topbar, the footer's
 * progress, the contents list, the settings panel with its format-dependent rows,
 * and the read-aloud bar.
 *
 * That last one is the clearest win of the rework. It used to be a group of nodes
 * the screen mutated in place from `renderSpeechState`, plus a "rebuild only the
 * speech rows" dance so that the engine picker could appear when the server's
 * capability probe answered without throwing away the reader's scroll position in
 * the panel. Here the probe simply changes the state, the diff redraws the rows,
 * and the scroll position is untouched because nothing above them is replaced.
 */

import type { AppSettings } from '../store/settings.ts';
import type { SpeechEngineKind } from '../render/speech.ts';
import { type ComponentChildren, type JSX } from './vendor/preact.ts';
import { IconButton, SectionTitle } from './toolkit.tsx';

/**
 * A table-of-contents row.
 *
 * `spine` is the whole-book position, and its absence is meaningful: the server
 * omits it for formats whose navigation is not a linear chapter list. A row
 * without one cannot be jumped to across windows, so the panel marks it instead
 * of offering a tap that would do nothing.
 */
export interface ChromeTocEntry {
  id: string;
  label: string;
  depth: number;
  spine?: number;
}

export interface SpeechBarState {
  active: boolean;
  state: string;
  label: string;
  chip: string;
  index: number;
  total: number;
  /** Index on the reader's sentence list, which the scrub range is in. */
  sentenceIndex: number;
  sentenceTotal: number;
}

export interface ChromeState {
  title: string;
  author: string;
  chromeVisible: boolean;
  statusText: string;
  statusState: string;
  /** 0..1. */
  progress: number;
  chapterLabel: string;
  tocOpen: boolean;
  settingsOpen: boolean;
  toc: ChromeTocEntry[];
  currentSectionId: string;
  /** 1-based position of the current page inside its chapter, and the count. */
  pageInChapter: number;
  chapterPages: number;
  /** Which whole-book chapter is open, 1-based, and how many there are. */
  chapterIndex: number;
  chapterCount: number;
  /** True while a window is being fetched, so the chapter buttons can say so. */
  navigating: boolean;
  tts: SpeechBarState;
  layout: string;
  format: string;

  // ---- the settings projection (see `settingsView` on the screen) ----
  mode: AppSettings['mode'];
  fontScale: number;
  lineHeight: string;
  theme: AppSettings['theme'];
  fit: AppSettings['fit'];
  fontFamily: string;
  pageMargin: number;
  textAlign: AppSettings['textAlign'];
  brightness: number;
  pageAnimation: AppSettings['pageAnimation'];
  tapZone: AppSettings['tapZone'];
  txtEncoding: string;
  comicDirection: AppSettings['comicDirection'];
  ttsRate: number;
  ttsPitch: number;
  ttsVolume: number;
  ttsVoice: string;
  ttsAutoAdvance: boolean;
  ttsEngine: AppSettings['ttsEngine'];
  showFitRow: boolean;
  showDirectionRow: boolean;
  showEncodingRow: boolean;
  showEngineRow: boolean;
  showPitchRow: boolean;
  showVoiceRow: boolean;
  speechUnavailable: boolean;
  engineOptions: Array<{ value: string; label: string }>;
  voices: Array<{ value: string; label: string }>;
}

export interface ChromeHandlers {
  onBack(): void;
  toggleToc(): void;
  toggleSettings(): void;
  onSetting(patch: Partial<AppSettings>): void;
  onSpeechSetting(patch: Partial<AppSettings>): void;
  onVoice(value: string): void;
  onSpeakFromHere(): void;
  onSwitchEngine(kind: AppSettings['ttsEngine']): void;
  onTocEntry(ref: string): void;
  onChapter(delta: 1 | -1): void;
  onTurnPage(direction: 'next' | 'previous'): void;
  onSpeechToggle(): void;
  onSpeechPrevious(): void;
  onSpeechNext(): void;
  onSpeechScrub(index: number): void;
  onStopSpeech(): void;
}

export interface ReaderChromeProps {
  state: ChromeState;
  /**
   * The reading surface.
   *
   * Passed as children rather than created here: it is owned by the screen and
   * by the `ReaderView` that measures it, and a container the tree re-created
   * would take the reader's scroll position and the shadow root with it.
   */
  stage: HTMLElement;
  handlers: ChromeHandlers;
}

export function ReaderChrome({ state, stage, handlers }: ReaderChromeProps): JSX.Element {
  return (
    <>
      <div className="topbar" hidden={!state.chromeVisible}>
        <IconButton label="返回书架" icon="arrow-left" onClick={handlers.onBack} />
        <div className="title-block" style="flex:1 1 auto;min-width:0;">
          <h1>{state.title}</h1>
          {state.author ? <span className="subtitle">{state.author}</span> : null}
        </div>
        <IconButton label="目录" icon="menu" onClick={handlers.toggleToc} />
      </div>

      <div className="status-bar" hidden={state.statusState === 'idle' && state.statusText === ''} data-state={state.statusState}>
        <span className="status-dot" />
        <span>{state.statusText}</span>
      </div>

      <StageHost stage={stage} />

      <div className="footer" hidden={!state.chromeVisible}>
        <div className="progress-bar">
          <span style={`width:${percentOf(state.progress)}`} />
        </div>
        <div className="footer-row">
          <IconButton label="目录" icon="menu" onClick={handlers.toggleToc} />
          <IconButton
            label="上一章"
            icon="chevron-left"
            disabled={state.navigating || state.chapterIndex <= 1}
            onClick={() => handlers.onChapter(-1)}
          />
          <button type="button" className="chapter" onClick={handlers.toggleToc}>
            {state.navigating ? '正在切换…' : state.chapterLabel || '目录'}
          </button>
          <IconButton
            label="下一章"
            icon="chevron-right"
            disabled={state.navigating || state.chapterIndex >= state.chapterCount}
            onClick={() => handlers.onChapter(1)}
          />
          <IconButton label="阅读设置" icon="sliders" onClick={handlers.toggleSettings} />
        </div>
        <div className="footer-row footer-meta">
          <span>
            {state.chapterCount > 0 ? `${state.chapterIndex}/${state.chapterCount} 章` : ''}
          </span>
          <span>
            {state.chapterPages > 0
              ? `本章 ${state.pageInChapter}/${state.chapterPages} 页`
              : ''}
          </span>
          <span className="progress-label">{percentOf(state.progress)}</span>
        </div>
      </div>

      {state.tts.active ? <SpeechBar state={state.tts} handlers={handlers} /> : null}

      {state.tocOpen ? (
        <Panel title="目录" onClose={handlers.toggleToc}>
          {state.toc.length === 0 ? (
            <div className="empty-state">这本书没有目录</div>
          ) : (
            <ul className="toc-list">
              {state.toc.map((entry) => (
                <li key={entry.id} data-section={entry.id}>
                  <button
                    type="button"
                    aria-current={entry.id === state.currentSectionId}
                    // A row that is already on screen is a scroll, not a jump:
                    // saying so is the difference between a list that reacts and
                    // a list that appears not to.
                    title={entry.spine === undefined ? '这一章不在当前窗口中' : undefined}
                    style={entry.depth > 0 ? `padding-inline-start:${0.4 + entry.depth * 0.9}rem` : undefined}
                    onClick={() => handlers.onTocEntry(entry.id)}
                  >
                    {entry.label}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      ) : null}

      {state.settingsOpen ? (
        <Panel title="阅读设置" onClose={handlers.toggleSettings}>
          <SettingsBody state={state} handlers={handlers} />
        </Panel>
      ) : null}
    </>
  );
}

/**
 * Puts the stage in the tree without owning it.
 *
 * `dangerouslySetInnerHTML` is the wrong tool here — it would replace the node
 * Preact renders rather than keep this one. A ref callback that appends the
 * element the screen kept across renders is the honest version: the tree decides
 * *where* the stage sits (between the status line and the footer, which is where
 * its stacking context comes from) and the screen owns its contents.
 */
function StageHost({ stage }: { stage: HTMLElement }): JSX.Element {
  return (
    <div
      className="stage-host"
      ref={(node) => {
        // A ref callback fires with `null` on unmount; only the mount case moves
        // the node, because moving it on unmount would take it out of the screen
        // the router is about to replace it in.
        if (node && stage.parentElement !== node) node.append(stage);
      }}
    />
  );
}

function Panel({ title, onClose, children }: { title: string; onClose(): void; children: ComponentChildren }): JSX.Element {
  return (
    <div className="panel">
      <div className="panel-header">
        <h2>{title}</h2>
        <IconButton label="关闭" icon="close" onClick={onClose} />
      </div>
      <div className="panel-body">{children}</div>
    </div>
  );
}

function SettingsBody({ state, handlers }: { state: ChromeState; handlers: ChromeHandlers }): JSX.Element {
  return (
    <>
      <SectionTitle>排版</SectionTitle>
      <SegmentedRow
        label="翻页方式"
        options={[
          { value: 'scroll', label: '滚动' },
          { value: 'paged', label: '翻页' },
        ]}
        value={state.mode}
        onChange={(value) => handlers.onSetting({ mode: value as AppSettings['mode'] })}
      />
      <SliderRow
        label="字号"
        value={state.fontScale}
        min={0.8}
        max={2.2}
        step={0.05}
        format={(value) => `${Math.round(value * 100)}%`}
        onChange={(value) => handlers.onSetting({ fontScale: value })}
      />
      <SegmentedRow
        label="行距"
        options={['inherit', '1.4', '1.6', '1.8', '2.1'].map((value) => ({
          value,
          label: value === 'inherit' ? '原书' : value,
        }))}
        value={state.lineHeight}
        onChange={(value) => handlers.onSetting({ lineHeight: value })}
      />
      <SliderRow
        label="页边距"
        value={state.pageMargin}
        min={0}
        max={4}
        step={0.25}
        format={(value) => `${value.toFixed(2)}rem`}
        onChange={(value) => handlers.onSetting({ pageMargin: value })}
      />
      <SegmentedRow
        label="对齐"
        options={[
          { value: 'inherit', label: '原书' },
          { value: 'start', label: '左对齐' },
          { value: 'justify', label: '两端对齐' },
        ]}
        value={state.textAlign}
        onChange={(value) => handlers.onSetting({ textAlign: value as AppSettings['textAlign'] })}
      />
      {/* The stacks are the ones a Chinese reading app is expected to offer: a
          system stack, two serif faces that are actually present on phones, and
          "原书" which is the default and means "do not touch the book's stack". */}
      <SelectRow
        label="字体"
        options={[
          { value: 'inherit', label: '原书' },
          { value: 'system-ui, -apple-system, "Noto Sans SC", sans-serif', label: '系统黑体' },
          { value: '"Songti SC", "Noto Serif SC", "Source Han Serif SC", SimSun, serif', label: '宋体' },
          { value: '"Kaiti SC", KaiTi, "Noto Serif SC", serif', label: '楷体' },
          { value: '"PingFang SC", "Microsoft YaHei", "Noto Sans SC", sans-serif', label: '苹方/雅黑' },
        ]}
        value={state.fontFamily}
        onChange={(value) => handlers.onSetting({ fontFamily: value })}
      />
      <SegmentedRow
        label="主题"
        options={[
          { value: 'light', label: '白' },
          { value: 'sepia', label: '米黄' },
          { value: 'dark', label: '夜间' },
        ]}
        value={state.theme}
        onChange={(value) => handlers.onSetting({ theme: value as AppSettings['theme'] })}
      />
      <SliderRow
        label="亮度"
        value={state.brightness}
        min={0.35}
        max={1}
        step={0.05}
        format={(value) => `${Math.round(value * 100)}%`}
        onChange={(value) => handlers.onSetting({ brightness: value })}
      />

      <SectionTitle>翻页</SectionTitle>
      <SegmentedRow
        label="点击区域"
        options={[
          { value: 'standard', label: '左退右进' },
          { value: 'reversed', label: '左进右退' },
        ]}
        value={state.tapZone}
        onChange={(value) => handlers.onSetting({ tapZone: value as AppSettings['tapZone'] })}
      />
      <SegmentedRow
        label="翻页动画"
        options={[
          { value: 'slide', label: '滑动' },
          { value: 'fade', label: '淡入' },
          { value: 'none', label: '无' },
        ]}
        value={state.pageAnimation}
        onChange={(value) => handlers.onSetting({ pageAnimation: value as AppSettings['pageAnimation'] })}
      />
      {/* Rows that only apply to some books. The old panel built every row and
          then hid the irrelevant ones by hand after each open; here they are
          simply not part of the tree. */}
      {state.showFitRow ? (
        <SegmentedRow
          label="图片适配"
          options={[
            { value: 'contain', label: '完整' },
            { value: 'width', label: '适宽' },
          ]}
          value={state.fit}
          onChange={(value) => handlers.onSetting({ fit: value as AppSettings['fit'] })}
        />
      ) : null}
      {state.showDirectionRow ? (
        <SegmentedRow
          label="翻页方向"
          options={[
            { value: 'ltr', label: '左→右' },
            { value: 'rtl', label: '右→左' },
          ]}
          value={state.comicDirection}
          onChange={(value) => handlers.onSetting({ comicDirection: value as AppSettings['comicDirection'] })}
        />
      ) : null}

      <SectionTitle>朗读</SectionTitle>
      <SpeechSettings state={state} handlers={handlers} />

      {state.showEncodingRow ? (
        <SegmentedRow
          label="TXT 编码"
          options={[
            { value: '', label: '自动' },
            { value: 'utf-8', label: 'utf-8' },
            { value: 'gb18030', label: 'gb18030' },
            { value: 'big5', label: 'big5' },
            { value: 'utf-16le', label: 'utf-16le' },
          ]}
          value={state.txtEncoding}
          onChange={(value) => handlers.onSetting({ txtEncoding: value })}
        />
      ) : null}
    </>
  );
}

/**
 * The read-aloud section.
 *
 * Which rows exist depends on the engine, and the dependency is stated rather
 * than hidden: pitch has no meaning for synthesised audio, a voice list is empty
 * for HTTP until the server answers, and "系统语音（原生）" does not exist in a
 * browser. A row that cannot do anything is omitted instead of shown disabled — a
 * disabled control tells the reader something is broken, and usually nothing is.
 */
function SpeechSettings({ state, handlers }: { state: ChromeState; handlers: ChromeHandlers }): JSX.Element {
  if (state.speechUnavailable) {
    return (
      <div className="notice">
        当前环境没有可用的朗读引擎：浏览器不支持语音合成，且服务端未配置 TTS_URL。在服务端设置 TTS_URL 后即可使用 HTTP 朗读。
      </div>
    );
  }
  return (
    <>
      {/* The engine picker only appears when there is a choice to make. One
          engine is not a setting. */}
      {state.showEngineRow ? (
        <SelectRow
          label="朗读引擎"
          options={state.engineOptions}
          value={state.ttsEngine}
          onChange={(value) => handlers.onSwitchEngine(value as AppSettings['ttsEngine'])}
        />
      ) : null}
      <SliderRow
        label="语速"
        value={state.ttsRate}
        min={0.5}
        max={2.5}
        step={0.1}
        format={(value) => `${value.toFixed(1)}×`}
        onChange={(value) => handlers.onSpeechSetting({ ttsRate: value })}
      />
      {state.showPitchRow ? (
        <SliderRow
          label="音调"
          value={state.ttsPitch}
          min={0.5}
          max={2}
          step={0.1}
          format={(value) => value.toFixed(1)}
          onChange={(value) => handlers.onSpeechSetting({ ttsPitch: value })}
        />
      ) : null}
      <SliderRow
        label="音量"
        value={state.ttsVolume}
        min={0}
        max={1}
        step={0.05}
        format={(value) => `${Math.round(value * 100)}%`}
        onChange={(value) => handlers.onSpeechSetting({ ttsVolume: value })}
      />
      {state.showVoiceRow ? (
        <SelectRow label="语音" options={state.voices} value={state.ttsVoice} onChange={handlers.onVoice} />
      ) : null}
      <SegmentedRow
        label="章节播完"
        options={[
          { value: 'auto', label: '继续下一章' },
          { value: 'stop', label: '停止' },
        ]}
        value={state.ttsAutoAdvance ? 'auto' : 'stop'}
        onChange={(value) => handlers.onSpeechSetting({ ttsAutoAdvance: value === 'auto' })}
      />
      <button type="button" className="button" onClick={handlers.onSpeakFromHere}>
        从头朗读这一章
      </button>
    </>
  );
}

/**
 * The read-aloud bar.
 *
 * A separate strip rather than a row inside the footer, for a reason that only
 * shows up in use: the footer is toggled off with the chrome, and a reader
 * listening to a book while walking wants to keep the controls reachable without
 * the header covering the text. The bar is therefore tied to the *engine's*
 * state, not to the chrome's.
 */
function SpeechBar({ state, handlers }: { state: SpeechBarState; handlers: ChromeHandlers }): JSX.Element {
  const max = Math.max(0, (state.sentenceTotal || state.total) - 1);
  const value = Math.max(0, state.sentenceIndex >= 0 ? state.sentenceIndex : state.index);
  return (
    <div className="tts-bar" data-state={state.state}>
      <IconButton label="上一句" icon="skip-back" onClick={handlers.onSpeechPrevious} />
      <IconButton
        label={state.state === 'playing' ? '暂停朗读' : '开始朗读'}
        icon={state.state === 'playing' ? 'pause' : 'play'}
        onClick={handlers.onSpeechToggle}
      />
      <IconButton label="下一句" icon="skip-forward" onClick={handlers.onSpeechNext} />
      <div className="tts-main">
        <span className="tts-text" title={state.label}>
          {state.label}
        </span>
        <input
          className="tts-range"
          type="range"
          min={0}
          max={max}
          step={1}
          value={value}
          aria-label="朗读进度"
          onInput={(event) => handlers.onSpeechScrub(Number((event.currentTarget as HTMLInputElement).value))}
        />
      </div>
      <button
        type="button"
        className="chip"
        aria-label={state.total > 0 ? '朗读句数' : '从头朗读'}
        onClick={handlers.onSpeakFromHere}
      >
        {state.chip}
      </button>
      <IconButton label="停止朗读" icon="close" onClick={handlers.onStopSpeech} />
    </div>
  );
}

function SegmentedRow({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: Array<{ value: string; label: string }>;
  value: string;
  onChange(value: string): void;
}): JSX.Element {
  return (
    <div className="field">
      <label>{label}</label>
      <div className="segmented" role="group" aria-label={label}>
        {options.map((option) => (
          <button
            type="button"
            key={option.value}
            aria-pressed={option.value === value}
            onClick={() => onChange(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/** A labelled range input whose value label follows the drag. */
function SliderRow({
  label,
  value,
  min,
  max,
  step,
  format,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format(value: number): string;
  onChange(value: number): void;
}): JSX.Element {
  return (
    <div className="field">
      <label>
        {label} {format(value)}
      </label>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onInput={(event) => onChange(Number((event.currentTarget as HTMLInputElement).value))}
      />
    </div>
  );
}

/** A labelled native select, for the lists that outgrow a segmented control. */
function SelectRow({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: Array<{ value: string; label: string }>;
  value: string;
  onChange(value: string): void;
}): JSX.Element {
  return (
    <div className="field">
      <label>{label}</label>
      <select value={value} onChange={(event) => onChange((event.currentTarget as HTMLSelectElement).value)}>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}

/** The progress fraction as a percentage, clamped. */
function percentOf(fraction: number): string {
  return `${Math.round(Math.min(1, Math.max(0, fraction)) * 100)}%`;
}

export type { SpeechEngineKind };
