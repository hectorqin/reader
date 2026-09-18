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
import { createReviewServer } from './server.mjs';

const here = fileURLToPath(new URL('.', import.meta.url));
const outDir = join(here, '..', '..', '..', 'docs', 'ui-review');

/** Phone size, which is the size this product is actually used at. */
const VIEWPORT = { width: 390, height: 844 };
const SCALE = 2;

const SCENES = [
  { name: '01-shelf', label: '书架', what: '第一屏：先看到书，再看到控件' },
  { name: '02-reader', label: '阅读页', what: '顶栏（图标+文字）/ 正文 / 底栏滑杆与上一章下一章 / 状态药丸', openBook: true },
  { name: '03-reader-no-chrome', label: '阅读页 · 收起工具栏', what: '顶栏与底栏同时收起，正文占满，右上留快捷列、左上左下留章节与页码', openBook: true, tapCenter: true },
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
];

/** Measurements that must hold, on the scenes where they apply. */
async function audit(cdp, scenes, results) {
  const failures = [];

  const check = (name, ok, detail) => {
    results.push({ name, ok, detail });
    if (!ok) failures.push(`${name}: ${detail}`);
  };

  // The chrome is one state, not two.
  //
  // The request behind this is specific — the top bar and the bottom bar hide
  // together — and the failure it guards against is the one a reader reports as
  // "只收起了一半": a header that leaves the text full height while a footer keeps
  // covering the last two lines. So the collapse is asserted on *both* bands and on
  // the space they occupied, in the state where the reader asked for immersion, and
  // the rail is asserted to be there — hiding the chrome without it is a state the
  // reader has to leave in order to do anything.
  //
  // Asked for the way the reader asks for it (a tap on the middle third) rather than
  // by setting the attribute: the tap is also a thing that has to keep working.
  await cdp.tapMiddle();
  await cdp.sleep(400);
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
      stageTop: Math.round(s.top),
      stageBottom: Math.round(s.bottom),
      viewportHeight: window.innerHeight,
      rail: !!document.querySelector('.reader-rail'),
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
  check(
    '收起工具栏: 顶栏与底栏一起走',
    !hidden.missing && hidden.attribute === 'hidden' && hidden.topbarHeight <= 1 && hidden.footerHeight <= 1,
    hidden.missing ? '没有找到阅读页' : `state=${hidden.attribute} 顶栏 ${hidden.topbarHeight}px / 底栏 ${hidden.footerHeight}px`,
  );
  check(
    '收起工具栏: 两条栏都不可见，也不可点',
    !hidden.missing && hidden.topbarVisibility === 'hidden' && hidden.footerVisibility === 'hidden',
    hidden.missing ? 'n/a' : `topbar=${hidden.topbarVisibility} footer=${hidden.footerVisibility}`,
  );
  check(
    '收起工具栏: 正文占满整屏',
    !hidden.missing && hidden.stageTop <= 1 && hidden.viewportHeight - hidden.stageBottom <= 1,
    hidden.missing ? 'n/a' : `正文 ${hidden.stageTop}..${hidden.stageBottom} / 视口 ${hidden.viewportHeight}`,
  );
  check(
    '收起工具栏: 右侧仍有快捷按钮',
    !hidden.missing && hidden.rail,
    hidden.missing ? 'n/a' : `rail=${hidden.rail}`,
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
  // Back to the chrome: the panel checks that follow need a page they can tap, and
  // the screen is left in the state a reader spends most of their time in.
  await cdp.tapMiddle();
  await cdp.sleep(400);

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
  const scrubber = await cdp.evaluate(`(() => {
    const el = document.querySelector('.progress-scrubber');
    if (!el) return { missing: true };
    const r = el.getBoundingClientRect();
    return {
      type: el.type,
      width: Math.round(r.width),
      height: Math.round(r.height),
      label: el.getAttribute('aria-label') ?? '',
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
  // The assertion is on GETs specifically rather than on the total: how many *writes*
  // a session produces is a product decision that belongs to the coalescing window,
  // but a GET that appears *alongside* a POST is never right, whatever the reader did.
  // Every step above is held past the reader's own write debounce, so each is a
  // separate session and each legitimately pushes; none of them may also pull.
  const syncTotal = delta('sync');
  const posts = delta('sync-post');
  const gets = delta('sync-get');
  check(
    '翻页不再每次都发两次 sync',
    turned > 0 && posts > 0 && gets === 0,
    turned === 0
      ? '阅读面没有可滚动的高度，这一轮没有发生翻页（检查因此无效）'
      : posts === 0
        ? '这一轮没有发出任何 push，检查无效'
        : `${turned} 次翻页 + 6 秒静默：${posts} 次 POST / ${gets} 次 GET（共 ${syncTotal} 次 sync 请求）`,
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
      await cdp.navigate(`${origin}/#/${scene.openBook ? `book/${encodeURIComponent('review-book')}` : 'shelf'}`);
      if (!scene.openBook) {
        try {
          await cdp.waitFor('document.querySelector(".book-card:not(.skeleton)") !== null', 20_000);
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

      if (scene.openBook) {
        // A deep link into the book, which is also the one route the reader is
        // expected to be able to share. If it does not open, that is the finding.
        await cdp.waitFor('document.querySelector(".reader-screen") !== null', 20_000);
        await cdp.waitFor('document.querySelector("book-content")?.shadowRoot?.querySelector(".book-flow") !== null', 20_000);
        await cdp.sleep(800);
      }
      const theme = scene.theme ?? (scene.openBook ? '白' : null);
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
    const auditResult = await audit(cdp, withGeometry, measured);
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
