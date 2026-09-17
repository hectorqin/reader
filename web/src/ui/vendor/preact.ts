/**
 * The framework, re-exported from exactly one place.
 *
 * Every component imports Preact from here rather than from `preact` directly, so
 * the bundle has a single entry into the runtime and so a future swap (or a
 * version pin) is one file rather than a search-and-replace across the UI. It
 * also documents *what* the UI layer is allowed to use: the runtime and hooks,
 * not `preact/compat` — there is no React compatibility layer in here, no
 * `react-dom`, and nothing that would pull in either.
 *
 * `preact/hooks` is `useState`/`useRef`/`useEffect` implemented in ~1.5KB gzip
 * on top of the runtime's own scheduler, which is the whole reason the numbers
 * work out: the UI layer costs about 6KB gzip, not the 45KB a React build would.
 */
export { createElement, Fragment, render, type ComponentChildren, type VNode } from 'preact';
export { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
export type { JSX } from 'preact';
