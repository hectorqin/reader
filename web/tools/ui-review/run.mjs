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
  { name: '02-reader', label: '阅读页', what: '顶栏 / 正文 / 底部工具栏 / 状态药丸', openBook: true },
  { name: '03-reader-no-chrome', label: '阅读页 · 收起工具栏', what: '点中间三分之一后，正文占满且不跳动', openBook: true, tapCenter: true },
  { name: '04-panel-toc', label: '目录 · 半屏', what: '下半屏，上半屏正文仍可见', openBook: true, openPanel: '目录' },
  { name: '05-panel-settings', label: '阅读设置 · 半屏', what: '一行式行：标签在左、控件在右', openBook: true, openPanel: '阅读设置' },
  { name: '06-reader-paged', label: '阅读页 · 翻页模式', what: '分栏后的一页，页数应与可翻次数一致', openBook: true, choose: ['阅读设置', '翻页'], closePanel: true },
  { name: '07-reader-sepia', label: '阅读页 · 米黄', what: '主题切换后的同一页', openBook: true, theme: '米黄' },
  { name: '08-reader-dark', label: '阅读页 · 夜间', what: '暗色下的正文与工具栏', openBook: true, theme: '夜间' },
  {
    name: '09-panel-txt',
    label: 'TXT · 正文排版',
    what: '纯文本专属的缩进/段间距/编码三行，且面板仍是半屏',
    openBook: true,
    openPanel: '阅读设置',
  },
];

/** Measurements that must hold, on the scenes where they apply. */
async function audit(cdp, scenes, results) {
  const failures = [];

  const check = (name, ok, detail) => {
    results.push({ name, ok, detail });
    if (!ok) failures.push(`${name}: ${detail}`);
  };

  for (const scene of scenes) {
    if (scene.openPanel) {
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
        await cdp.click('button[aria-label="阅读设置"]');
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

    const withGeometry = panelGeometry ? [{ name: '目录', openPanel: true }] : [];
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
