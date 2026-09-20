/**
 * The UI review: render the real screen, screenshot it, and measure it.
 *
 * ## Why this exists
 *
 * The end-to-end suite asserts *function*: a tap opens the panel, a swipe turns the
 * page. Every one of those assertions was green while the panel covered the whole
 * page, the footer's page count disagreed with the presses remaining, and the
 * status line shoved the text down a line whenever it appeared. None of those is a
 * functional failure and all of them are visible on a screenshot, which is what
 * "端到端测试需要进行 UI 评审" is asking for.
 *
 * So this tool does two things and needs both:
 *
 *  1. **Screenshots** for a person to look at. There is no assertion that replaces
 *     this step; a layout that is merely ugly is not a test failure and is still a
 *     defect.
 *  2. **Measurements** for the assertions a person should not have to make by eye:
 *     does the panel leave the page visible, is a control inside its own touch
 *     target, does a status change move the text. These run in CI and fail the
 *     build, because a reviewer looking at a screenshot cannot be in the pipeline.
 *
 * Everything is measured on the *production bundle* served over HTTP against a
 * stand-in API, in a real Chromium at phone size.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CDP } from './cdp.mjs';
import { createReviewServer, ILLUSTRATED_ID } from './server.mjs';

const here = fileURLToPath(new URL('.', import.meta.url));
const outDir = join(here, '..', '..', '..', 'docs', 'ui-review');

/** Phone size, which is the size this product is actually used at. */
const VIEWPORT = { width: 390, height: 844 };
const SCALE = 2;

const SCENES = [
  { name: '01-shelf', label: '书架', what: '第一屏：先看到书，再看到控件' },
  { name: '02-reader', label: '阅读页', what: '顶栏（图标+文字）/ 右侧快捷列 / 正文 / 底栏「章节内页数」滑杆与上一章下一章', openBook: true },
  { name: '03-reader-no-chrome', label: '阅读页 · 收起工具栏', what: '顶栏、底栏、快捷列一起收起，正文占满，只留章节与页码读数', openBook: true, tapCenter: true },
  { name: '04-panel-toc', label: '目录 · 半屏', what: '下半屏，上半屏正文仍可见', openBook: true, openPanel: '目录' },
  { name: '05-panel-settings', label: '阅读设置 · 半屏', what: '一行式行：标签在左、控件在右', openBook: true, openPanel: '设置' },
  { name: '06-reader-paged', label: '阅读页 · 翻页模式', what: '分栏后的一页，页数应与可翻次数一致', openBook: true, choose: ['设置', '翻页'], closePanel: true },
  { name: '07-reader-sepia', label: '阅读页 · 米黄', what: '主题切换后的同一页', openBook: true, theme: '米黄' },
  { name: '08-reader-dark', label: '阅读页 · 夜间', what: '暗色下的正文与工具栏', openBook: true, theme: '夜间' },
  {
    name: '09-panel-txt',
    label: 'TXT · 正文排版',
    what: '纯文本专属的缩进/段间距/编码三行，且面板仍是半屏',
    openBook: true,
    openPanel: '设置',
  },
  // The two list screens, as a reader flips between them.
  //
  // They are separate routes now — the shelf shows the books you *have*, the library
  // shows the files the server *has* — and each is paginated. Both facts are exactly
  // the kind that pass every functional assertion while looking wrong: a pager that
  // is off the bottom of the screen, a switch that reads as a filter, a page number
  // nobody can see because it is muted to the colour of the paper.
  {
    name: '10-shelf-paged',
    label: '书架 · 第二页',
    what: '没有「继续阅读」横排；默认按最近阅读排序（第一个 chip 是填充态）；分页器在封面下方；书库入口在标题右侧',
    openShelfAt: '#/shelf/2',
  },
  {
    name: '11-library',
    label: '书库 · 浏览',
    what: '书库是读者那一半：约等于商城的布局——搜索框在最上面，封面网格铺满窗口，「加入书架」只画在不在书架的书上，右上角是文件管理入口和封面大小',
    openLibraryAt: '#/library',
  },
  {
    name: '12-library-files',
    label: '书库 · 文件管理',
    what: '另一半、也是管理员那一页：面包屑 + 文件行、「书籍」徽章、不在书架的书带「不在书架」标记，右上角是上传/新建，左上是回浏览页的入口',
    openLibraryAt: '#/library/files',
    // A folder is walked from the file page, so this scene *is* the switch — see the
    // note in the driver.
    folder: 'folder',
    page: 2,
  },
  {
    name: '17-shelf-unshelve',
    label: '书架 · 从书架拿掉',
    what: '封面右上角的「⋯」打开后的动作菜单，以及「从书架拿掉」的确认框：写清只是从书架拿掉、磁盘上的文件不动',
    shelfMenu: true,
  },
  {
    name: '15-library-preview-shelve',
    label: '书库 · 浏览 · 上架',
    what: '点了某本书的「加入书架」之后：报告、目录重读，以及角标消失的那一本',
    openLibraryAt: '#/library',
    shelveFirst: true,
  },
  {
    name: '16-library-search',
    label: '书库 · 浏览 · 搜索',
    what: '商城式布局的搜索框：输入之后 URL 带上查询、网格只剩匹配的书，字段两边的留白让控件不贴着封面',
    openLibraryAt: '#/library',
    search: '第2卷',
  },
  {
    name: '13-reader-paged-scrub',
    label: '阅读页 · 滑杆拖到本章第 3 页',
    what: '分栏模式下拖动底部滑杆：读数与画面都停在本章内，不换章',
    openBook: true,
    choose: ['设置', '翻页'],
    closePanel: true,
    scrubPage: 3,
  },
  {
    name: '14-reader-epub-image',
    label: 'EPUB · 插图',
    what: '章节文档里的图片真的画出来了，而不是浏览器的破图占位符；比页面宽的那张也在栏内',
    openBook: true,
    book: 'review-illustrated',
  },
];

const LABEL_OF = `
  // A control's visible words when it has any, and its accessible name otherwise.
  //
  // The two are not the same field and neither alone is enough: an IconTextButton puts
  // its label in a span beside the glyph, and an IconButton has no words at all — only
  // an aria-label. Reading \`textContent\` gets the glyph mixed in (an icon is a
  // private-use character, so the raw text of a labelled button is "\ue927浏览书籍"),
  // and reading only the glyph span gets an empty string for the icon-only ones.
  const labelOf = (node) => {
    const words = [...node.querySelectorAll('span')]
      .map((span) => span.textContent.trim())
      .filter((text) => text.length > 0 && [...text].every((ch) => ch.codePointAt(0) < 0xe000));
    return words.join(' ') || node.getAttribute('aria-label') || '';
  };
`;

