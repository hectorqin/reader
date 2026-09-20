/**
 * A very small CDP client.
 *
 * Enough to drive a headless Chromium from Node with no dependencies: the tools
 * here are used to render the bundle, click a few things, take a screenshot and
 * read a measurement out of the page. A general-purpose automation library would
 * bring a test framework, an assertion style and a selector engine with it, and
 * the whole point of this tool is that it can be read in one sitting — a harness
 * nobody understands is a harness nobody trusts when it fails.
 *
 * It uses the raw protocol over the WebSocket that Chromium prints on startup,
 * which is the one interface that does not change between versions.
 */

import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Where to look for a Chromium, in order.
 *
 * `CHROME_PATH` wins so CI can point at whichever browser its image ships — the
 * CI runner sets it, and a glob is expanded here rather than by the shell so it
 * works the same way on any host. The rest are the names a Chromium has on the
 * common distributions, plus Playwright's own directory, because a runner that
 * already has Playwright is the cheapest place to get a browser.
 */
const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  'chromium',
  'chromium-browser',
  'google-chrome',
  'google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/local/bin/chromium',
  ...globPlaywrightChrome(),
].filter(Boolean);

/** The WebSocket client, taken from the global Node provides. */
const WebSocketImpl = globalThis.WebSocket;

export class CDP {
  constructor(ws, proc, profile) {
    this.ws = ws;
    this.proc = proc;
    this.profile = profile;
    this.nextId = 1;
    this.pending = new Map();
    this.events = new Map();
    this.viewport = { width: 0, height: 0 };
  }

