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
import { ICON_CODEPOINTS, type IconName } from './icon-names.ts';

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
  txtIndent: number;
  txtParagraphGap: number;
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
  /** Plain-text typography rows; see the `正文` section in the panel. */
  showTxtRows: boolean;
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
  /**
   * Jump to a page *inside the current chapter*, from the footer scrubber.
   *
   * A page number rather than a fraction, because a page is what the reader is
   * choosing: the readout beside the thumb says "第 3/9 页", and a slider that
   * moved by whole-book fraction would land them somewhere the readout never
   * names.
   */
  onScrubPage(page: number): void;
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
      {/* The top bar.
          —
          A row of labelled buttons, not a title with a back arrow. The reference
          layout is a toolbar the reader *scans*: five controls of equal weight,
          each an icon over its own name, so nothing has to be learned and nothing
          is announced twice. The book's title lived here before; it is still on
          screen when the chrome is hidden (see `.reading-indicator`), which is
          where a reader actually looks for it — a title that disappears with the
          toolbar was the reason the indicator had to exist at all.
          Buttons are kept to the ones this screen can really do. The reference's
          首页/书架/书源/目录/设置 collapses to 返回/目录/设置 here because there is
          no book-source browser *inside* the reader: a button that navigates
          somewhere the screen cannot go is worse than one fewer button. */}
      <div className="topbar" hidden={!state.chromeVisible}>
        <TopButton icon="arrow-left" label="返回" onClick={handlers.onBack} />
        <TopButton icon="bars" label="目录" onClick={handlers.toggleToc} />
        <TopButton icon="sliders" label="设置" onClick={handlers.toggleSettings} />
      </div>

      {/* Outside the flex flow: see the comment on `.status-bar`. It has to be a
          sibling of the stage rather than a child of it, because the stage's slot
          measures the space between the chrome and a strip that came and went would
          change that measurement on every sync. */}
      <div
        className="status-bar"
        hidden={state.statusState === 'idle' && state.statusText === ''}
        data-state={state.statusState}
        role="status"
        aria-live="polite"
      >
        <span className="status-dot" aria-hidden="true" />
        <span className="status-text">{state.statusText}</span>
      </div>

      <StageHost stage={stage} />

      {/* The reading indicator.
          —
          What is left on screen when the chrome is hidden. The reference keeps two
          quiet facts pinned to the corners — which chapter, and how far in — and
          nothing else. That is the difference between "沉浸式" and "the app stopped
          drawing": a reader who has hidden the toolbar still wants to know where
          they are, and making them tap to find out is what the hidden state was
          supposed to save them from.
          Both live in the page margin at the very top and bottom of the stage, are
          `pointer-events: none` (they are readouts, not controls), and are drawn
          only while the chrome is hidden so they do not double up with it. */}
      {!state.chromeVisible ? (
        <div className="reading-indicator" aria-hidden="true">
          <span className="indicator-chapter">{state.chapterLabel}</span>
          <span className="indicator-progress">
            {state.chapterPages > 0 ? `第 ${state.pageInChapter}/${state.chapterPages} 页 ` : ''}
            {percentOf(state.progress)}
          </span>
        </div>
      ) : null}

      {/* The quick-action rail.
          —
          A column of controls on the right edge, shown **and hidden with the two
          bars**. That pairing is the request, and it is also the coherent reading
          of what the rail is for: the rail is a second way to reach the same
          destinations the top bar names (目录 / 主题 / 字号 / 设置), so it belongs to
          the same "the reader has asked for the controls" state as the bars. Drawn
          while the chrome is hidden, it was the one piece of chrome that survived
          immersion — a reader who tapped to hide the navigation still had seven
          controls floating over the right edge of the text, which is not the
          "only the page" they asked for.
          It is still *not* the toolbar's duplicate: the rail holds the four
          controls a reader nudges while reading (contents, theme, size, settings)
          and is a floating column in the page margin rather than a band, so it
          covers no line of text on a wide screen.
          Drawn unconditionally and collapsed by `data-chrome` in CSS, exactly like
          the two bars: `visibility: hidden` at the end of the fade is what takes it
          out of reach of both a finger and a screen reader, and one attribute for
          three bands is what makes "the chrome is hidden" a single fact. */}
      <div
        className="reader-rail"
        role="toolbar"
        aria-label="阅读快捷操作"
        aria-orientation="vertical"
      >
        <RailButton icon="bars" label="目录" onClick={handlers.toggleToc} />
        <RailButton
          icon={state.theme === 'dark' ? 'sun' : 'moon'}
          label={state.theme === 'dark' ? '日间' : '夜间'}
          onClick={() => handlers.onSetting({ theme: nextTheme(state.theme) })}
        />
        <RailButton icon="font" label="字号" onClick={() => handlers.onSetting({ fontScale: stepFontScale(state.fontScale, 1) })} />
        <RailButton icon="sliders" label="阅读设置" onClick={handlers.toggleSettings} />
      </div>

      {/* The bottom bar.
          —
          Two rows, and the split is the reference's: a scrubber the reader can
          drag to any page **of this chapter**, then a navigation row with the
          chapter buttons at the ends and the reading progress in the middle. The
          scrubber replaces the old 3px bar plus the "本章 x/y 页" readout — a bar
          that only reports could not be used to *go* anywhere, and the reader who
          wanted the end of the chapter had to tap the next button forty times.
          It is scoped to the chapter, not the book: the readout beside it says
          "第 3/9 页", and the reference's own screenshot shows the thumb near the
          middle at page 25 of 32 — a book-wide bar would be two thirds of the way
          across and blank in a chapter that is one of a thousand. The whole-book
          number is still on screen, as the "阅读进度" readout below, which is the
          row that *reports*; the slider is the row that *moves*. */}
      <div className="footer" hidden={!state.chromeVisible}>
        <div className="progress-row">
          <input
            className="progress-scrubber"
            type="range"
            min={1}
            max={Math.max(1, state.chapterPages)}
            step={1}
            // The *page*, not the whole-book fraction. The readout beside the thumb
            // names a page in this chapter, so the control has to move by the same
            // unit; a book-percentage slider next to "第 3/9 页" is two answers to
            // two different questions sharing one thumb.
            value={Math.min(Math.max(1, state.pageInChapter), Math.max(1, state.chapterPages))}
            aria-label="章节内页数"
            aria-valuetext={
              state.chapterPages > 0 ? `第 ${state.pageInChapter}/${state.chapterPages} 页` : '章节内页数'
            }
            disabled={state.chapterPages <= 1}
            onInput={(event) =>
              handlers.onScrubPage(Number((event.currentTarget as HTMLInputElement).value))
            }
          />
          <span className="progress-page">
            {state.chapterPages > 0 ? `第 ${state.pageInChapter}/${state.chapterPages} 页` : ''}
          </span>
        </div>
        <div className="footer-row chapter-nav">
          <button
            type="button"
            className="nav-chapter"
            disabled={state.navigating || state.chapterIndex <= 1}
            onClick={() => handlers.onChapter(-1)}
          >
            <span className="icon" aria-hidden="true">{iconGlyph('chevron-left')}</span>
            上一章
          </button>
          <span className="nav-progress">阅读进度：{percentOf(state.progress)}</span>
          <button
            type="button"
            className="nav-chapter"
            disabled={state.navigating || state.chapterIndex >= state.chapterCount}
            onClick={() => handlers.onChapter(1)}
          >
            下一章
            <span className="icon" aria-hidden="true">{iconGlyph('chevron-right')}</span>
          </button>
        </div>
      </div>

      {state.tts.active ? <SpeechBar state={state.tts} handlers={handlers} /> : null}

      {state.tocOpen ? (
        <Panel title="目录" subtitle={`${state.toc.length} 章`} onClose={handlers.toggleToc}>
          {state.toc.length === 0 ? (
            <div className="empty-state">这本书没有目录</div>
          ) : (
            <ul className="toc-list">
              {state.toc.map((entry, index) => {
                // A entry the loaded window cannot reach is *marked*, not hidden and
                // not silently inert. It is a real chapter of the book, so removing
                // it would make the list disagree with the chapter count in the
                // header; and leaving it looking tappable is how the panel accepts a
                // tap and does nothing, which reads as a broken panel.
                const reachable = entry.spine !== undefined;
                return (
                  <li key={entry.id} data-section={entry.id}>
                    <button
                      type="button"
                      aria-current={entry.id === state.currentSectionId}
                      data-unreachable={reachable ? undefined : 'true'}
                      disabled={!reachable}
                      title={reachable ? undefined : '这一章不在当前窗口中'}
                      style={entry.depth > 0 ? `padding-inline-start:${0.6 + entry.depth * 0.9}rem` : undefined}
                      onClick={() => handlers.onTocEntry(entry.id)}
                    >
                      <span className="toc-index">{index + 1}</span>
                      <span className="toc-label">{entry.label}</span>
                    </button>
                  </li>
                );
              })}
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

/**
 * A half-screen sheet over the reading area.
 *
 * Bottom sheet rather than a full-screen page, and the comment on `.panel` in the
 * stylesheet is where the reasoning lives. What belongs here is the *interaction*:
 *
 *  - The scrim is the second way out. A sheet that covers half the screen has a
 *    large, obvious, already-under-the-thumb dismissal target beside it, and using
 *    it is the gesture every reader already has; the ✕ is there for the reader who
 *    reaches for a button instead.
 *  - The scrim and the sheet are `role="dialog"`-adjacent but not a dialog: nothing
 *    behind them is inert, the text stays selectable and readable, and the point of
 *    the half height is that the reader can still see what they are adjusting. A
 *    modal that traps focus would be a lie about a sheet the reader can read
 *    through.
 *  - The grip is `aria-hidden`: it is an affordance for a drag that is not
 *    implemented, and announcing a control that does nothing is worse than not
 *    drawing one. The two real exits are labelled.
 */
function Panel({
  title,
  subtitle,
  onClose,
  children,
}: {
  title: string;
  subtitle?: string;
  onClose(): void;
  children: ComponentChildren;
}): JSX.Element {
  return (
    <>
      {/* `onClick` on the scrim rather than a document listener: the scrim *is* the
          dismiss control, so it should be a node the reader can hit, with the same
          processing as any other tap on the page. */}
      <div className="scrim" onClick={onClose} role="presentation" />
      <div className="panel" role="group" aria-label={title}>
        <div className="panel-grip" aria-hidden="true" />
        <div className="panel-header">
          <h2>{title}</h2>
          {subtitle ? <span className="panel-subtitle">{subtitle}</span> : null}
          <IconButton label="关闭" icon="xmark" onClick={onClose} />
        </div>
        <div className="panel-body">{children}</div>
      </div>
    </>
  );
}

function SettingsBody({ state, handlers }: { state: ChromeState; handlers: ChromeHandlers }): JSX.Element {
  return (
    <>
      {/* The three controls a reader reaches for most often are also the three
          the old bottom toolbar spent most of its width on. They are a row of
          large targets at the top of the sheet rather than a toolbar over the
          text, because the sheet is where the reader already is when they decide
          the text is too small — and a toolbar that stays on screen to serve them
          is a toolbar that covers the book for everyone else. */}
      <SectionTitle>快捷</SectionTitle>
      <div className="quick-row">
        <QuickButton
          icon="font"
          label="字号"
          value={`${Math.round(state.fontScale * 100)}%`}
          onClick={() => handlers.onSetting({ fontScale: stepFontScale(state.fontScale, 1) })}
        />
        <QuickButton
          icon="indent"
          label="段落缩进"
          value={state.showTxtRows ? indentLabel(state.txtIndent) : '—'}
          disabled={!state.showTxtRows}
          onClick={() => handlers.onSetting({ txtIndent: stepIndent(state.txtIndent) })}
        />
        <QuickButton
          icon="up-down"
          label="段间距"
          value={state.showTxtRows ? `${state.txtParagraphGap.toFixed(2)} 字` : '—'}
          disabled={!state.showTxtRows}
          onClick={() => handlers.onSetting({ txtParagraphGap: stepGap(state.txtParagraphGap) })}
        />
        <QuickButton
          icon={state.theme === 'dark' ? 'sun' : 'moon'}
          label="主题"
          value={THEME_LABELS[state.theme] ?? state.theme}
          onClick={() => handlers.onSetting({ theme: nextTheme(state.theme) })}
        />
      </div>

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

      {/* Plain text is the one format with no typography of its own, so these are
          the rows that give it some. They sit with 排版 rather than at the end,
          because they are the *same kind of setting* — how the text looks — and a
          reader looking for the indent should not have to scroll past the
          read-aloud controls to find it. They are absent for every other format,
          where the answer to all three is "whatever the book said". */}
      {state.showTxtRows ? (
        <>
          <SectionTitle>正文</SectionTitle>
          <SliderRow
            label="段落缩进"
            value={state.txtIndent}
            min={0}
            max={4}
            step={0.25}
            format={(value) => (value === 0 ? '无' : `${value.toFixed(2)} 字`)}
            onChange={(value) => handlers.onSetting({ txtIndent: value })}
          />
          <SliderRow
            label="段间距"
            value={state.txtParagraphGap}
            min={0}
            max={1.5}
            step={0.05}
            format={(value) => (value === 0 ? '无' : `${value.toFixed(2)} 字`)}
            onChange={(value) => handlers.onSetting({ txtParagraphGap: value })}
          />
          <SelectRow
            label="TXT 编码"
            options={[
              { value: '', label: '自动识别' },
              { value: 'utf-8', label: 'utf-8' },
              { value: 'gb18030', label: 'gb18030' },
              { value: 'big5', label: 'big5' },
              { value: 'utf-16le', label: 'utf-16le' },
            ]}
            value={state.txtEncoding}
            onChange={(value) => handlers.onSetting({ txtEncoding: value })}
          />
        </>
      ) : null}

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
      <IconButton label="上一句" icon="backward-step" onClick={handlers.onSpeechPrevious} />
      <IconButton
        label={state.state === 'playing' ? '暂停朗读' : '开始朗读'}
        icon={state.state === 'playing' ? 'pause' : 'play'}
        onClick={handlers.onSpeechToggle}
      />
      <IconButton label="下一句" icon="forward-step" onClick={handlers.onSpeechNext} />
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
      <IconButton label="停止朗读" icon="xmark" onClick={handlers.onStopSpeech} />
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

/**
 * One control in the top bar.
 *
 * An icon **over** a name, matching the reference: the label is not a tooltip and
 * not an `aria-label` alone, it is drawn, because the icons here are not universal
 * (a "目录" list glyph and a "设置" slider glyph read as the same thing when there
 * is no word under them). Centred, equal-width, and full-height so the whole
 * column of the bar is the target rather than the glyph.
 */
function TopButton({ icon, label, onClick }: { icon: IconName; label: string; onClick(): void }): JSX.Element {
  return (
    <button type="button" className="top-button" aria-label={label} onClick={onClick}>
      <span className="icon" aria-hidden="true">{iconGlyph(icon)}</span>
      <span className="top-button-label">{label}</span>
    </button>
  );
}

/**
 * One control on the immersion rail.
 *
 * Round, thumb-sized, and matched to the rail's own width: the rail is a column of
 * circles because a reader aiming at a 2.75rem disc in the margin hits it, while a
 * reader aiming at a 2.75rem square in a list of five does not.
 */
function RailButton({ icon, label, onClick }: { icon: IconName; label: string; onClick(): void }): JSX.Element {
  return (
    <button type="button" className="rail-button" aria-label={label} title={label} onClick={onClick}>
      <span className="icon" aria-hidden="true">{iconGlyph(icon)}</span>
    </button>
  );
}

/** The glyph for an icon name, from the generated code point table. */
function iconGlyph(name: IconName): string {
  return ICON_CODEPOINTS[name];
}

/**
 * A labelled quick-action tile.
 *
 * A tap rather than a slider for the three controls a reader nudges most: a slider
 * is the right control for "any value in this range" and the wrong one for "one
 * step bigger", which is what a reader actually wants when the text looks small.
 * The full range is still in the rows below, so the tile is a shortcut and never
 * the only way to reach a value.
 */
function QuickButton({
  icon,
  label,
  value,
  disabled,
  onClick,
}: {
  icon: IconName;
  label: string;
  value: string;
  disabled?: boolean;
  onClick(): void;
}): JSX.Element {
  return (
    <button
      type="button"
      className="quick-button"
      disabled={disabled}
      aria-label={`${label} ${value}`}
      onClick={onClick}
    >
      <span className="icon" aria-hidden="true">{iconGlyph(icon)}</span>
      <span className="quick-label">{label}</span>
      <span className="quick-value">{value}</span>
    </button>
  );
}

/** The next font scale in the ladder, so a tap lands on a round percentage. */
const FONT_SCALE_LADDER = [0.8, 0.9, 1, 1.1, 1.25, 1.4, 1.6, 1.8, 2.0, 2.2];

function stepFontScale(current: number, direction: 1 | -1): number {
  const index = FONT_SCALE_LADDER.findIndex((value) => value >= current - 0.001);
  const at = index === -1 ? FONT_SCALE_LADDER.length - 1 : index;
  const next = Math.min(FONT_SCALE_LADDER.length - 1, Math.max(0, at + direction));
  return FONT_SCALE_LADDER[next] ?? current;
}

/** Paragraph indent, cycling 无 → 1 → 2 → 3 → 4 characters and back. */
const INDENT_LADDER = [0, 1, 2, 3, 4];

function stepIndent(current: number): number {
  const index = INDENT_LADDER.findIndex((value) => value > current + 0.001);
  return index === -1 ? INDENT_LADDER[0]! : INDENT_LADDER[index]!;
}

/** Paragraph spacing, cycling in quarter-character steps and back to none. */
const GAP_LADDER = [0, 0.25, 0.5, 0.75, 1, 1.25];

function stepGap(current: number): number {
  const index = GAP_LADDER.findIndex((value) => value > current + 0.001);
  return index === -1 ? GAP_LADDER[0]! : GAP_LADDER[index]!;
}

function indentLabel(indent: number): string {
  return indent === 0 ? '无' : `${indent.toFixed(2)} 字`;
}

const THEME_LADDER: Array<AppSettings['theme']> = ['light', 'sepia', 'dark'];

const THEME_LABELS: Record<string, string> = { light: '白', sepia: '米黄', dark: '夜间' };

function nextTheme(theme: AppSettings['theme']): AppSettings['theme'] {
  const index = THEME_LADDER.indexOf(theme);
  return THEME_LADDER[(index + 1) % THEME_LADDER.length] ?? 'light';
}

/** The progress fraction as a percentage, clamped. */
function percentOf(fraction: number): string {
  return `${Math.round(Math.min(1, Math.max(0, fraction)) * 100)}%`;
}

export type { SpeechEngineKind };