/** Measurements that must hold, on the scenes where they apply. */
async function audit(cdp, origin, scenes, results) {
  const failures = [];

  const check = (name, ok, detail) => {
    results.push({ name, ok, detail });
    if (!ok) failures.push(`${name}: ${detail}`);
  };

  // The chrome is one state, not two *or three*.
  //
  // The request behind this is specific — the top bar and the bottom bar hide
  // together — and the failure it guards against is the one a reader reports as
  // "只收起了一半": a header that leaves the text full height while a footer keeps
  // covering the last two lines. So the collapse is asserted on both bands and on
  // the space they occupied, in the state where the reader asked for immersion.
  //
  // The rail is the third band, and the follow-up report was that it *didn't* go
  // with them: shown only while the chrome was hidden, it was the one piece of
  // chrome that survived immersion, so a reader who tapped to get "just the page"
  // still had a floating column over the text. It is asserted in both directions
  // here — present with the bars, gone with the bars — because a control that only
  // ever appears is exactly the state that was reported.
  //
  // Asked for the way the reader asks for it (a tap on the middle third) rather than
  // by setting the attribute: the tap is also a thing that has to keep working.
  await cdp.sleep(300);
  // The chapter's first block, with the chrome up. Held so the assertion below can
  // compare it against the same measurement taken with the chrome hidden.
  const visibleChromeTextTop = await cdp.evaluate(`(() => {
    const flow = document.querySelector('book-content')?.shadowRoot?.querySelector('.book-flow');
    const first = flow?.querySelector('p, h1, h2, h3');
    return first ? Math.round(first.getBoundingClientRect().top) : null;
  })()`);
  const visibleChrome = await cdp.evaluate(`(() => {
    const rail = document.querySelector('.reader-rail');
    if (!rail) return { missing: true };
    const r = rail.getBoundingClientRect();
    return {
      present: true,
      visible: getComputedStyle(rail).visibility !== 'hidden' && r.width > 0 && r.height > 0,
      buttons: rail.querySelectorAll('button').length,
      pointerEvents: getComputedStyle(rail).pointerEvents,
    };
  })()`);
  check(
    '展开工具栏: 快捷按钮与两条栏一起出现',
    !visibleChrome.missing && visibleChrome.visible && visibleChrome.buttons > 0 && visibleChrome.pointerEvents !== 'none',
    visibleChrome.missing
      ? '没有找到快捷按钮列'
      : `visible=${visibleChrome.visible} 按钮 ${visibleChrome.buttons} 个 pointer-events=${visibleChrome.pointerEvents}`,
  );

  /*
   * The rail holds the two adjustments a reader makes *from the page* plus 听书, and
   * nothing that opens a sheet.
   *
   * The report is "竖排工具栏去掉 目录、字体、行距、边距、设置这几个按钮", and the
   * reasoning behind it is the one worth keeping in a comment: all five are
   * *destinations*, not adjustments — 目录 and 设置 open a sheet, and 字体/行距/边距 are
   * steps of values whose full range lives in that sheet — so a rail that also carried
   * them was a second, worse copy of the settings panel floating over the text. What
   * is left is what a reader changes without wanting to open anything.
   *
   * The column still has to stay inside the page however short the screen is, and the
   * controls it cannot fit still have to be reachable — the column scrolls, and it
   * looks scrollable, because a control that can only be found by scrolling has to
   * advertise the scroll or it does not exist as far as the reader is concerned.
   */
  const rail = await cdp.evaluate(`(() => {
    const el = document.querySelector('.reader-rail');
    if (!el) return { missing: true };
    const r = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    const labels = [...el.querySelectorAll('button')].map((b) => b.getAttribute('aria-label') ?? '');
    return {
      labels,
      top: r.top,
      bottom: r.bottom,
      viewport: window.innerHeight,
      inside: r.bottom <= window.innerHeight + 1 && r.top >= -1,
      scrollable: style.overflowY === 'auto' || style.overflowY === 'scroll',
      overflows: el.scrollHeight - el.clientHeight > 1,
      scrollbarWidth: el.offsetWidth - el.clientWidth,
    };
  })()`);
  check(
    '快捷列: 整组控件都在页内',
    !rail.missing && rail.inside,
    rail.missing ? '没有找到快捷按钮列' : `列 y=${Math.round(rail.top)}..${Math.round(rail.bottom)} / 屏高 ${rail.viewport}`,
  );
  check(
    '快捷列: 装不下的控件有滚动条，说明还有更多',
    !rail.missing && (!rail.overflows || (rail.scrollable && rail.scrollbarWidth > 0)),
    rail.missing
      ? '没有找到快捷按钮列'
      : `溢出 ${rail.overflows ? '是' : '否'} overflow-y=${rail.scrollable} 滚动条 ${rail.scrollbarWidth}px`,
  );
  check(
    '快捷列: 只留页面内就能完成的调整',
    !rail.missing &&
      rail.labels.includes('听书') &&
      rail.labels.some((label) => label === '夜间' || label === '日间') &&
      rail.labels.includes('字号'),
    rail.missing ? '没有找到快捷按钮列' : `按钮 ${rail.labels.length} 个：${rail.labels.join(' / ')}`,
  );
  // The five the report asked to remove. Asserted by *name* rather than by count,
  // because "four controls" would pass on a rail that had dropped the wrong one.
  check(
    '快捷列: 不含打开面板的五个入口',
    !rail.missing && !rail.labels.some((label) => ['目录', '字体', '行距', '页边距', '设置', '阅读设置'].includes(label)),
    rail.missing ? '没有找到快捷按钮列' : `列内控件：${rail.labels.join(' / ')}`,
  );
  // The read-aloud control is on the rail, which is the report's own example
  // ("听书"). It matters because it is the one adjustment a reader makes *without*
  // leaving the page: reaching it only through the settings sheet is a different
  // product.
  check(
    '快捷列: 听书在列内',
    !rail.missing && rail.labels.includes('听书'),
    rail.missing ? '没有找到快捷按钮列' : `列内控件：${rail.labels.join(' / ')}`,
  );

  /*
   * The same column on a short screen, which is the screen the report came from.
   *
   * A phone in landscape, or a phone whose browser chrome and status bar leave it
   * 520px of page, is where a column with no height ceiling stops showing its own
   * contents — and it is the case a review at a single 844px portrait size can never
   * see. Asserted by *scrolling the column* and asking where the last control ended
   * up, rather than by reading `overflow-y` back: the CSS is a claim about intent and
   * this is a claim about the reader being able to reach the control.
   */
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 420, deviceScaleFactor: 2, mobile: true });
  await cdp.sleep(400);
  const shortRail = await cdp.evaluate(`(() => {
    const el = document.querySelector('.reader-rail');
    if (!el) return { missing: true };
    const r = el.getBoundingClientRect();
    const buttons = [...el.querySelectorAll('button')];
    el.scrollTop = el.scrollHeight;
    const last = buttons[buttons.length - 1]?.getBoundingClientRect();
    const col = el.getBoundingClientRect();
    return {
      bottom: r.bottom,
      viewport: window.innerHeight,
      inside: r.bottom <= window.innerHeight + 1,
      reachable: last ? last.bottom <= col.bottom + 1 && last.top >= col.top - 1 : false,
      count: buttons.length,
      scrollbarWidth: el.offsetWidth - el.clientWidth,
    };
  })()`);
  check(
    '快捷列(420px 短屏): 列在页内，超出的控件能滚到',
    !shortRail.missing && shortRail.inside && shortRail.reachable,
    shortRail.missing
      ? '没有找到快捷按钮列'
      : `列底 ${Math.round(shortRail.bottom)} / 屏高 ${shortRail.viewport}，滚动条 ${shortRail.scrollbarWidth}px，`
        + `滚到底后末个控件可见=${shortRail.reachable}`,
  );
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: VIEWPORT.width, height: VIEWPORT.height, deviceScaleFactor: SCALE, mobile: true });
  await cdp.sleep(300);

  await cdp.tapMiddle();
  await cdp.sleep(700);
  const hidden = await cdp.evaluate(`(() => {
    const screen = document.querySelector('.reader-screen');
    const topbar = document.querySelector('.topbar');
    const footer = document.querySelector('.footer');
    const stage = document.querySelector('.stage');
    if (!screen || !topbar || !footer || !stage) return { missing: true };
    const t = topbar.getBoundingClientRect();
    const f = footer.getBoundingClientRect();
    const s = stage.getBoundingClientRect();
    return {
      attribute: screen.dataset.chrome,
      topbarHeight: Math.round(t.height),
      footerHeight: Math.round(f.height),
      topbarVisibility: getComputedStyle(topbar).visibility,
      footerVisibility: getComputedStyle(footer).visibility,
      topbarPointerEvents: getComputedStyle(topbar).pointerEvents,
      footerPointerEvents: getComputedStyle(footer).pointerEvents,
      topbarPosition: getComputedStyle(topbar).position,
      footerPosition: getComputedStyle(footer).position,
      stageTop: Math.round(s.top),
      stageBottom: Math.round(s.bottom),
      viewportHeight: window.innerHeight,
      textTop: (() => {
        const flow = document.querySelector('book-content')?.shadowRoot?.querySelector('.book-flow');
        const first = flow?.querySelector('p, h1, h2, h3');
        return first ? Math.round(first.getBoundingClientRect().top) : null;
      })(),
      rail: (() => {
        const el = document.querySelector('.reader-rail');
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return {
          present: true,
          visible: getComputedStyle(el).visibility !== 'hidden' && r.width > 0 && r.height > 0,
          pointerEvents: getComputedStyle(el).pointerEvents,
        };
      })(),
      indicator: (() => {
        const el = document.querySelector('.reading-indicator');
        if (!el) return null;
        const r = el.getBoundingClientRect();
        const chapter = el.querySelector('.indicator-chapter');
        const progress = el.querySelector('.indicator-progress');
        return {
          visible: getComputedStyle(el).visibility !== 'hidden' && r.height > 0,
          pointerEvents: getComputedStyle(el).pointerEvents,
          chapter: chapter ? chapter.textContent.trim() : '',
          progress: progress ? progress.textContent.trim() : '',
        };
      })(),
    };
  })()`);
  const hiddenTextTop = hidden.missing ? null : hidden.textTop;
  check(
    '收起工具栏: 顶栏与底栏一起走',
    !hidden.missing && hidden.attribute === 'hidden' && hidden.topbarVisibility === 'hidden' && hidden.footerVisibility === 'hidden',
    hidden.missing ? '没有找到阅读页' : `state=${hidden.attribute} 顶栏 ${hidden.topbarVisibility} / 底栏 ${hidden.footerVisibility}`,
  );
  check(
    '收起工具栏: 两条栏都不可见，也不可点',
    !hidden.missing && hidden.topbarPointerEvents === 'none' && hidden.footerPointerEvents === 'none',
    hidden.missing ? 'n/a' : `topbar=${hidden.topbarPointerEvents} footer=${hidden.footerPointerEvents}`,
  );
  // The page is the screen in *both* states, and the property asserted is the one
  // the reader reported: showing or hiding the chrome must not move a single line.
  // It has to be measured on the *chapter's own first block* — the element the
  // reader is reading — and compared against the same measurement taken with the
  // chrome visible.
  check(
    '收起工具栏: 正文一行的位置不变（工具栏是浮层）',
    !hidden.missing && visibleChromeTextTop !== null && hiddenTextTop !== null && Math.abs(hiddenTextTop - visibleChromeTextTop) <= 1,
    hidden.missing || visibleChromeTextTop === null || hiddenTextTop === null
      ? 'n/a'
      : `正文首行 y: 显示时 ${visibleChromeTextTop} / 收起后 ${hiddenTextTop}`,
  );
  // And the page *fills* the screen, which is the other half of the report:
  // "内容要铺满，不要预留 stage". The stage used to carry the bars' own heights as
  // `padding-block`, so the reading column was permanently 9rem shorter than the
  // phone in *both* chrome states — a reader who had hidden the toolbar and wanted
  // the whole screen for the book still lost the top and bottom bands to empty
  // paper. Measured as "the stage reserves no block padding", which is the cause,
  // rather than as "the text reaches the edge", which a chapter's own margin makes
  // false.
  const stageBox = await cdp.evaluate(`(() => {
    const stage = document.querySelector('.stage-host');
    const host = document.querySelector('.stage');
    if (!stage || !host) return null;
    const style = getComputedStyle(stage);
    return {
      paddingTop: parseFloat(style.paddingTop) || 0,
      paddingBottom: parseFloat(style.paddingBottom) || 0,
      stageTop: Math.round(host.getBoundingClientRect().top),
      stageBottom: Math.round(host.getBoundingClientRect().bottom),
      viewport: window.innerHeight,
    };
  })()`);
  check(
    '正文铺满: 页面不为工具栏预留高度',
    stageBox !== null &&
      stageBox.paddingTop <= 0.5 &&
      stageBox.paddingBottom <= 0.5 &&
      stageBox.stageBottom - stageBox.stageTop >= stageBox.viewport - 2,
    stageBox === null
      ? 'n/a'
      : `padding ${stageBox.paddingTop}/${stageBox.paddingBottom}px, 页面 ${stageBox.stageBottom - stageBox.stageTop}px / 屏高 ${stageBox.viewport}`,
  );
  // The bars float over the page, so they must be *positioned* — a bar back in the
  // flow is a bar that takes height out of the page and moves the text, which is the
  // whole of the reported defect. Asserted on the computed `position` rather than on
  // the text not moving, because the two are different facts: a bar could be in flow
  // and the text still not move if something else absorbed the height, and the next
  // person to touch this layout needs the reason to be the assertion.
  check(
    '工具栏是浮动层，不占正文的高度',
    !hidden.missing && hidden.topbarPosition === 'absolute' && hidden.footerPosition === 'absolute',
    hidden.missing ? 'n/a' : `topbar=${hidden.topbarPosition} footer=${hidden.footerPosition}`,
  );
  // The rail goes with the bars, in this direction too. `visibility: hidden` is
  // asserted rather than merely "height is zero", because a control a finger can
  // still land on is a control that is still there — and the state being guarded
  // against is precisely "the rail outlived the toolbar".
  check(
    '收起工具栏: 快捷按钮跟着两条栏一起收',
    !hidden.missing && hidden.rail !== null && !hidden.rail.visible && hidden.rail.pointerEvents === 'none',
    hidden.missing
      ? 'n/a'
      : hidden.rail
        ? `visible=${hidden.rail.visible} pointer-events=${hidden.rail.pointerEvents}`
        : '没有找到快捷按钮列',
  );
  // Immersion keeps the *where am I* readouts. Hiding the chrome should leave a
  // reader who knows which chapter they are in and how far through — not a blank
  // screen they have to tap to interrogate.
  check(
    '收起工具栏: 保留章节与页码指示',
    !hidden.missing &&
      hidden.indicator !== null &&
      hidden.indicator.visible &&
      hidden.indicator.chapter.length > 0 &&
      hidden.indicator.progress.length > 0,
    hidden.missing
      ? 'n/a'
      : hidden.indicator
        ? `chapter="${hidden.indicator.chapter}" progress="${hidden.indicator.progress}"`
        : '没有找到阅读指示',
  );
  // The indicator is a readout, not a control: a tap on it has to fall through to
  // the page-turning zone underneath, or hiding the chrome would create a dead band.
  check(
    '收起工具栏: 阅读指示不吃手势',
    !hidden.missing && hidden.indicator !== null && hidden.indicator.pointerEvents === 'none',
    hidden.missing ? 'n/a' : `pointer-events=${hidden.indicator?.pointerEvents ?? 'missing'}`,
  );
  // The two readouts left on screen in immersion must not be *covered*, and the
  // report is specific: the chapter name and the page count were painted over by
  // the chapter's own text.
  //
  // Measured as **paint order**, not as a hit test, and the difference is the whole
  // difficulty of the check. The readouts are `pointer-events: none` — deliberately,
  // so a tap on the chapter name turns the page rather than being swallowed — and
  // `elementFromPoint` skips anything that opts out of hit testing, so a hit test
  // can *never* see them and would report "covered" for a readout drawn on top of
  // everything. What the browser actually does is paint the two boxes in order, and
  // the number that decides the order is the `z-index` the two boxes *resolve to*
  // within the screen's stacking context. So that is what is compared.
  //
  // This is how the defect was possible at all: the reading surface is a positioned
  // sibling and it comes *later* in the tree, so with neither box declaring a
  // `z-index` the page was painted last — over the two numbers describing it.
  const indicator = await cdp.evaluate(`(() => {
    const root = document.querySelector('.reader-screen');
    const host = document.querySelector('.book-host');
    if (!root || !host) return { missing: true };
    // The z-index each of the four boxes resolves to, taken from the nearest box
    // that declares one — which is how the browser answers the same question.
    const effective = (node) => {
      let current = node;
      while (current && current !== root) {
        const value = getComputedStyle(current).zIndex;
        if (value !== 'auto' && value !== '') return Number(value);
        current = current.parentElement;
      }
      return 0;
    };
    const out = { page: effective(host) };
    for (const [name, selector] of [['chapter', '.indicator-chapter'], ['progress', '.indicator-progress']]) {
      const el = document.querySelector(selector);
      if (!el) { out[name] = { missing: true }; continue; }
      const r = el.getBoundingClientRect();
      out[name] = {
        text: el.textContent.trim(),
        top: Math.round(r.top),
        bottom: Math.round(r.bottom),
        left: Math.round(r.left),
        layer: effective(el),
        // The paper behind the label, so a line of the chapter underneath cannot
        // show through the number the reader is trying to read.
        background: getComputedStyle(el).backgroundColor,
      };
    }
    return out;
  })()`);
  for (const [name, label] of [['chapter', '章节名'], ['progress', '页码读数']]) {
    const reading = indicator[name];
    check(
      `收起工具栏: ${label}画在正文之上`,
      !reading?.missing && !indicator.missing && reading.layer > indicator.page,
      indicator.missing || reading?.missing
        ? '没有找到阅读指示或阅读面'
        : `层级 ${reading.layer} vs 正文 ${indicator.page}，y=${reading.top}..${reading.bottom} 文本="${reading.text}"`,
    );
    check(
      `收起工具栏: ${label}自带底色，不被正文透出`,
      !reading?.missing && reading.background !== 'rgba(0, 0, 0, 0)' && reading.background !== 'transparent',
      reading?.missing ? '没有找到阅读指示' : `background=${reading.background}`,
    );
  }
  // Both readouts are at the *same* left edge, and that edge is inset from the
  // screen: two lines stacked at the bottom of a page are read as one column, and
  // the page count used to sit 4px to the right of the chapter name above it.
  const indicatorAligned = await cdp.evaluate(`(() => {
    const a = document.querySelector('.indicator-chapter')?.getBoundingClientRect();
    const b = document.querySelector('.indicator-progress')?.getBoundingClientRect();
    if (!a || !b) return null;
    return { chapterLeft: Math.round(a.left), progressLeft: Math.round(b.left) };
  })()`);
  check(
    '收起工具栏: 章节名与页码左边对齐',
    indicatorAligned !== null && Math.abs(indicatorAligned.chapterLeft - indicatorAligned.progressLeft) <= 1,
    indicatorAligned
      ? `章节名 left=${indicatorAligned.chapterLeft} 页码 left=${indicatorAligned.progressLeft}`
      : '没有找到阅读指示',
  );

  // "reading-indicator 应该是紧贴顶部/底部，并且占用一整行".
  //
  // Both halves of that are geometry, and both were wrong: each readout was a paper
  // pill the width of its own words, floated ~10px inside the edge. A pill ends
  // wherever the words end, so the chapter name and the page count had two different
  // right edges, and neither reached the edge of the glass. The row is what makes them
  // read as something the screen drew rather than as fragments of the page, so it is
  // asserted as three numbers: full width, flush to its own edge, and one row each.
  const indicatorRows = await cdp.evaluate(`(() => {
    const stage = document.querySelector('.stage')?.getBoundingClientRect();
    const a = document.querySelector('.indicator-chapter')?.getBoundingClientRect();
    const b = document.querySelector('.indicator-progress')?.getBoundingClientRect();
    if (!stage || !a || !b) return null;
    return {
      width: Math.round(stage.width),
      chapter: { top: Math.round(a.top), left: Math.round(a.left), width: Math.round(a.width) },
      progress: { bottom: Math.round(b.bottom), right: Math.round(b.right), width: Math.round(b.width) },
      viewportBottom: window.innerHeight,
    };
  })()`);
  check(
    '收起工具栏: 章节名占满一整行并紧贴顶部',
    indicatorRows !== null &&
      Math.abs(indicatorRows.chapter.width - indicatorRows.width) <= 1 &&
      indicatorRows.chapter.top <= 1 &&
      indicatorRows.chapter.left <= 1,
    indicatorRows
      ? `行 ${indicatorRows.chapter.width}px / 屏宽 ${indicatorRows.width}，top=${indicatorRows.chapter.top}`
      : '没有找到阅读指示',
  );
  check(
    '收起工具栏: 页码占满一整行并紧贴底部',
    indicatorRows !== null &&
      Math.abs(indicatorRows.progress.width - indicatorRows.width) <= 1 &&
      Math.abs(indicatorRows.progress.bottom - indicatorRows.viewportBottom) <= 1 &&
      indicatorRows.progress.right >= indicatorRows.width - 1,
    indicatorRows
      ? `行 ${indicatorRows.progress.width}px / 屏宽 ${indicatorRows.width}，bottom=${indicatorRows.progress.bottom}/${indicatorRows.viewportBottom}`
      : '没有找到阅读指示',
  );

  // A tap in an outer third pages, and *only* pages.
  //
  // The report is "在点击左右两边时只需要翻页、不需要显示工具栏，只有在中间点击时才需要
  // 切换工具栏显隐", and it is one tap described from both of the directions it can
  // fail. The outer thirds used to page-turn *and* force the chrome back while it
  // was hidden, on the reasoning that a hidden bar leaves no other way back — so the
  // immersive state was impossible to stay in, because every page turn undid it.
  // Both halves have to be asserted: a check on the page number alone passes on the
  // behaviour that was reported, and so does a check on the chrome alone.
  //
  // The chrome is hidden first, so the assertion is about a state the reader can
  // actually be in, and the page readout is read before and after.
  const beforeThird = await cdp.evaluate(
    `(() => ({ chrome: document.querySelector('.reader-screen').dataset.chrome, page: document.querySelector('.progress-page')?.textContent ?? '', value: Number(document.querySelector('.progress-scrubber')?.value ?? '0') }))()`,
  );
  await cdp.tapThird(0.85);
  await cdp.sleep(600);
  const afterThird = await cdp.evaluate(
    `(() => ({ chrome: document.querySelector('.reader-screen').dataset.chrome, page: document.querySelector('.progress-page')?.textContent ?? '', value: Number(document.querySelector('.progress-scrubber')?.value ?? '0') }))()`,
  );
  check(
    '点右侧只翻页: 页码前进, 工具栏保持收起',
    afterThird.chrome === 'hidden' && beforeThird.chrome === 'hidden' && afterThird.value > beforeThird.value,
    `收起前 ${beforeThird.chrome}(${beforeThird.page}) → 点击后 ${afterThird.chrome}(${afterThird.page})`,
  );

  // The middle third is the only way back to the controls, so it is asserted as
  // such right after: the outer-third check above leaves the chrome hidden, and the
  // panel checks below need it up.
  await cdp.tapMiddle();
  await cdp.sleep(600);
  const afterMiddle = await cdp.evaluate(`document.querySelector('.reader-screen').dataset.chrome`);
  check('点中间切换工具栏', afterMiddle === 'visible', `点击中间后 ${afterMiddle}`);

  // A page turn must not lose the offset it just moved to.
  //
  // The report is "虽然有左右翻页的动画，但是动画结束后又有一个重新渲染章节内容并滚动到
  // 下一页的动画": a slide, then the page jumping to where it was always going. The cause
  // was the clip on `data-animating` — it sat on `.book-flow`, which *is* the horizontal
  // scroller in paged mode, so setting the attribute replaced the scroll container with
  // one that cannot scroll and discarded `scrollLeft`. The animation played over the old
  // page, and the offset came back a frame after the attribute was cleared.
  //
  // Asserted by *holding the attribute* rather than by racing the animation: the offset
  // has to survive the animating state itself, which is the property, and a timing check
  // would only catch it on a machine slow enough to observe the wrong frame. The reader
  // is switched to 翻页 mode first, because that is the mode whose scroller is the flow.
  // The chrome is visible here — the check just above put it there — so the settings
  // button is on screen and can be clicked.
  await cdp.click('button[aria-label="设置"]');
  await cdp.waitFor('document.querySelector(".panel") !== null');
  await cdp.clickText('.segmented button', '翻页');
  await cdp.sleep(300);
  await cdp.click('button[aria-label="关闭"]');
  await cdp.sleep(400);
  const turnKeepsOffset = await cdp.run(`
    const host = document.querySelector('book-content');
    const flow = host.shadowRoot.querySelector('.book-flow');
    if (!flow) return { missing: true };
    // Move to the second page by the same arithmetic the turn uses, then hold the
    // animating state the way the turn does and read the offset back.
    flow.scrollLeft = flow.clientWidth;
    const target = Math.round(flow.scrollLeft);
    host.setAttribute('data-animating', 'slide-next-x');
    const during = Math.round(flow.scrollLeft);
    const overflow = getComputedStyle(flow).overflow;
    host.removeAttribute('data-animating');
    const after = Math.round(flow.scrollLeft);
    flow.scrollLeft = 0;
    return { target, during, after, overflow };
  `);
  check(
    '翻页: 动画期间不丢滚动位置（动画后不再跳页）',
    !turnKeepsOffset.missing && turnKeepsOffset.during === turnKeepsOffset.target && turnKeepsOffset.target > 0,
    turnKeepsOffset.missing
      ? '没有找到阅读面'
      : `目标 ${turnKeepsOffset.target} → 动画中 ${turnKeepsOffset.during} → 动画后 ${turnKeepsOffset.after}，overflow=${turnKeepsOffset.overflow}`,
  );

  for (const scene of scenes) {
    if (scene.openPanel) {
      // Opened here rather than assumed open: the chrome checks above interact with
      // the page, and a sheet they left behind would make the tap that hides the
      // chrome land on the sheet's backdrop instead.
      await cdp.click(`button[aria-label="${scene.openPanel}"]`);
      await cdp.waitFor('document.querySelector(".panel") !== null', 10_000);
      await cdp.sleep(400);
      const geometry = await cdp.evaluate(`(() => {
        const panel = document.querySelector('.panel');
        const scrim = document.querySelector('.scrim');
        const stage = document.querySelector('.stage');
        if (!panel) return null;
        const p = panel.getBoundingClientRect();
        const s = stage.getBoundingClientRect();
        return {
          panelTop: p.top,
          panelHeight: p.height,
          stageTop: s.top,
          stageHeight: s.height,
          hasScrim: !!scrim,
          grip: !!document.querySelector('.panel-grip'),
          visibleText: p.top - s.top,
        };
      })()`);
      check(
        `${scene.name}: 面板不遮住整页`,
        geometry !== null && geometry.panelTop > geometry.stageTop + 60,
        geometry ? `面板从 y=${Math.round(geometry.panelTop)} 开始，正文区 y=${Math.round(geometry.stageTop)}` : '没有找到 .panel',
      );
      check(
        `${scene.name}: 面板留出可预览的正文`,
        geometry !== null && geometry.visibleText >= 120,
        geometry ? `正文可见高度 ${Math.round(geometry.visibleText)}px` : 'n/a',
      );
      check(
        `${scene.name}: 面板有遮罩和把手`,
        geometry !== null && geometry.hasScrim && geometry.grip,
        geometry ? `scrim=${geometry.hasScrim} grip=${geometry.grip}` : 'n/a',
      );
      check(
        `${scene.name}: 面板高度不超过阅读区`,
        geometry !== null && geometry.panelHeight <= geometry.stageHeight * 0.9,
        geometry ? `面板 ${Math.round(geometry.panelHeight)}px / 阅读区 ${Math.round(geometry.stageHeight)}px` : 'n/a',
      );
    }
  }

  // The footer scrubber has to be a real control: visible, at least the width of a
  // thumb, reachable by keyboard, and labelled. A progress bar that only *reports*
  // is the thing this replaced, so the check is that it can be dragged.
  // Two rows of one band must share an inset, and the top bar must share it too.
  //
  // The report had two halves — "底部页面数和进度需要两边对齐" and "顶部栏三个按钮需要
  // 两边对齐" — and both are the same question asked of two bands: are the outermost
  // things at the two edges the same distance in? They were three numbers (0.35rem,
  // 0.75rem, 0.75rem plus a button's own 0.4rem of padding), so nothing lined up
  // with anything and the frame around the page was visibly ragged.
  //
  // Asserted on *measured edges*, not on the CSS: the values have to end up equal
  // after every padding and margin has been applied, and reading the declaration
  // back would pass while a nested control still sat somewhere else.
  const bandGaps = await cdp.evaluate(`(() => {
    const viewport = document.documentElement.clientWidth;
    const gap = (selector, edge) => {
      const el = document.querySelector(selector);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return Math.round(edge === 'left' ? r.left : viewport - r.right);
    };
    const buttons = [...document.querySelectorAll('.topbar .top-button')].map((b) => b.getBoundingClientRect());
    return {
      // Top bar: the outermost buttons' own edges, and the two gaps between the
      // three of them (which is what makes the row symmetric rather than merely
      // spread out).
      topbarLeft: buttons.length > 0 ? Math.round(buttons[0].left) : null,
      topbarRight: buttons.length > 0 ? Math.round(viewport - buttons[buttons.length - 1].right) : null,
      topbarGap: buttons.length === 3 ? Math.round(buttons[1].left - buttons[0].right) : null,
      topbarGap2: buttons.length === 3 ? Math.round(buttons[2].left - buttons[1].right) : null,
      // Footer: the two readouts the reader asked to have aligned.
      pageRight: gap('.progress-page', 'right'),
      nextRight: gap('.chapter-nav .nav-chapter:last-child', 'right'),
      prevLeft: gap('.chapter-nav .nav-chapter:first-child', 'left'),
      scrubLeft: gap('.progress-scrubber', 'left'),
    };
  })()`);
  check(
    '顶栏: 三个按钮左右两边对齐',
    bandGaps.topbarLeft !== null &&
      Math.abs(bandGaps.topbarLeft - bandGaps.topbarRight) <= 1 &&
      Math.abs(bandGaps.topbarGap - bandGaps.topbarGap2) <= 1,
    bandGaps.topbarLeft === null
      ? '没有找到顶栏按钮'
      : `左 ${bandGaps.topbarLeft}px / 右 ${bandGaps.topbarRight}px，两道间隙 ${bandGaps.topbarGap}px / ${bandGaps.topbarGap2}px`,
  );
  check(
    '底栏: 页码与下一章右边对齐，滑杆与上一章左边对齐',
    bandGaps.pageRight !== null &&
      Math.abs(bandGaps.pageRight - bandGaps.nextRight) <= 1 &&
      Math.abs(bandGaps.prevLeft - bandGaps.scrubLeft) <= 1,
    bandGaps.pageRight === null
      ? '没有找到底栏读数'
      : `页码右 ${bandGaps.pageRight}px / 下一章右 ${bandGaps.nextRight}px；上一章左 ${bandGaps.prevLeft}px / 滑杆左 ${bandGaps.scrubLeft}px`,
  );
  check(
    '顶栏与底栏共用同一条内边距',
    bandGaps.topbarLeft !== null && Math.abs(bandGaps.topbarLeft - bandGaps.prevLeft) <= 1,
    bandGaps.topbarLeft === null ? '没有找到顶栏按钮' : `顶栏 ${bandGaps.topbarLeft}px / 底栏 ${bandGaps.prevLeft}px`,
  );

  const scrubber = await cdp.evaluate(`(() => {
    const el = document.querySelector('.progress-scrubber');
    if (!el) return { missing: true };
    const r = el.getBoundingClientRect();
    return {
      type: el.type,
      width: Math.round(r.width),
      height: Math.round(r.height),
      label: el.getAttribute('aria-label') ?? '',
      min: Number(el.min),
      max: Number(el.max),
      value: Number(el.value),
      page: document.querySelector('.progress-page')?.textContent.trim() ?? '',
      nav: document.querySelector('.chapter-nav .nav-progress')?.textContent.trim() ?? '',
    };
  })()`);
  check(
    '底栏: 进度是可拖动的滑杆',
    !scrubber.missing && scrubber.type === 'range' && scrubber.width >= 120 && scrubber.label.length > 0,
    scrubber.missing
      ? '没有找到滑杆'
      : `type=${scrubber.type} 宽 ${scrubber.width}px label="${scrubber.label}"`,
  );
  check(
    '底栏: 有页码与阅读进度读数',
    !scrubber.missing && scrubber.page.length > 0 && scrubber.nav.length > 0,
    scrubber.missing ? 'n/a' : `page="${scrubber.page}" nav="${scrubber.nav}"`,
  );
  // The slider is in *chapter pages*, not in whole-book percent.
  //
  // This is the report: the readout beside the thumb said "第 8/9 页" while the
  // thumb sat near the left end, because the two were counting different things —
  // the readout counted pages in a nine-page chapter, and the slider counted the
  // reader's position in a book of hundreds. The check is that the slider's own
  // range *is* the chapter's page range, read from the same readout the reader
  // sees, so the two cannot drift apart behind a passing screenshot.
  const chapterPages = (() => {
    const match = /\/\s*(\d+)\s*页/.exec(scrubber.page ?? '');
    return match ? Number(match[1]) : 0;
  })();
  check(
    '底栏: 滑杆量的是章节内页数，不是全书百分比',
    !scrubber.missing && chapterPages > 0 && scrubber.max === chapterPages && scrubber.min === 1,
    scrubber.missing
      ? '没有找到滑杆'
      : `min=${scrubber.min} max=${scrubber.max} value=${scrubber.value} 读数="${scrubber.page}"（章节共 ${chapterPages} 页）`,
  );
  // And it *moves*. Setting the value through a real `input` event is what a drag
  // produces, and the assertion is on the page the reader ends up on: a slider
  // wired to the wrong measurement still reports the right number while failing
  // this, which is the bug being closed.
  const scrubMove = await cdp.evaluate(`(async () => {
    const el = document.querySelector('.progress-scrubber');
    if (!el || Number(el.max) < 2) return { skipped: true };
    // A page in *this* chapter, not a page of the book. A slider wired to the whole
    // book reaches the same visible readout while quietly navigating: the page number
    // it lands on is a page of whatever chapter the drag moved the reader into. That
    // is why the range assertion above is on min/max matching the chapter's own page
    // count — the two have to come from the same source, which is what makes this
    // drag land where the readout says.
    const target = Number(el.max);
    el.value = String(target);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 500));
    const page = document.querySelector('.progress-page')?.textContent.trim() ?? '';
    return { skipped: false, want: target, page, value: Number(el.value) };
  })()`);
  if (scrubMove.skipped) {
    check('底栏: 拖动滑杆切到对应页', true, `本章只有 ${scrubber.max} 页，这一轮跳过`);
  } else {
    check(
      '底栏: 拖动滑杆切到对应页',
      scrubMove.page.includes(`第 ${scrubMove.want}/`) && scrubMove.page.includes(`/${scrubMove.want} 页`),
      `拖到 ${scrubMove.want} 后读数="${scrubMove.page}"`,
    );
  }

  // The same drag, in **paged** mode, where the original defect was easiest to see
  // and hardest to reason about: a paged surface does not scroll, so a slider wired
  // to the book moves the reader by *opening a different chapter*, and the page
  // number beside it then describes that other chapter.
  //
  // Driven here rather than left to the scene that screenshots it, because the audit
  // has to hold the state while it measures: a scene runs once for the picture, and
  // the mode it left the reader in is not the mode the checks below run in.
  const pagedScrub = await cdp.evaluate(`(async () => {
    // Switch to paged through the real control, then drag. Both are things a reader
    // does; setting the setting directly would prove the slider works in a mode no
    // reader could have reached.
    document.querySelector('button[aria-label="设置"]').click();
    await new Promise((r) => setTimeout(r, 350));
    const paged = [...document.querySelectorAll('.segmented button')].find((b) => b.textContent.trim() === '翻页');
    if (!paged) return { skipped: true };
    paged.click();
    await new Promise((r) => setTimeout(r, 350));
    document.querySelector('button[aria-label="关闭"]').click();
    await new Promise((r) => setTimeout(r, 400));
    // The chapter the reader is in, taken from the immersion indicator's own source
    // is not available here (the chrome is shown), so the *page count* stands in:
    // a drag that navigated would change the chapter, and a chapter change is what
    // the readout's denominator comes from.
    const el = document.querySelector('.progress-scrubber');
    if (!el) return { skipped: true };
    const beforePage = document.querySelector('.progress-page')?.textContent.trim() ?? '';
    const beforeMax = Number(el.max);
    const target = Math.min(3, beforeMax);
    el.value = String(target);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 500));
    const afterPage = document.querySelector('.progress-page')?.textContent.trim() ?? '';
    return {
      skipped: false,
      target,
      min: Number(el.min),
      max: Number(el.max),
      value: Number(el.value),
      before: beforePage,
      page: afterPage,
    };
  })()`);
  if (pagedScrub.skipped) {
    check('翻页模式: 滑杆拖到本章某页', true, '没有找到滑杆或分栏选项，这一轮跳过');
  } else {
    check(
      `翻页模式: 滑杆拖到第 ${pagedScrub.target} 页，仍在本章`,
      pagedScrub.min === 1 &&
        pagedScrub.value === pagedScrub.target &&
        pagedScrub.max >= pagedScrub.target &&
        pagedScrub.page.includes(`第 ${pagedScrub.target}/${pagedScrub.max} 页`),
      `min=${pagedScrub.min} max=${pagedScrub.max} value=${pagedScrub.value} 拖前="${pagedScrub.before}" 拖后="${pagedScrub.page}"`,
    );
    // Back to scroll mode. The traffic window below is about the requests a
    // *reading* session makes, and a paged surface does not scroll — it would
    // generate no position at all, and the check would pass on an empty window.
    await cdp.evaluate(`(async () => {
      document.querySelector('button[aria-label="设置"]').click();
      await new Promise((r) => setTimeout(r, 350));
      const scroll = [...document.querySelectorAll('.segmented button')].find((b) => b.textContent.trim() === '滚动');
      if (scroll) scroll.click();
      await new Promise((r) => setTimeout(r, 350));
      document.querySelector('button[aria-label="关闭"]').click();
    })()`);
    await cdp.sleep(500);
  }

  // The status line must not change the page's geometry. Measured by moving it
  // from empty to a message and back, and comparing the reading column's top.
  const statusAudit = await cdp.evaluate(`(() => {
    const stage = document.querySelector('.stage');
    const bar = document.querySelector('.status-bar');
    if (!stage || !bar) return { missing: true };
    const before = stage.getBoundingClientRect().top;
    bar.hidden = false;
    bar.querySelector('.status-text').textContent = '同步中…';
    const during = stage.getBoundingClientRect().top;
    bar.hidden = true;
    const after = stage.getBoundingClientRect().top;
    return { before, during, after };
  })()`);
  check(
    '状态提示不推动正文',
    !statusAudit.missing && statusAudit.before === statusAudit.during && statusAudit.during === statusAudit.after,
    statusAudit.missing ? '没有找到状态行或阅读区' : `正文顶部 y: ${statusAudit.before} / ${statusAudit.during} / ${statusAudit.after}`,
  );

  // Every visible control has to be at least 32px in both directions, and every
  // icon-only button has to carry a label — the two rules docs/ui.md states and
  // nothing enforced.
  const controls = await cdp.evaluate(`(() => {
    const out = [];
    for (const button of document.querySelectorAll('button')) {
      const rect = button.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;
      const label = button.getAttribute('aria-label') ?? button.textContent.trim();
      const iconOnly = button.querySelector('.icon') !== null && button.textContent.trim() === '';
      out.push({ label, width: Math.round(rect.width), height: Math.round(rect.height), iconOnly, hasLabel: label.length > 0 });
    }
    return out;
  })()`);
  const tooSmall = controls.filter((c) => c.width < 28 || c.height < 28);
  check('触控目标不小于 28px', tooSmall.length === 0, tooSmall.map((c) => `${c.label} ${c.width}x${c.height}`).join(', ') || `${controls.length} 个控件全部合格`);
  const unlabelled = controls.filter((c) => !c.hasLabel);
  check('每个控件都有可读的名字', unlabelled.length === 0, unlabelled.length === 0 ? `${controls.length} 个控件全部有名字` : `${unlabelled.length} 个没有名字`);

  // No horizontal overflow: a phone screen that scrolls sideways is the single
  // clearest sign that a layout was not checked at phone width.
  const overflow = await cdp.evaluate(`(() => {
    const root = document.documentElement;
    const stage = document.querySelector('.stage');
    return {
      document: root.scrollWidth - root.clientWidth,
      stage: stage ? stage.scrollWidth - stage.clientWidth : 0,
    };
  })()`);
  check('没有横向溢出', overflow.document <= 1, `document 溢出 ${overflow.document}px`);

  // Back to scroll mode before the traffic window.
  //
  // The scenes above end in paged mode, and a paged surface does not scroll — reading
  // in paged mode turns pages without generating a position per screen. Scroll mode is
  // where a reader produces a position *continuously*, which is the traffic profile
  // the report was about, so the window has to be measured there. The sheet is opened
  // by its own button rather than assumed to be open: the previous step closed it.
  // The chrome is made visible first: the audit's own collapse check above left it
  // hidden, and a hidden topbar's settings button is a button that cannot be clicked.
  const revealChrome = async () => {
    const hidden = await cdp.evaluate(`document.querySelector('.reader-screen')?.dataset?.chrome === 'hidden'`);
    if (hidden) {
      await cdp.tapMiddle();
      await cdp.sleep(400);
    }
  };
  await revealChrome();
  // The settings sheet is identified by its own title, not by "a panel is open": the
  // geometry step above leaves the *contents* sheet up, and a blind click on the
  // settings button would close it and then wait for a sheet that is already there.
  const settingsTitle = await cdp.evaluate(
    `document.querySelector('.panel')?.querySelector('.panel-title, h2, header')?.textContent?.trim() ?? ''`,
  );
  if (!settingsTitle.includes('设置')) {
    if (settingsTitle) {
      await cdp.click('button[aria-label="关闭"]');
      await cdp.sleep(300);
    }
    await cdp.click('button[aria-label="设置"]');
    await cdp.waitFor('document.querySelector(".panel") !== null', 10_000);
  }
  await cdp.sleep(300);
  await cdp.clickText('.segmented button', '滚动');
  await cdp.sleep(300);
  await cdp.click('button[aria-label="关闭"]');
  await cdp.sleep(600);

  // The traffic a *reading* session generates.
  //
  // The request behind this is the screenshot a reader sent: the network panel, full
  // of `sync` POSTs each paired with a `sync?since=…` GET, repeating for as long as
  // they kept reading. Both halves were real defects — the push's answer (which
  // already carries the merged state) was thrown away and re-fetched, and the 30s
  // poll was re-armed by every page turn so the pull half silently stopped — and
  // neither is a *functional* failure, which is why no functional test caught them.
  //
  // So the window has to contain actual reading: turning pages is what writes a
  // position and what used to produce a round trip per turn. A window in which the
  // reader sits still proves nothing about the thing that was reported.
  await cdp.sleep(1500);
  const before = await cdp.requestCounts();
  // Twelve page turns over six seconds — a reader settling into a book.
  //
  // The scroll is dispatched as a real sequence of positions on the reading surface
  // rather than as a synthetic event: the surface is a scroll container in scroll
  // mode (that is what "scroll mode" *is*), and its own `scroll` handler is what
  // measures a position and writes it. Dispatching anything else would be a window in
  // which no position was ever written, and such a window passes whatever the sync
  // code does — which is the trap this check has to avoid.
  // Driven one step at a time from here rather than as one long in-page loop: the
  // protocol has a 20-second ceiling on a single evaluation, and twelve steps held
  // long enough for the reader's own write debounce to fire is longer than that.
  const pageTurns = 8;
  const scrollMax = await cdp.evaluate(`(() => {
    const host = document.querySelector('book-content');
    if (!host) return 0;
    return Math.max(0, host.scrollHeight - host.clientHeight);
  })()`);
  let turned = 0;
  for (let step = 1; step <= pageTurns && scrollMax > 0; step += 1) {
    await cdp.evaluate(`(() => {
      const host = document.querySelector('book-content');
      host.scrollTop = ${Math.round((scrollMax * step) / pageTurns)};
      return host.scrollTop;
    })()`);
    // Held longer than the reader's own 1.5s write debounce, so every step is a
    // *committed* position rather than one the next step cancels. Without that the
    // window contains a single write however many times the surface is scrolled, and
    // the check has nothing to measure.
    await cdp.sleep(1800);
    turned += 1;
  }
  // Then let the debounce and the coalescing window drain, so the trailing push a
  // reader would actually cause is *in* the measurement rather than after it.
  await cdp.sleep(6000);
  const after = await cdp.requestCounts();
  const delta = (name) => (after[name] ?? 0) - (before[name] ?? 0);
  // Every write costs **one** request, not two.
  //
  // This is the doubling the report showed: a `POST /api/v1/sync` immediately
  // followed by a `GET /api/v1/sync?since=…` carrying the same body. The push already
  // answers with the merged state, so the GET is entirely redundant — and it doubles
  // the traffic of every page turn for as long as the reader keeps reading.
  //
  // The assertion is on the *ratio*, and that is the whole of the fix's shape.
  //
  // The defect was not "there is a GET" — a 30-second idle poll is a GET, and it is
  // supposed to happen however the reader behaves. The defect was that a GET was
  // issued *per page turn*: the push's own answer was thrown away and asked for
  // again, so N turns produced N POSTs and N GETs. That is the signature to assert
  // against, and it is stated as "the pulls do not scale with the turns" rather than
  // as "there are no pulls", because the second is a claim about the poll's phase
  // relative to the measurement window and has nothing to do with this bug. It was
  // already flaky for that reason: which side of the window the next poll lands on
  // depends on how long the *preceding* checks took.
  //
  // Every step above is held past the reader's own write debounce, so each is a
  // separate session and each legitimately pushes, which makes `posts` a real count
  // of the reader's turns.
  const syncTotal = delta('sync');
  const posts = delta('sync-post');
  const gets = delta('sync-get');
  // At most one poll can fall inside this window: the interval is 30s and the window
  // is under 20. More than one, or one per push, is the doubling.
  const paired = gets >= posts && posts > 1;
  check(
    '翻页不再每次都发两次 sync',
    turned > 0 && posts > 0 && gets <= 1 && !paired,
    turned === 0
      ? '阅读面没有可滚动的高度，这一轮没有发生翻页（检查因此无效）'
      : posts === 0
        ? '这一轮没有发出任何 push，检查无效'
        : `${turned} 次翻页 + 6 秒静默：${posts} 次 POST / ${gets} 次 GET（共 ${syncTotal} 次 sync 请求）`,
  );

    // The illustrated chapter's image must actually be *painted*.
  //
  // The report was a screenshot of the browser's broken-image placeholder where a
  // plate should have been, and the cause was one attribute: the server rewrote the
  // chapter's relative `src` to an absolute asset URL, and the client kept an
  // absolute URL only when it began with the page's own origin — which is the
  // app's, not the API's — so every `src` was dropped. So the assertion is on the
  // decoded image rather than on the attribute: a URL that is present and 404s
  // would pass an attribute check and fail the reader in exactly the same way.
  await cdp.navigate(`${origin}/#/book/${encodeURIComponent(ILLUSTRATED_ID)}`);
  await cdp.waitFor('document.querySelector("book-content")?.shadowRoot?.querySelector(".book-flow") !== null', 20_000);
  await cdp.sleep(1200);
  const image = await cdp.evaluate(`(() => {
    const root = document.querySelector('book-content')?.shadowRoot;
    const img = root?.querySelector('img');
    if (!img) return { missing: true };
    const r = img.getBoundingClientRect();
    return {
      src: img.getAttribute('src') ?? '',
      complete: img.complete,
      naturalWidth: img.naturalWidth,
      naturalHeight: img.naturalHeight,
      width: Math.round(r.width),
      height: Math.round(r.height),
    };
  })()`);
  check(
    'EPUB: 章节里的图片真的画出来了',
    !image.missing && image.complete && image.naturalWidth > 0 && image.width > 0,
    image.missing
      ? '章节里没有 img 元素'
      : `naturalWidth=${image.naturalWidth} 显示 ${image.width}x${image.height} src="${image.src.slice(0, 80)}"`,
  );
  // And the *text* around it is a paragraph of its own, so the plate is not the
  // only thing that renders.
  const chapterText = await cdp.evaluate(`(() => {
    const root = document.querySelector('book-content')?.shadowRoot;
    return (root?.querySelector('.book-flow')?.textContent ?? '').trim().slice(0, 60);
  })()`);
  check(
    'EPUB: 插图下面的正文也在',
    typeof chapterText === 'string' && chapterText.includes('台版'),
    `正文开头="${chapterText}"`,
  );

  /*
   * A plate the publisher sized in its own pixels stays inside the column.
   *
   * Three numbers, three different ways of saying the same failure:
   *
   *  - the image's own box against the reading column's — a picture wider than the
   *    column is a picture the reader cannot see the ends of;
   *  - the aspect *ratio* against the file's. A clamp that sets a width and leaves
   *    the height alone squashes the plate, which is the defect a fix for the first
   *    number can easily introduce, and it is invisible in a screenshot of a
   *    diagonal;
   *  - the screen's own horizontal overflow. The first two are about the image; this
   *    one is about the *page*, which is what the reader actually reported.
   *
   * Measured on the *second* image, because the first is the one that fits and
   * already has its own check above.
   */
  const wide = await cdp.evaluate(`(() => {
    const root = document.querySelector('book-content')?.shadowRoot;
    const img = root?.querySelector('.pic.wide img') ?? root?.querySelectorAll('img')[1];
    if (!img) return { missing: true };
    const r = img.getBoundingClientRect();
    const flow = root.querySelector('.book-flow');
    const fr = flow.getBoundingClientRect();
    const style = getComputedStyle(flow);
    // The column the image is in, which is what a max-width of 100% is a percentage
    // of — read from the flow's own box rather than from the viewport, so the
    // reader's page margin is accounted for the way the browser accounts for it.
    const pad = (parseFloat(style.paddingLeft) || 0) + (parseFloat(style.paddingRight) || 0);
    return {
      naturalRatio: img.naturalWidth / img.naturalHeight,
      shownRatio: r.width / r.height,
      width: r.width,
      columnWidth: fr.width - pad,
      layoutWidth: img.offsetWidth,
      layoutHeight: img.offsetHeight,
      dpr: window.devicePixelRatio || 1,
      documentOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      hostOverflow: (() => { const h = document.querySelector('book-content'); return h.scrollWidth - h.clientWidth; })(),
      attributeWidth: img.getAttribute('width'),
    };
  })()`);
  check(
    'EPUB: 比页面宽的插图被收进栏内',
    !wide.missing && wide.width <= wide.columnWidth + 1 && wide.layoutWidth <= wide.columnWidth + 1,
    wide.missing
      ? '章节里没有第二张图'
      : `出版方写的是 ${wide.attributeWidth}px，画出来 ${Math.round(wide.width)}px / 栏宽 ${Math.round(wide.columnWidth)}px`
        + `（布局 ${wide.layoutWidth}x${wide.layoutHeight}，dpr=${wide.dpr}）`,
  );
  check(
    'EPUB: 收窄插图没有改变它的比例',
    !wide.missing && Math.abs(wide.shownRatio - wide.naturalRatio) <= 0.02,
    wide.missing
      ? '章节里没有第二张图'
      : `原图 ${wide.naturalRatio.toFixed(3)} / 画出来 ${wide.shownRatio.toFixed(3)}`,
  );
  check(
    'EPUB: 宽插图没有让页面横向溢出',
    !wide.missing && wide.documentOverflow <= 1 && wide.hostOverflow <= 1,
    wide.missing
      ? '章节里没有第二张图'
      : `document 溢出 ${wide.documentOverflow}px / 阅读面溢出 ${wide.hostOverflow}px`,
  );

  /*
   * The search field's magnifier, measured rather than eyeballed.
   *
   * The report was "书架页面的搜索按钮没有垂直对齐", and it is the class of defect
   * this harness exists for: nothing about it is a functional failure. The field
   * works, the input focuses, the search runs — the glyph is simply drawn fourteen
   * pixels above where it looks like it belongs, and every green test in the suite
   * says so.
   *
   * Measured on the **ink**, not on the box, because the box was *already* correct
   * when the defect was reported (75.98..120.19 inside a field of 75.98..120.19 —
   * dead centre) and that is exactly what made the bug survive a layout review. A
   * range over the glyph's contents is the browser's own answer to "where is the
   * character", which is the thing a reader sees and the thing a box check cannot.
   *
   * The tolerance is 2px: the icon font's ink is not perfectly symmetric inside a
   * symmetric em (measured 0.4px of asymmetry at this size), so an exact match would
   * be an assertion about the generator's curve fitting rather than about alignment.
   * The defect it guards against was 14px.
   */
  // The shelf, explicitly: `audit` runs after the scenes, and the last one leaves
  // the reader open. The check is about the shelf's own search field, so it has to
  // put the shelf up rather than assert on whatever screen happened to be there.
  await cdp.navigate(`${origin}/#/shelf`);
  await cdp.waitFor('document.querySelector(".shelf-search input") !== null', 20_000);
  await cdp.sleep(400);
  const searchGlyph = await cdp.evaluate(`(() => {
    const glyph = document.querySelector('.search-glyph');
    const input = document.querySelector('.shelf-search input');
    const row = document.querySelector('.shelf-search');
    const cover = document.querySelector('.book-grid .book-card');
    if (!glyph || !input) return { missing: true };
    const range = document.createRange();
    range.selectNodeContents(glyph);
    const ink = range.getBoundingClientRect();
    const field = input.getBoundingClientRect();
    const rr = row?.getBoundingClientRect();
    const cr = cover?.getBoundingClientRect();
    return {
      ink: (ink.top + ink.bottom) / 2,
      field: (field.top + field.bottom) / 2,
      inkHeight: ink.height,
      fieldHeight: field.height,
      display: getComputedStyle(glyph).display,
      // The two gutters, measured as the distance from the field's own box to the
      // content column the covers are laid out in. Equal left and right, and
      // non-zero — see the check below.
      left: rr && cr ? Math.round(cr.left - rr.left) : null,
      // The right gutter needs a cover on the last column, which a grid cannot hand
      // out: the covers fill their tracks, so the rightmost card's edge is the grid's
      // and the gap is zero however wide the padding is. Measuring the *row's* right
      // edge against the grid's padding box is the same fact without depending on how
      // many columns happened to be drawn.
      right: (() => {
        const grid = document.querySelector('.book-grid');
        if (!rr || !grid) return null;
        const style = getComputedStyle(grid);
        const pad = parseFloat(style.paddingLeft) || 0;
        const gr = grid.getBoundingClientRect();
        return Math.round(rr.right - (gr.right - pad));
      })(),
    };
  })()`);
  /*
   * The two gutters around the shelf's search field.
   *
   * The report is 「书架的搜索框两边需要增加 margin」, and it is one of those defects
   * that a screenshot shows and an assertion has to *state*: the field was exactly as
   * wide as the grid, so its 1px border and its 32px clear button landed on the same
   * vertical line as the covers beside them. Measured as the gap between the field's
   * box and the covers' column rather than as a CSS value, because "the margin is set"
   * and "the field is inset from what is beside it" are different claims and only the
   * second one is what the reader asked for.
   *
   * Equal on both sides as well: a single-sided inset moves the control, which is the
   * other way to make a row look wrong with nothing technically at fault.
   */
  check(
    '搜索框: 两边都从封面列内缩，且左右相等',
    searchGlyph.left !== null && searchGlyph.right !== null && searchGlyph.left > 0
      && Math.abs(searchGlyph.left - searchGlyph.right) <= 1,
    searchGlyph.left === null
      ? '没有找到搜索框或封面'
      : `左 ${searchGlyph.left}px / 右 ${searchGlyph.right}px（字段 0 则为贴着封面）`,
  );
  check(
    '搜索框: 放大镜与输入框中线对齐',
    !searchGlyph.missing && searchGlyph.inkHeight > 0
      && Math.abs(searchGlyph.ink - searchGlyph.field) <= 2,
    searchGlyph.missing
      ? '没有找到搜索框或放大镜'
      : `放大镜中线 ${searchGlyph.ink.toFixed(1)} / 输入框中线 ${searchGlyph.field.toFixed(1)}`
        + `（偏差 ${(searchGlyph.ink - searchGlyph.field).toFixed(1)}px，字形 ${searchGlyph.inkHeight}px，框高 ${searchGlyph.fieldHeight}px）`,
  );

  /*
   * The shelf's ordering, from the screen the reader sees.
   *
   * Three facts, and they are three because each can be wrong on its own:
   *
   *  - which sort is *selected* — the chips are drawn from a list, and the store's
   *    default is a different place from the list's first entry;
   *  - that the row is *in the order that chip says* — a label that lies is the
   *    failure mode a screenshot cannot show, because the covers look the same in any
   *    order;
   *  - that there is no 继续阅读 strip — the row was ten cards duplicating ten of the
   *    covers below it, and "it is gone" is only checkable as an absence.
   */
  const shelfSort = await cdp.evaluate(`(() => {
    const chips = [...document.querySelectorAll('.chip')].map((chip) => ({
      label: chip.textContent.trim(),
      pressed: chip.getAttribute('aria-pressed') === 'true',
    }));
    const titles = [...document.querySelectorAll('.book-card .title')].map((node) => node.textContent.trim());
    return {
      chips,
      selected: chips.find((chip) => chip.pressed)?.label ?? '',
      titles: titles.slice(0, 2),
      continueRow: document.querySelector('.continue-row') !== null,
      continueCards: document.querySelectorAll('.continue-card').length,
      subtitle: document.querySelector('.shelf-subtitle')?.textContent ?? '',
    };
  })()`);
  check(
    '书架: 第一个排序是「最近阅读」且默认选中',
    shelfSort.chips[0]?.label === '最近阅读' && shelfSort.selected === '最近阅读',
    `chips=${shelfSort.chips.map((chip) => `${chip.label}${chip.pressed ? '*' : ''}`).join(' / ')}`,
  );
  check(
    '书架: 「最近入库」仍然在排序里',
    shelfSort.chips.some((chip) => chip.label === '最近入库'),
    `chips=${shelfSort.chips.map((chip) => chip.label).join(' / ')}`,
  );
  check(
    '书架: 排在最前的是最近读过的那本',
    /*
     * The fixture reads 第1卷 and 第2卷 (see the continue handler in `server.mjs`), so
     * 最近阅读 has a definite answer. The two titles are asserted rather than "the
     * first one is 第1卷" because the *second* position is what shows the order is
     * real: a sort that only placed the read book first could be a coincidence of the
     * page order.
     */
    shelfSort.titles[0]?.includes('第1卷') && shelfSort.titles[1]?.includes('第2卷'),
    `前两本：${shelfSort.titles.join(' / ')}`,
  );
  check(
    '书架: 没有「继续阅读」横排',
    !shelfSort.continueRow && shelfSort.continueCards === 0,
    `continue-row=${shelfSort.continueRow} 卡片 ${shelfSort.continueCards} 张`,
  );

  /*
   * 书架上「从书架拿掉」的入口，量的是**墨迹和形状**而不是它存在。
   *
   * The control is a glyph in a corner over a cover, which is the one place on this
   * screen where two things can overlap without looking wrong: the cover is an image
   * and the glyph is drawn on top of it, so a button that is the right size in the DOM
   * and *three pixels of ink* on screen passes every functional test. Both are
   * measured — the hit area, because it is what the finger aims at, and the glyph,
   * because a 28px hit area around a 9px glyph is a control nobody can see.
   *
   * `hover: hover` is not emulated, so the button is at its resting `opacity: 0.55` —
   * which is the state a touch device shows it in, and the reason the ink has to be
   * measured rather than the box.
   */
  const shelfMenu = await cdp.evaluate(`(() => {
    const button = document.querySelector('.book-card .book-more');
    const card = document.querySelector('.book-card');
    const open = document.querySelector('.book-card .book-open');
    if (!button || !card || !open) return { missing: true };
    const br = button.getBoundingClientRect();
    const cr = card.getBoundingClientRect();
    const or = open.getBoundingClientRect();
    const style = getComputedStyle(button);
    return {
      hit: { w: br.width, h: br.height },
      // Inside the card, because a control that hangs over the gap between two cards
      // belongs to neither and is pressed by mistake while the reader is scrolling.
      inside: br.left >= cr.left - 0.5 && br.right <= cr.right + 0.5
        && br.top >= cr.top - 0.5 && br.bottom <= cr.bottom + 0.5,
      /* The open-target still covers the cover: the glyph must not have taken the
         press area the reader uses to open the book. */
      openCovers: or.width >= cr.width - 0.5 && or.height >= cr.height - 0.5,
      opacity: Number(style.opacity),
      label: button.getAttribute('aria-label') ?? '',
    };
  })()`);
  check(
    '书架: 每张封面有一个「⋯」操作入口，按得着也看得见',
    !shelfMenu.missing && shelfMenu.hit.w >= 28 && shelfMenu.hit.h >= 28
      && shelfMenu.inside && shelfMenu.openCovers && shelfMenu.opacity >= 0.5,
    shelfMenu.missing
      ? '没有找到 .book-more'
      : `${shelfMenu.hit.w.toFixed(1)}×${shelfMenu.hit.h.toFixed(1)} 在卡片内=${shelfMenu.inside}`
        + ` / 开书区覆盖整卡=${shelfMenu.openCovers} / 静止不透明度 ${shelfMenu.opacity}`,
  );

  /*
   * The library's two halves, as two screens.
   *
   * This block replaces the one that checked a *tab* — which is the whole of what the
   * review's second round asked to change (#40: 「书库预览页和管理页拆开，两者列表显示
   * 逻辑不一样。预览页需要显示搜索框，类似一个商城的布局。而书库管理页面只有管理员才能
   * 看到使用」). So there are four facts to measure, and each is one the previous
   * arrangement made impossible to state:
   *
   *  - the browsing page has a **search field** and the file manager does not;
   *  - the browsing page's grid **fills the window** rather than being capped to the
   *    shelf's measure (the shop layout, as opposed to the shelf's);
   *  - the file manager is reachable **only by its own URL** — there is no control on
   *    the browsing page that merely switches a tab, and the one that does exist says
   *    it is leaving for a different page;
   *  - the search field is **inset from the covers**, which is the shelf's own
   *    complaint (「书架的搜索框两边需要增加 margin」) and the same control.
   *
   * The two pages are reached by their own routes rather than by pressing something,
   * because that is now what they *are*: `#/library` is the reader's and
   * `#/library/files` is the administrator's.
   */
  await cdp.navigate(`${origin}/#/library`);
  await cdp.waitFor('document.querySelector(".library-browse-screen") !== null', 20_000);
  await cdp.waitFor('document.querySelector(".book-card:not(.skeleton), .empty-state") !== null', 20_000);
  await cdp.sleep(400);
  const browse = await cdp.evaluate(`(() => {
    ${LABEL_OF}
    const screen = document.querySelector('.library-browse-screen');
    const cards = document.querySelectorAll('.book-card');
    const pills = [...document.querySelectorAll('.book-shelve')].map((node) => node.getAttribute('aria-label'));
    const header = [...document.querySelectorAll('.panel-header button')].map(labelOf);
    const search = document.querySelector('.library-search');
    const field = document.querySelector('.library-search input');
    const sr = search?.getBoundingClientRect();
    const fr = field?.getBoundingClientRect();
    const firstCard = document.querySelector('.library-browse-grid .book-card')?.getBoundingClientRect();
    const grid = document.querySelector('.library-browse-grid');
    const gr = grid?.getBoundingClientRect();
    return {
      present: screen !== null,
      cards: cards.length,
      rows: document.querySelectorAll('.manager-row').length,
      pills,
      header,
      hasSearch: search !== null,
      searchLabel: field?.getAttribute('aria-label') ?? '',
      /*
       * The two gutters, measured the way the shelf's are and for the same reason.
       *
       * The field's own inset is the row's padding, which is what the reader asked for
       * (「两边需要增加 margin」). It is measured against the *page*, not against the
       * covers, and the covers are measured separately — because "both are inset" and
       * "both are inset by the same amount" are different claims and only the first is
       * the requirement: a shop's search box spans the content column while its covers
       * keep the page's gutter, so the field ends up *wider* than the grid rather than
       * flush with it.
       */
      fieldInset: sr && fr ? Math.round(fr.left - sr.left) : null,
      fieldInsetRight: sr && fr ? Math.round(sr.right - fr.right) : null,
      // The field's box against the covers' column: positive means the covers start
      // inside the field's edge, which is what stops the pill's border and its 40px
      // clear button from sitting on top of the first cover.
      cardInset: sr && firstCard ? Math.round(firstCard.left - sr.left) : null,
      gridWidth: gr ? Math.round(gr.width) : 0,
      viewport: window.innerWidth,
      // How many distinct top edges the cards occupy, i.e. how many rows the grid drew
      // — a shop fills the window, so this is what says the columns followed it.
      rowCount: new Set([...cards].map((card) => Math.round(card.getBoundingClientRect().top))).size,
    };
  })()`);
  check(
    '书库: 浏览页是封面网格，没有文件行',
    browse.present && browse.cards > 0 && browse.rows === 0,
    `封面 ${browse.cards} 张 / 文件行 ${browse.rows} 行`,
  );
  check(
    '书库: 浏览页有搜索框（商城式布局）',
    browse.hasSearch && browse.searchLabel.length > 0,
    `搜索框=${browse.hasSearch} label="${browse.searchLabel}"`,
  );
  check(
    '书库: 搜索框两边留白，不贴着封面',
    browse.fieldInset !== null && browse.fieldInset > 0
      && browse.fieldInsetRight !== null && Math.abs(browse.fieldInset - browse.fieldInsetRight) <= 1
      && browse.cardInset !== null && browse.cardInset > browse.fieldInset,
    browse.fieldInset === null
      ? '没有找到搜索框或封面'
      : `字段左 ${browse.fieldInset}px / 右 ${browse.fieldInsetRight}px，封面比字段再内缩 `
        + `${(browse.cardInset ?? 0) - (browse.fieldInset ?? 0)}px`,
  );
  check(
    '书库: 浏览页的网格铺满窗口，而不是被书架的宽度上限截住',
    browse.gridWidth > 0 && browse.gridWidth >= browse.viewport - 2 && browse.rowCount >= 2,
    `网格 ${browse.gridWidth}px / 窗口 ${browse.viewport}px，封面占 ${browse.rowCount} 行`,
  );
  check(
    '书库: 浏览页不放「新建文件夹」，只放上传和去文件管理的入口',
    !browse.header.includes('新建文件夹') && browse.header.includes('上传书籍') && browse.header.includes('文件管理'),
    `头部控件=${browse.header.join(' / ') || '（空）'}`,
  );
  /*
   * The search *works*, which is the half a screenshot cannot show.
   *
   * Typed rather than set: the field is debounced and the debounce is what turns the
   * query into a navigation, so a check that set the value directly would pass on a
   * field that is never read at all.
   */
  await cdp.navigate(`${origin}/#/library`);
  await cdp.waitFor('document.querySelector(".library-search input") !== null', 20_000);
  await cdp.sleep(400);
  const beforeSearch = await cdp.evaluate('document.querySelectorAll(".book-card").length');
  await cdp.fill('.library-search input', '第1卷');
  await cdp.waitFor(`location.hash.includes('q=')`, 10_000);
  await cdp.sleep(600);
  const searched = await cdp.evaluate(`(() => ({
    hash: location.hash,
    cards: document.querySelectorAll('.book-card').length,
    titles: [...document.querySelectorAll('.book-card .title')].map((n) => n.textContent.trim()),
    field: document.querySelector('.library-search input').value,
  }))()`);
  check(
    '书库: 输入搜索词后 URL 与网格一起变，只剩匹配的书',
    searched.cards > 0
      && searched.cards < beforeSearch
      && searched.titles.some((title) => title.includes('第1卷'))
      // The book that must be *gone* is named rather than counted: "fewer covers" is
      // also what a broken page looks like, and the fixture's later volumes are the
      // ones a filter has to remove.
      && !searched.titles.some((title) => title.includes('第3卷')),
    `前 ${beforeSearch} 张 → 后 ${searched.cards} 张（${searched.titles.join(' / ')}），hash=${searched.hash}`,
  );
  check(
    '书库: 搜索词进 URL，成为可以发给别人的链接',
    searched.hash.includes('q=') && searched.field === '第1卷',
    `hash=${searched.hash} 字段="${searched.field}"`,
  );

  await cdp.navigate(`${origin}/#/library/files`);
  await cdp.waitFor('document.querySelector(".library-files-screen") !== null', 20_000);
  await cdp.waitFor('document.querySelector(".manager-row") !== null', 20_000);
  await cdp.sleep(400);
  const filesPage = await cdp.evaluate(`(() => {
    ${LABEL_OF}
    const header = [...document.querySelectorAll('.panel-header button')].map(labelOf);
    return {
      view: document.querySelector('.library-screen')?.dataset.view,
      rows: document.querySelectorAll('.manager-row').length,
      cards: document.querySelectorAll('.book-card').length,
      hasSearch: document.querySelector('.library-search') !== null,
      header,
      hash: location.hash,
    };
  })()`);
  check(
    '书库: 文件管理页画的是文件行，没有封面网格',
    filesPage.view === 'files' && filesPage.rows > 0 && filesPage.cards === 0,
    `view=${filesPage.view} 行 ${filesPage.rows} / 封面 ${filesPage.cards}，hash=${filesPage.hash}`,
  );
  check(
    '书库: 文件管理页有上传/新建，没有搜索框',
    filesPage.header.includes('上传书籍') && filesPage.header.includes('新建文件夹') && !filesPage.hasSearch,
    `右上角=${filesPage.header.join(' / ') || '（空）'}，搜索框=${filesPage.hasSearch}`,
  );
  check(
    '书库: 文件管理页的入口是「浏览书籍」，不是页签',
    filesPage.header.includes('浏览书籍') && !filesPage.header.includes('预览'),
    `头部控件=${filesPage.header.join(' / ') || '（空）'}`,
  );

  /*
   * The switch back, taken as a *navigation*.
   *
   * The review's first round made this a tab, and the second round made it two
   * screens — so the property that has to hold is that pressing the entry point
   * *leaves* the file manager for the browsing page and that Back comes home. A tab
   * would satisfy neither: it would keep one history entry and the same URL.
   */
  await cdp.clickText('.panel-header button', '浏览书籍');
  await cdp.waitFor('document.querySelector(".library-browse-screen") !== null', 20_000);
  await cdp.sleep(500);
  const switched = await cdp.evaluate(`(() => ({
    browse: document.querySelector('.library-browse-screen') !== null,
    files: document.querySelector('.library-files-screen') !== null,
    hash: location.hash,
    cards: document.querySelectorAll('.book-card').length,
  }))()`);
  check(
    '书库: 从文件管理回到浏览是换页，URL 也跟着换',
    switched.browse && !switched.files && switched.cards > 0 && !switched.hash.includes('/files'),
    `浏览=${switched.browse} 文件=${switched.files} hash=${switched.hash} 封面 ${switched.cards} 张`,
  );

  /*
   * The two shelf-header glyphs, which is the one part of this change that is purely
   * about how it looks.
   *
   * Measured as *ink* rather than as a name: a font can map a code point and still
   * draw a shape that reads as noise at 18px, and the complaint was that the previous
   * pair did exactly that. What the numbers can say is that both glyphs are drawn,
   * that they are the same optical size as everything else on the row, and that they
   * are inside the button they belong to — a glyph that overflows its box is a glyph
   * that looks bigger than its neighbours whatever its paths are.
   */
  await cdp.navigate(`${origin}/#/shelf`);
  await cdp.waitFor('document.querySelector(".shelf-head-actions") !== null', 20_000);
  await cdp.sleep(400);
  const headGlyphs = await cdp.evaluate(`(() => {
    const buttons = [...document.querySelectorAll('.shelf-head-actions .icon-button')];
    const title = document.querySelector('.shelf-title')?.getBoundingClientRect();
    return buttons.map((button) => {
      const glyph = button.querySelector('.icon');
      const range = document.createRange();
      range.selectNodeContents(glyph);
      const ink = range.getBoundingClientRect();
      const box = button.getBoundingClientRect();
      return {
        name: button.getAttribute('aria-label'),
        code: glyph.textContent.codePointAt(0),
        inkWidth: Math.round(ink.width * 10) / 10,
        inkHeight: Math.round(ink.height * 10) / 10,
        inside: ink.left >= box.left - 0.5 && ink.right <= box.right + 0.5
          && ink.top >= box.top - 0.5 && ink.bottom <= box.bottom + 0.5,
        box: Math.round(box.width),
        titleHeight: title ? Math.round(title.height) : 0,
      };
    });
  })()`);
  check(
    '书架标题栏: 两个图标都画出来了，且不超出各自的按钮',
    headGlyphs.length === 2 && headGlyphs.every((glyph) => glyph.inkWidth > 0 && glyph.inkHeight > 0 && glyph.inside),
    headGlyphs
      .map((glyph) => `${glyph.name}: ${glyph.inkWidth}×${glyph.inkHeight} in ${glyph.box} box, inside=${glyph.inside}`)
      .join(' | '),
  );
  check(
    '书架标题栏: 图标不比标题大（同一行的视觉重量）',
    headGlyphs.every((glyph) => glyph.inkHeight < glyph.titleHeight * 1.2),
    headGlyphs.map((glyph) => `图标 ${glyph.inkHeight} vs 标题 ${glyph.titleHeight}`).join(' | '),
  );

  return { failures, results };
}