  /** Launches Chromium and attaches to the first page target. */
  static async launch({ viewport, scale = 1 }) {
    if (!WebSocketImpl) throw new Error('this Node has no global WebSocket; Node 22+ is required');

    const profile = await mkdtemp(join(tmpdir(), 'reader-ui-review-'));
    const binary = await findChrome();
    const proc = spawn(
      binary,
      [
        '--headless=new',
        '--no-sandbox',
        '--disable-dev-shm-usage',
        '--hide-scrollbars',
        // Fixed device metrics rather than `--window-size`: the screenshot has to
        // be the *viewport* at the size a phone would have, and a window includes
        // browser chrome that would make the measurement meaningless.
        '--remote-debugging-port=0',
        `--user-data-dir=${profile}`,
        '--no-first-run',
        '--disable-gpu',
        'about:blank',
      ],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );

    const endpoint = await readDevToolsEndpoint(proc);
    const ws = new WebSocketImpl(endpoint);
    await new Promise((resolve, reject) => {
      ws.addEventListener('open', resolve, { once: true });
      ws.addEventListener('error', (event) => reject(new Error(`ws error: ${event?.message ?? 'unknown'}`)), { once: true });
    });

    const cdp = new CDP(ws, proc, profile);
    cdp.viewport = { width: viewport.width, height: viewport.height };
    ws.addEventListener('message', (event) => cdp.#onMessage(event.data));

    const { targetInfos } = await cdp.send('Target.getTargets');
    const page = targetInfos.find((t) => t.type === 'page');
    const { sessionId } = await cdp.send('Target.attachToTarget', { targetId: page.targetId, flatten: true });
    cdp.sessionId = sessionId;

    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: viewport.width,
      height: viewport.height,
      deviceScaleFactor: scale,
      mobile: true,
    });
    return cdp;
  }

  #onMessage(raw) {
    const message = JSON.parse(typeof raw === 'string' ? raw : raw.toString());
    if (message.id !== undefined) {
      const entry = this.pending.get(message.id);
      if (!entry) return;
      this.pending.delete(message.id);
      if (message.error) entry.reject(new Error(`${entry.method}: ${message.error.message}`));
      else entry.resolve(message.result);
      return;
    }
    const handlers = this.events.get(message.method);
    if (handlers) for (const handler of handlers) handler(message.params);
  }

  on(method, handler) {
    const handlers = this.events.get(method) ?? [];
    handlers.push(handler);
    this.events.set(method, handlers);
  }

  send(method, params = {}) {
    const id = this.nextId++;
    const payload = { id, method, params };
    if (this.sessionId && !method.startsWith('Target.')) payload.sessionId = this.sessionId;
    this.ws.send(JSON.stringify(payload));
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject, method });
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`${method} timed out`));
        }
      }, 20_000);
    });
  }

  /**
   * Evaluates an *expression* in the page and returns its value.
   *
   * An expression, not a statement body — `document.querySelector(x) !== null` is
   * an expression and evaluating it as `{ ... }` silently returns `undefined`, which
   * turns every check written this way into a false negative. A multi-statement body
   * belongs in `run`, where the `return` is written out.
   */
  async evaluate(expression) {
    const result = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) {
      throw new Error(`page error: ${result.exceptionDetails.exception?.description ?? result.exceptionDetails.text}`);
    }
    return result.result.value;
  }

  /**
   * How many requests the stand-in API has answered, by name.
   *
   * Read from the page rather than from Node, because that is where the review's own
   * origin is: the harness server logs every request it sees, and the page is the
   * only party that can reach it without the tool growing its own HTTP client. The
   * endpoint returns *counts* rather than the log so the assertion is a comparison of
   * two numbers instead of a scan of a growing array.
   */
  async requestCounts() {
    const counts = await this.evaluate(`fetch('/__counts').then((r) => r.json())`);
    return counts && typeof counts === 'object' ? counts : {};
  }

  /**
   * Runs a statement body in the page, with its own `return`.
   *
   * `async` so a body can `await` — measuring a screen after a fetch settles is the
   * common case, and a synchronous wrapper would silently forbid it.
   */
  async run(source) {
    return this.evaluate(`(async () => { ${source} })()`);
  }

  /**
   * Loads a URL as a *fresh document*.
   *
   * `Page.navigate` to a URL that differs only in the fragment does not reload — it
   * fires `hashchange` and the SPA routes in place, which is correct browser
   * behaviour and useless here: the review's scenes have to start from a known state
   * every time, and a scene that inherited the previous scene's route would be a
   * screenshot of the wrong screen with no sign that anything went wrong.
   */
  async navigate(url) {
    // `Page.navigate` to a URL that differs only in the fragment does not reload —
    // it fires `hashchange` and the SPA routes in place. That is correct browser
    // behaviour and useless here: every scene has to start from a known state, and a
    // scene that inherited the previous scene's route would be a screenshot of the
    // wrong screen with nothing to say so. The timestamp makes each navigation a
    // *different* URL, which forces the load.
    const busted = url.includes('#') ? `${url.split('#')[0]}?t=${Date.now()}#${url.split('#')[1]}` : url;
    await this.send('Page.navigate', { url: busted });
    await this.waitFor('document.readyState === "complete"');
  }

  /** Polls an expression until it is truthy, or fails loudly. */
  async waitFor(expression, timeout = 10_000) {
    const deadline = Date.now() + timeout;
    let last;
    while (Date.now() < deadline) {
      try {
        last = await this.execute(expression);
        if (last) return;
      } catch (err) {
        last = err.message;
      }
      await sleep(60);
    }
    throw new Error(`waitFor timed out: ${expression} (last: ${JSON.stringify(last)})`);
  }

  /** Evaluates a bare expression (not wrapped in a function body). */
  async execute(expression) {
    const result = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) return false;
    return result.result.value;
  }

  /**
   * Clicks the first element matching a CSS selector, at its centre.
   *
   * Two things this deliberately does *not* do:
   *
   *  - It does not call `element.click()`. A synthetic click skips pointer events
   *    entirely, and this app's page turns, panel dismissals and toolbar toggles are
   *    all pointer gestures — a click dispatched from `element.click()` would test a
   *    path no finger ever takes, and would pass on a control that a real tap cannot
   *    reach.
   *  - It does not assume the element is on screen. A settings row inside a
   *    scrollable sheet is routinely below the fold, and a click at its raw
   *    coordinates lands on whatever *is* on screen at that y — which is how a
   *    review ends up asserting that a control works while nothing on the page
   *    changed. The element is scrolled into view first, then measured.
   */
  async #centreOf(expression) {
    await this.execute(`(() => {
      const el = ${expression};
      if (el && el.scrollIntoView) el.scrollIntoView({ block: 'center', inline: 'center' });
    })()`);
    await sleep(60);
    const box = await this.execute(`(() => {
      const el = ${expression};
      if (!el) return null;
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) return null;
      return { x: r.left + r.width / 2, y: r.top + r.height / 2, top: r.top, bottom: r.bottom };
    })()`);
    if (!box) return null;
    // An element taller than the viewport has no reachable centre; its top edge is
    // the part a reader would aim at.
    if (box.y < 0) return { x: box.x, y: Math.max(4, box.top + 4) };
    if (box.y > this.viewport.height) return { x: box.x, y: Math.min(this.viewport.height - 4, box.bottom - 4) };
    return box;
  }

  async click(selector) {
    const box = await this.#centreOf(`document.querySelector(${JSON.stringify(selector)})`);
    if (!box) throw new Error(`no visible element for ${selector}`);
    await this.#clickAt(box.x, box.y);
  }

  /**
   * Clicks the first element matching `selector` whose visible label is `text`.
   *
   * Compared on the element's *label* rather than on `textContent`, and the difference
   * is not pedantry: an icon is a private-use character inside the control, so the raw
   * text of a button with a glyph beside its words is the glyph followed by the words
   * — `"\ue927浏览书籍"`, which never equals `"浏览书籍"`. The helper used to compare
   * the raw text, which worked for as long as every control it was asked for happened
   * to be pure text.
   *
   * The label is the last `<span>` when there is one (which is where `IconTextButton`
   * puts its words) and the whole text otherwise. A control with no label at all is
   * matched on its `aria-label`, so an icon-only button is still reachable by name.
   */
  async clickText(selector, text) {
    const box = await this.#centreOf(`(() => {
      const match = [...document.querySelectorAll(${JSON.stringify(selector)})].find((n) => {
        const spans = [...n.querySelectorAll('span')];
        const label = (spans.length > 0 ? spans[spans.length - 1].textContent : n.textContent) ?? '';
        return label.trim() === ${JSON.stringify(text)} || n.getAttribute('aria-label') === ${JSON.stringify(text)};
      });
      return match ?? null;
    })()`);
    if (!box) throw new Error(`no visible ${selector} with text ${text}`);
    await this.#clickAt(box.x, box.y);
  }

  async fill(selector, value) {
    await this.click(selector);
    await this.send('Input.insertText', { text: value });
  }

  /**
   * A horizontal swipe across the middle of the reading area: a page turn.
   *
   * Dispatched as *touch* events rather than a click, because that is what the
   * gesture layer listens for and what a page turn in this app actually is. The
   * intermediate moves matter: a single `touchStart`/`touchEnd` pair is a tap, and
   * the gesture layer decides between the two from the distance travelled.
   */
  async swipePage(direction = 'next') {
    const box = await this.execute(`(() => {
      const el = document.querySelector('.stage');
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2, width: r.width };
    })()`);
    if (!box) throw new Error('no .stage to swipe');
    const travel = box.width * 0.35 * (direction === 'next' ? -1 : 1);
    const steps = 6;
    const points = (offset) => [{ x: box.x + offset, y: box.y }];
    await this.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: points(0) });
    for (let step = 1; step <= steps; step += 1) {
      await this.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: points((travel * step) / steps),
      });
      await sleep(16);
    }
    await this.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await sleep(160);
  }

  /** A tap in the middle of the reading area, which is the chrome toggle. */
  /**
   * A tap in one of the reading surface's three tap zones.
   *
   * Dispatched as *touch* rather than a click, because that is what the gesture
   * layer listens for and because the zone model is a touch model: a tap in the
   * outer third of a phone screen is how a reader turns a page, and reproducing it
   * as a mouse click would exercise a path the reader never takes.
   *
   * The zone is given as a fraction of the stage's width — 0.15 is the left third,
   * 0.85 the right — rather than as the zone's name, so the call sites state where
   * the finger went rather than asserting which zone the app thinks that is.
   */
  async tapThird(fraction) {
    const box = await this.execute(`(() => {
      const el = document.querySelector('.stage');
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.left + r.width * ${fraction}, y: r.top + r.height / 2 };
    })()`);
    if (!box) throw new Error('no .stage to tap');
    await this.#tapAt(box.x, box.y);
  }

  async tapMiddle() {
    const box = await this.execute(`(() => {
      const el = document.querySelector('.stage');
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    })()`);
    if (!box) throw new Error('no .stage to tap');
    await this.#tapAt(box.x, box.y);
  }

  async #clickAt(x, y) {
    for (const type of ['mousePressed', 'mouseReleased']) {
      await this.send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1, pointerType: 'mouse' });
    }
  }

  async #tapAt(x, y) {
    for (const type of ['touchStart', 'touchEnd']) {
      await this.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchStart' ? [{ x, y }] : [] });
    }
    await sleep(120);
  }

  /** Screenshots the visible viewport to a PNG file. */
  async screenshot(path) {
    const { data } = await this.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    const { writeFile } = await import('node:fs/promises');
    await writeFile(path, Buffer.from(data, 'base64'));
  }

  sleep(ms) {
    return sleep(ms);
  }

  async close() {
    try {
      this.ws.close();
    } catch {
      // Already gone.
    }
    this.proc.kill('SIGKILL');
    await rm(this.profile, { recursive: true, force: true }).catch(() => undefined);
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Reads the `ws://` endpoint Chromium prints on stderr once it is listening. */
function readDevToolsEndpoint(proc) {
  return new Promise((resolve, reject) => {
    let buffer = '';
    const timer = setTimeout(() => reject(new Error(`chromium did not report a devtools endpoint:\n${buffer}`)), 20_000);
    const onData = (chunk) => {
      buffer += chunk.toString();
      const match = /(ws:\/\/[^\s]+)/.exec(buffer);
      if (!match) return;
      clearTimeout(timer);
      proc.stderr.off('data', onData);
      resolve(match[1]);
    };
    proc.stderr.on('data', onData);
    proc.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    proc.on('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`chromium exited with ${code}:\n${buffer}`));
    });
  });
}

/**
 * Any Chromium under Playwright's browser directory.
 *
 * Read synchronously at module load rather than through a shell glob: this is the
 * one candidate whose exact path depends on the browser revision, and resolving it
 * here keeps `findChrome` a plain list of paths.
 */
function globPlaywrightChrome() {
  const roots = ['/ms-playwright', join(process.env.HOME ?? '/root', '.cache', 'ms-playwright')];
  const found = [];
  for (const root of roots) {
    let entries;
    try {
      entries = readdirSync(root);
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.startsWith('chromium')) continue;
      for (const relative of ['chrome-linux/chrome', 'chrome-linux/headless_shell']) {
        const candidate = join(root, entry, relative);
        if (existsSync(candidate)) found.push(candidate);
      }
    }
  }
  return found;
}

/** The first Chromium on the machine. */
async function findChrome() {
  const { execFile } = await import('node:child_process');
  for (const candidate of CHROME_CANDIDATES) {
    const ok = await new Promise((resolve) => {
      execFile(candidate, ['--version'], (err) => resolve(!err));
    });
    if (ok) return candidate;
  }
  throw new Error(`no Chromium found; tried ${CHROME_CANDIDATES.join(', ')}`);
}
