/**
 * The icon set.
 *
 * Every path is drawn on a 24x24 grid with a 3-unit stroke, so all icons share one
 * optical weight and one set of implicit margins. They are deliberately geometric
 * rather than hand-drawn: a set that is generated from the same stroke expansion is
 * the only way to guarantee that, and the guarantee is the reason the set exists —
 * mixing a font from one family with glyphs from another is what makes a UI look
 * assembled rather than designed.
 *
 * ## The names are the product's, and they are ours
 *
 * Every key is an English noun for the *thing the reader sees*, borrowed from the
 * vocabulary that is already all over this codebase and the web at large: `menu`,
 * `search`, `close`, `settings`, `library`, `shelf`. Nothing here is invented for the
 * sake of being different — 菜单 is `menu`, not `hamburger-glyph`, and anyone who has
 * written a web UI can guess what `arrow-left` draws.
 *
 * The set used to borrow the **Font Awesome 6** names verbatim (`bars`,
 * `magnifying-glass`, `xmark`, `gear`, `table-columns`, `arrows-rotate`, …). It was
 * reverted, and the reason is worth keeping: a borrowed name is a **claim about
 * another product's artwork**. `magnifying-glass` is also the name of a Font Awesome
 * glyph, so a reader who knows that set opens this file expecting the glyph they know
 * and finds a different one — every time, for every borrowed name. The vocabulary was
 * supposed to stop "the magnifier has three names"; what it actually did was make the
 * one name untrustworthy. The geometry was never Font Awesome's, so the names should
 * not have been either. See `docs/ui.md` §1.2.
 *
 * ## What the names have to satisfy
 *
 *  - **one glyph per idea**, so a control and its label and its test cannot drift onto
 *    different shapes;
 *  - **the name says what it draws**, because that is the only thing that makes a
 *    name better than a code point;
 *  - **no two glyphs share a path**, which `test/icons.test.ts` pins by comparing the
 *    flattened geometry rather than the strings.
 *
 * Only absolute/relative M, L, H, V, C, Q, A and Z are used; see `path.mjs`.
 */
export const GLYPHS = {
  'menu': 'M4 7h16M4 12h16M4 17h16',
  'chevron-left': 'M14.5 5.5L8 12l6.5 6.5',
  'chevron-right': 'M9.5 5.5L16 12l-6.5 6.5',
  'arrow-left': 'M10.5 5.5L4 12l6.5 6.5M4 12h16',
  'folder': 'M4 6.5h5l1.8 2H20V19H4z',
  'file-text': 'M7 3.5h6.5L18 8v12.5H7zM13.5 3.5V8H18M10 12h5M10 15.5h5',
  'sliders': 'M5 8.5h14M5 15.5h14M9.5 5.5v6M14.5 12.5v6',
  'search': 'M11 16.5a5.5 5.5 0 1 0 0-11 5.5 5.5 0 0 0 0 11zM15 15l4.5 4.5',
  'close': 'M6.5 6.5l11 11M17.5 6.5l-11 11',
  'plus': 'M12 5v14M5 12h14',
  'check': 'M5.5 12.5l4.5 4.5L18.5 7',
  'upload': 'M12 20V6.5M7.5 11L12 6.5l4.5 4.5M5 4h14',
  'trash': 'M5 7h14M9.5 7V4h5v3M7 7l1 13h8l1-13M11 10.5v6M13 10.5v6',
  'download': 'M12 4v13.5M7.5 13l4.5 4.5 4.5-4.5M5 20h14',
  'refresh': 'M19 12a7 7 0 1 1-2.3-5.2M19 3.5v4.2h-4.2',
  'book': 'M12 7.2c-1.4-1.2-3.2-1.9-5.4-1.9H4.8v12.4h1.8c2.2 0 4 .7 5.4 1.9M12 7.2c1.4-1.2 3.2-1.9 5.4-1.9h1.8v12.4h-1.8c-2.2 0-4 .7-5.4 1.9M12 7.2v12.4',
  'shelf': 'M4 5.5h16M4 18.5h16M8 5.5v13M16 5.5v13',
  'play': 'M8 5l11 7-11 7z',
  'pause': 'M9.5 5.5v13M14.5 5.5v13',
  'step-backward': 'M17.5 6v12l-8-6zM6.5 6v12',
  'step-forward': 'M6.5 6v12l8-6zM17.5 6v12',
  'stop': 'M7 7h10v10H7z',
  'volume': 'M4 10v4h3l4.5 3.5V6.5L7 10zM15.5 9.8a3 3 0 0 1 0 4.4M18.4 7.4a6.2 6.2 0 0 1 0 9.2',
  'moon': 'M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z',
  'sun': 'M12 16.5a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9zM12 3v2.2M12 18.8V21M3 12h2.2M18.8 12H21M5.6 5.6l1.6 1.6M16.8 16.8l1.6 1.6M18.4 5.6l-1.6 1.6M7.2 16.8l-1.6 1.6',
  'eye': 'M2.5 12S6 6.8 12 6.8 21.5 12 21.5 12 18 17.2 12 17.2 2.5 12 2.5 12zM12 14.6a2.6 2.6 0 1 0 0-5.2 2.6 2.6 0 0 0 0 5.2z',
  'info': 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 11v6M12 7.6v.4',
  'warning': 'M12 4l9 16H3zM12 10v4M12 17v.4',
  'clock': 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7.5V12l3 2',
  'more': 'M6.2 12h.06M12 12h.06M17.8 12h.06',
  'edit': 'M4 20h4L20 8l-4-4L4 16zM14 6l4 4',
  'sort': 'M7 5v14M4 16l3 3 3-3M13 6h7M13 11h5M13 16h3',
  'logout': 'M12 3v8M7.5 6.5a7 7 0 1 0 9 0',
  'sign-out': 'M14 5H6v14h8M11 12h10M18 9l3 3-3 3',
  'add-circle': 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 8.5v7M8.5 12h7',
  'indent': 'M4 5h16M8 10h12M8 14h12M4 10v4M4 20h16',
  'text-size': 'M5 6V4.5h14V6M12 4.5V19M9.5 19h5',
  'line-height': 'M4 4h16M4 20h16M12 7v10M9.5 9.5L12 7l2.5 2.5M9.5 14.5L12 17l2.5-2.5',
  'settings': 'M12 15.4a3.4 3.4 0 1 0 0-6.8 3.4 3.4 0 0 0 0 6.8zM19.6 12a7.6 7.6 0 0 0-.1-1.2l2-1.5-2-3.4-2.4 1a7.6 7.6 0 0 0-2.1-1.2L14.6 3H9.4L9 5.7a7.6 7.6 0 0 0-2.1 1.2l-2.4-1-2 3.4 2 1.5a7.6 7.6 0 0 0 0 2.4l-2 1.5 2 3.4 2.4-1a7.6 7.6 0 0 0 2.1 1.2l.4 2.7h5.2l.4-2.7a7.6 7.6 0 0 0 2.1-1.2l2.4 1 2-3.4-2-1.5c.1-.4.1-.8.1-1.2z',
  'library': 'M4.5 5.2h3.4v14H4.5zM10.3 5.2h3.4v14h-3.4zM16.6 5.8l3.2.7-2.9 13.3-3.2-.7z',
  'tune': 'M4 8.5h9M17 8.5h3M4 15.5h3M11 15.5h9M15 6.5v4M9 13.5v4',
};