/**
 * Signs in, once, and waits for the shelf to have books on it.
 *
 * The wait is on a *card*, not on the shelf element. The shelf renders its frame
 * immediately and its data later, so waiting for the frame and then screenshotting
 * produces a picture of nine skeletons and a green run — which is how a review
 * harness ends up certifying a screen that never loaded.
 */
async function ensureLoggedIn(cdp, origin) {
  await cdp.navigate(`${origin}/#/shelf`);
  // `document.readyState === "complete"` fires before the app has finished its own
  // asynchronous boot (platform, session restore, instance probe), so a check for
  // "is the login screen there" run at that moment answers "no" for an app that has
  // not decided yet. Waiting for *either* screen — and then for the shelf's own data
  // — is what makes the decision mean something.
  await cdp.waitFor('document.querySelector(".shelf-screen, .login-screen") !== null', 20_000);
  const shelfReady = await cdp.execute('document.querySelector(".book-card:not(.skeleton)") !== null');
  if (shelfReady) return;
  const needsLogin = await cdp.evaluate(`document.querySelector('.login-screen') !== null`);
  process.stdout.write(`  [review] ensureLoggedIn: login screen = ${needsLogin}\n`);
  if (!needsLogin) {
    const state = await cdp.execute(`document.body.textContent.slice(0, 80)`);
    process.stdout.write(`  [review] ensureLoggedIn: already in app (${JSON.stringify(state)})\n`);
    return;
  }
  // The server URL field is already filled with the page's own origin by the screen,
  // so only the two credentials are typed.
  await cdp.fill('input[autocomplete="username"]', 'review');
  await cdp.fill('input[type="password"]', 'password12');
  await cdp.click('button[type="submit"]');
  await cdp.waitFor('document.querySelector(".book-card:not(.skeleton)") !== null', 20_000);
  process.stdout.write('  [review] logged in\n');
  await cdp.sleep(400);
}

