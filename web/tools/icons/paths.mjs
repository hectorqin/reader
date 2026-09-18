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
 * Only absolute/relative M, L, H, V, C, Q, A and Z are used; see `path.mjs`.
 */
export const GLYPHS = {
  menu: 'M4 6h16M4 12h16M4 18h16',
  'chevron-left': 'M15 5l-7 7 7 7',
  'chevron-right': 'M9 5l7 7-7 7',
  'arrow-left': 'M11 5l-7 7 7 7M4 12h16',
  folder: 'M3 7h6l2 2.5h10V19H3z',
  file: 'M6.5 3h7l4.5 4.5V21h-11.5z',
  sliders: 'M4 8h16M4 16h16M10 4.8v6.4M14 12.8v6.4',
  search: 'M10.5 17a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13zM15.5 15.5L20 20',
  close: 'M6 6l12 12M18 6L6 18',
  plus: 'M12 5v14M5 12h14',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  upload: 'M12 20V6M7 11l5-5 5 5M5 4h14',
  trash: 'M5 7h14M9 7V4h6v3M7 7l1 13h8l1-13M11 10v7M13 10v7',
  download: 'M12 4v14M7 13l5 5 5-5M5 20h14',
  refresh: 'M18.5 12A6.5 6.5 0 1 1 16.4 7M18.5 3.8v4h-4',
  book: 'M12 7.2c-1.4-1.2-3.2-1.9-5.4-1.9H4.8v12.4h1.8c2.2 0 4 .7 5.4 1.9M12 7.2c1.4-1.2 3.2-1.9 5.4-1.9h1.8v12.4h-1.8c-2.2 0-4 .7-5.4 1.9M12 7.2v12.4',
  shelf: 'M4 5.5h16M4 18.5h16M8 5.5v13M16 5.5v13',
  play: 'M8 5l11 7-11 7z',
  pause: 'M9 5v14M15 5v14',
  'skip-back': 'M18 6v12l-9-6zM6 6v12',
  'skip-forward': 'M6 6v12l9-6zM18 6v12',
  stop: 'M7 7h10v10H7z',
  speaker: 'M4 10v4h3l4.5 3.5V6.5L7 10zM15.5 9.8a3 3 0 0 1 0 4.4M18.4 7.4a6.2 6.2 0 0 1 0 9.2',
  moon: 'M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z',
  sun: 'M12 16.5a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9zM12 3v2.2M12 18.8V21M3 12h2.2M18.8 12H21M5.6 5.6l1.6 1.6M16.8 16.8l1.6 1.6M18.4 5.6l-1.6 1.6M7.2 16.8l-1.6 1.6',
  eye: 'M2.5 12S6 6.8 12 6.8 21.5 12 21.5 12 18 17.2 12 17.2 2.5 12 2.5 12zM12 14.6a2.6 2.6 0 1 0 0-5.2 2.6 2.6 0 0 0 0 5.2z',
  info: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 11v6M12 7.6v.4',
  alert: 'M12 4l9 16H3zM12 10v4M12 17v.4',
  clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7.5V12l3 2',
  'folder-open': 'M3 7h6l2 2.5h10V11M3 7v12h5l2-3h11l-2 3H3',
  more: 'M6.2 12h.06M12 12h.06M17.8 12h.06',
  pen: 'M4 20h4L20 8l-4-4L4 16zM14 6l4 4',
  sort: 'M7 5v14M4 16l3 3 3-3M13 6h7M13 11h5M13 16h3',
  power: 'M12 3v8M7.5 6.5a7 7 0 1 0 9 0',
  logout: 'M14 5H6v14h8M11 12h10M18 9l3 3-3 3',
  'plus-circle': 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 8.5v7M8.5 12h7',
  'text-indent': 'M4 5h16M8 10h12M8 14h12M4 10v4M4 20h16',
  'text-type': 'M5 6V4.5h14V6M12 4.5V19M9.5 19h5',
  'spacing': 'M4 4h16M4 20h16M12 7v10M9.5 9.5L12 7l2.5 2.5M9.5 14.5L12 17l2.5-2.5',
  settings: 'M12 6.2L13.68 3.57L15.29 4.05L15.22 7.18L16.1 7.9L19.15 7.22L19.95 8.71L17.69 10.87L17.8 12L20.43 13.68L19.95 15.29L16.82 15.22L16.1 16.1L16.78 19.15L15.29 19.95L13.13 17.69L12 17.8L10.32 20.43L8.71 19.95L8.78 16.82L7.9 16.1L4.85 16.78L4.05 15.29L6.31 13.13L6.2 12L3.57 10.32L4.05 8.71L7.18 8.78L7.9 7.9L7.22 4.85L8.71 4.05L10.87 6.31ZM12 9.2a2.8 2.8 0 1 0 0 5.6 2.8 2.8 0 0 0 0-5.6z',
};