async function main() {
  const server = createReviewServer();
  const origin = await server.listen();
  await mkdir(outDir, { recursive: true });

  const cdp = await CDP.launch({ viewport: VIEWPORT, scale: SCALE });
  const results = [];
  let failures = [];

  try {
    // Logged in once, and the session is *kept* across scenes: signing in per scene
    // would make a failure in the login screen look like a failure in every screen,
    // and the review is about what comes after.
    await ensureLoggedIn(cdp, origin);

    for (const scene of SCENES) {
      // Navigated to the *book* directly rather than through the shelf for the
      // scenes that need the reader: the shelf's cards need the book list to have
      // arrived, and a review of the reader should not depend on the shelf's timing.
      // Every scene states the theme it expects, rather than inheriting whatever the
      // previous one left behind. The TXT panel scene rendered on the dark theme the
      // night-mode scene had set, which is a screenshot that is not about what its
      // label says it is about — with nothing on the page to say so.
      //
      // A list scene is reached through a *reader's* action rather than a URL: the two
      // screens have a switch between them, and a deep link proves the URL scheme while
      // the switch is the thing that breaks.
      if (scene.openShelfAt) {
        // The shelf, then a page turn from its own pager — not a URL. The point of
        // the scene is that the control is *there* and looks like a control, and a
        // deep link would prove the route exists rather than that the reader can
        // reach page two.
        await cdp.navigate(`${origin}/#/shelf`);
        await cdp.waitFor('document.querySelector(".shelf-screen") !== null', 20_000);
        await cdp.sleep(600);
      } else if (scene.openLibraryAt) {
        // From the shelf, by pressing 书库. The two list screens have a switch
        // between them, and a deep link proves the URL scheme while the switch is
        // the thing that breaks.
        //
        // The *file manager* is not reachable that way any more and must not be: it
        // is the administrator's page, and the shelf's button opens the reader's. So
        // that one scene deep links to `#/library/files`, which is also the URL an
        // administrator would bookmark.
        await cdp.navigate(`${origin}/#/shelf`);
        await cdp.waitFor('document.querySelector(".book-card:not(.skeleton)") !== null', 20_000);
      } else {
        // `scene.book` names which book to open: the reader has more than one fixture
        // now (a TXT and an illustrated EPUB), and the scenes that mean a *particular*
        // book say so rather than all opening the first one.
        const book = encodeURIComponent(scene.book ?? 'review-book');
        await cdp.navigate(`${origin}/#/${scene.openBook ? `book/${book}` : 'shelf'}`);
      }
      if (scene.openBook === true || scene.openShelfAt || scene.openLibraryAt) {
        // Reached: the wait for the screen it renders follows below.
      } else {
        try {
          // With a page in the route the first page's cards may all be
          // skeletons for one tick; the *frame* is what this waits for, and
          // the assertion that follows is about the frame.
          await cdp.waitFor('document.querySelector(".shelf-screen") !== null', 20_000);
        } catch (err) {
          const diag = await cdp.execute(`(() => ({
            url: location.href,
            login: document.querySelector('.login-screen') !== null,
            shelf: document.querySelector('.shelf-screen') !== null,
            skeletons: document.querySelectorAll('.book-card.skeleton').length,
            cards: document.querySelectorAll('.book-card').length,
            text: document.body.textContent.slice(0, 120),
          }))()`);
          throw new Error(`${err.message}\n${JSON.stringify(diag, null, 1)}`);
        }
      }

      /*
       * A scene can ask to be reached by *navigating like a reader* rather than by a
       * URL.
       *
       * The two list screens have a switch between them, and the shelf's route only
       * exists once the shell has been told to go there — so a scene for the library
       * starts from the shelf and presses 书库, exactly as a reader does. That is
       * what makes the screenshot evidence that the *switch* works, which a deep link
       * would not be: a deep link proves the URL scheme, and the switch is what
       * breaks.
       */
      if (scene.openLibraryAt) {
        /*
         * Reach the scene the way the report describes it, which is now two different
         * gestures for two different pages.
         *
         *  - the **browsing** page is reached from the shelf by pressing 书库, because
         *    that is the switch a *reader* uses and a deep link would prove the URL
         *    while the switch is the thing that breaks;
         *  - the **file manager** is reached by its own URL, because there is no
         *    longer a switch to it from a reader's screen — it is the administrator's
         *    page, and the point of the split is that a reader cannot arrive there by
         *    accident. A deep link *is* how an administrator gets there, so that is
         *    what the scene does.
         */
        const files = scene.openLibraryAt.includes('/files');
        if (files) {
          await cdp.navigate(`${origin}${scene.openLibraryAt}`);
          await cdp.waitFor('document.querySelector(".library-files-screen") !== null', 20_000);
        } else {
          await cdp.click('button[aria-label="书库"]');
          await cdp.waitFor('document.querySelector(".library-browse-screen") !== null', 20_000);
        }
        /*
         * A folder is walked from the *file* page, and that is not an accident of the
         * fixture: walking into a folder is the file manager's gesture, and the
         * browsing page's equivalent is tapping a cover (which reads the book rather
         * than opening the folder). So the scene that needs a deeper folder walks
         * from there, which is also the sequence an administrator performs.
         */
        if (scene.folder) {
          await cdp.waitFor('document.querySelector(".manager-row") !== null', 20_000);
          await cdp.clickText('.manager-row .manager-label', scene.folder);
          // `aria-current` is a boolean attribute rendered as the *string* "true"
          // by the DOM, so the wait reads the attribute rather than comparing it to
          // a boolean: a comparison against `true` in an in-page expression is
          // comparing the string to a boolean, and it is false however the page
          // renders.
          await cdp.waitFor(
            `document.querySelector('.manager-crumb[aria-current="true"]')?.textContent === ${JSON.stringify(scene.folder)}`,
            10_000,
          );
        } else if (files) {
          await cdp.waitFor('document.querySelector(".manager-row, .empty-state") !== null', 20_000);
        } else {
          await cdp.waitFor('document.querySelector(".book-card, .empty-state") !== null', 20_000);
        }
        if (scene.page) {
          // The pager under whichever list is showing: both classes exist and the
          // scene names the page, not the control.
          await cdp.click(`.manager-pager button[aria-label="第 ${scene.page} 页"]`);
          await cdp.sleep(400);
        }
        /*
         * The shop's search, typed the way a reader types it.
         *
         * Dispatched as real key input rather than by setting the field's value: the
         * field is debounced and the debounce is what decides when the query becomes a
         * navigation, so a scene that set the value directly would screenshot a page
         * whose URL never changed — i.e. the state the *defect* looks like.
         */
        if (scene.search) {
          await cdp.fill('.library-search input', scene.search);
          await cdp.waitFor(`location.hash.includes('q=')`, 10_000);
          await cdp.sleep(500);
        }
        await cdp.sleep(300);
      }
      if (scene.openShelfAt) {
        // A page turn from the pager, not a URL: the point of the scene is that the
        // control is there and looks like a control.
        await cdp.click('.shelf-pager button[aria-label="下一页"]');
        await cdp.waitFor(`location.hash === '${scene.openShelfAt}'`, 10_000);
        await cdp.sleep(400);
      }
      /*
       * The one action the preview page exists for, taken.
       *
       * A screenshot of the button is not evidence that it works, and this is a
       * *write* reached from a grid of covers — so the scene presses it, waits for the
       * report, and lets the reload settle. What the picture then shows is the state
       * after the repair, which is the state the feature is about.
       */
      if (scene.shelfMenu) {
        /*
         * The shelf's own remove flow, taken the way the reader takes it.
         *
         * A screenshot of a ⋯ glyph is evidence of nothing: the control is *two* presses
         * deep (the menu, then the confirmation) and what has to be visible is the
         * sentence in the middle — the one that says the file is not touched, which is
         * the question a reader actually has before pressing 下架.
         */
        await cdp.click('.book-card .book-more');
        await cdp.waitFor('document.querySelector(".dialog-list button") !== null', 10_000);
        await cdp.clickText('.dialog-list button', '从书架拿掉');
        await cdp.waitFor(
          `/磁盘上的文件一个都不会动/.test(document.querySelector('.dialog')?.textContent ?? '')`,
          10_000,
        );
        await cdp.sleep(300);
      }

      if (scene.shelveFirst) {
        await cdp.click('.book-shelve');
        // The browsing page reports the write in the reader's own verb ("加入书架 N 本"):
        // it is a *shop*, and `已更新 N 本` describes a batch of rows rather than a tap on
        // one cover. The wait is for the *report*, which is what proves the write
        // happened and the folder was read back.
        await cdp.waitFor(
          `/加入书架 \\d+ 本/.test(document.querySelector('.manager-status')?.textContent ?? '')`,
          10_000,
        );
        await cdp.sleep(500);
      }

      if (scene.openBook) {
        // A deep link into the book, which is also the one route the reader is
        // expected to be able to share. If it does not open, that is the finding.
        await cdp.waitFor('document.querySelector(".reader-screen") !== null', 20_000);
        await cdp.waitFor('document.querySelector("book-content")?.shadowRoot?.querySelector(".book-flow") !== null', 20_000);
        await cdp.sleep(800);
      }
      const theme = scene.theme;
      if (theme) {
        await cdp.click('button[aria-label="设置"]');
        await cdp.waitFor('document.querySelector(".panel") !== null');
        await cdp.clickText('.segmented button', theme);
        await cdp.sleep(250);
        await cdp.click('button[aria-label="关闭"]');
        await cdp.sleep(250);
      }
      if (scene.openPanel) {
        await cdp.click(`button[aria-label="${scene.openPanel}"]`);
        await cdp.waitFor('document.querySelector(".panel") !== null');
        await cdp.sleep(350);
      }
      if (scene.choose) {
        await cdp.click(`button[aria-label="${scene.choose[0]}"]`);
        await cdp.waitFor('document.querySelector(".panel") !== null');
        await cdp.clickText('.segmented button', scene.choose[1]);
        await cdp.sleep(300);
      }
      if (scene.closePanel) {
        await cdp.click('button[aria-label="关闭"]');
        await cdp.sleep(300);
      }
      if (scene.tapCenter) {
        await cdp.tapMiddle();
        await cdp.sleep(300);
      }
      // A drag on the footer scrubber, driven through a real `input` event because
      // that is what a drag produces. Captured as a screenshot for the same reason
      // the other scenes are: "the slider moved the book instead of the page" is
      // invisible to a check that only reads the page number — both numbers are on
      // screen — and obvious in a picture of a chapter that is not the one the
      // reader was in.
      if (scene.scrubPage) {
        await cdp.evaluate(`(() => {
          const el = document.querySelector('.progress-scrubber');
          if (!el) return null;
          el.value = String(${scene.scrubPage});
          el.dispatchEvent(new Event('input', { bubbles: true }));
          return el.value;
        })()`);
        await cdp.sleep(600);
      }

      const shot = join(outDir, `${scene.name}.png`);
      await cdp.screenshot(shot);
      process.stdout.write(`✓ ${scene.label} → ${shot}\n`);
    }

    // Measure on a reader at a frozen position, so the numbers below are about the
    // *layout* rather than about whatever chapter happened to be left open.
    await cdp.navigate(`${origin}/#/shelf`);
    await cdp.waitFor('document.querySelector(".book-card:not(.skeleton)") !== null', 15_000);
    await cdp.click('.book-card');
    await cdp.waitFor('document.querySelector("book-content")?.shadowRoot?.querySelector(".book-flow") !== null', 15_000);

    const measured = [];
    // Opened with a real tap and *then* measured, after the sheet's animation has
    // settled. Measuring on the frame the click landed reads the sheet at its
    // starting position — off the bottom of the screen — and every number derived
    // from it is then about the animation rather than about the layout.
    await cdp.click('button[aria-label="目录"]');
    await cdp.waitFor('document.querySelector(".panel") !== null', 10_000);
    await cdp.sleep(400);
    const panelGeometry = await cdp.evaluate(`(() => {
      const panel = document.querySelector('.panel');
      const stage = document.querySelector('.stage');
      if (!panel || !stage) return null;
      const p = panel.getBoundingClientRect();
      const s = stage.getBoundingClientRect();
      return {
        panelTop: p.top, panelHeight: p.height, stageTop: s.top, stageHeight: s.height,
        hasScrim: !!document.querySelector('.scrim'), grip: !!document.querySelector('.panel-grip'),
        visibleText: p.top - s.top,
      };
    })()`);

    // The sheet is dismissed before the audit: the gesture the audit uses to hide
    // the chrome is a tap on the page, and with a sheet open that tap lands on the
    // sheet's backdrop — the correct behaviour, and not what is being measured.
    await cdp.click('button[aria-label="关闭"]');
    await cdp.sleep(350);

    const withGeometry = panelGeometry ? [{ name: '目录', openPanel: '目录' }] : [];
    const auditResult = await audit(cdp, origin, withGeometry, measured);
    failures = auditResult.failures;

    const summary = {
      viewport: VIEWPORT,
      scenes: SCENES.map((s) => ({ name: s.name, label: s.label, what: s.what })),
      results: auditResult.results,
      failures,
    };
    await writeFile(join(outDir, 'report.json'), JSON.stringify(summary, null, 2));
    await writeFile(
      join(outDir, 'README.md'),
      [
        '# UI 评审截图',
        '',
        '由 `npm run ui:review` 生成：真实 Chromium（390×844，2x）加载**生产产物**，',
        '对着一个替身 API 逐屏截图并测量。',
        '',
        '| 截图 | 场景 | 看什么 |',
        '| --- | --- | --- |',
        ...SCENES.map((s) => `| \`${s.name}.png\` | ${s.label} | ${s.what} |`),
        '',
        '## 自动测量',
        '',
        '| 检查 | 结果 | 说明 |',
        '| --- | --- | --- |',
        ...auditResult.results.map((r) => `| ${r.name} | ${r.ok ? '✅' : '❌'} | ${r.detail} |`),
        '',
        failures.length === 0 ? '全部通过。' : `**未通过 ${failures.length} 项。**`,
        '',
      ].join('\n'),
    );

    process.stdout.write('\n' + auditResult.results.map((r) => `${r.ok ? '✅' : '❌'} ${r.name} — ${r.detail}`).join('\n') + '\n');
    if (failures.length > 0) {
      process.stderr.write(`\nUI 评审未通过：\n${failures.map((f) => `  - ${f}`).join('\n')}\n`);
      process.exitCode = 1;
    }
  } finally {
    await cdp.close();
    await server.close();
  }
}

main().catch((err) => {
  process.stderr.write(`${err?.stack ?? err}\n`);
  process.exitCode = 1;
});
