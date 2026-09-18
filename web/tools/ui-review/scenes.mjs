/**
 * The screens the UI review renders, as data.
 *
 * Each scene is a URL to load plus the interactions that put it into the state
 * worth looking at. They are *declared* here rather than written into the driver so
 * that adding a screen to the review is one entry, and so the list itself can be
 * read as the answer to "what do we actually look at".
 *
 * The distinction that matters: a *functional* test asserts that a tap changes the
 * state, and passes on a screen that is unusable. These scenes exist so a person
 * can see the result — which is the difference the issue asks for ("不要只考虑
 * 功能性").
 */

/** A book the harness serves, so the review never depends on a real library. */
export const FIXTURE = {
  bookId: 'review-book',
  title: '剑来',
  author: '烽火戏诸侯',
  chapters: [
    { title: '第一章 惊蛰', body: ['小镇上的人都知道，泥瓶巷住着一个少年。', '他叫陈平安。'] },
    { title: '第二章 山水', body: ['山上的风很大。', '他站在山顶，看了很久。'] },
    { title: '第三章 落雨', body: ['雨来了。', '他没有打伞，就这么走回去。'] },
  ],
};

/** A long chapter, so pagination has something to paginate. */
export const LONG_CHAPTER = Array.from({ length: 40 }, (_v, i) =>
  `第 ${i + 1} 段。这一段有足够多的字，用来把这一章撑到好几屏，这样翻页才看得出来。`,
).join('\n\n');

export const SCENES = [
  {
    name: 'reader-light',
    label: '阅读页 · 白',
    note: '顶栏（图标+文字）、正文、底栏滑杆与章节导航、状态药丸',
    steps: [],
  },
  {
    name: 'reader-chrome-hidden',
    label: '阅读页 · 收起工具栏',
    note: '点中间三分之一收起后，正文占满、右侧留快捷列、角上留章节与页码',
    steps: [{ tap: { x: 'center', y: 'center' } }],
  },
  {
    name: 'panel-toc',
    label: '目录 · 半屏',
    note: '打开目录：下半屏，上半屏仍然看得见正文',
    steps: [{ click: 'button[aria-label="目录"]' }],
  },
  {
    name: 'panel-settings',
    label: '阅读设置 · 半屏',
    note: '打开设置：行是「标签在左、控件在右」的一行式',
    steps: [{ click: 'button[aria-label="阅读设置"]' }],
  },
  {
    name: 'panel-settings-dark',
    label: '阅读设置 · 夜间',
    note: '夜间主题下同一张面板',
    steps: [{ click: 'button[aria-label="阅读设置"]' }, { click: 'button:has-text("夜间")' }],
  },
  {
    name: 'reader-paged',
    label: '阅读页 · 翻页模式',
    note: '分栏后的一页；底部的「本章 x/y 页」应当与正文对得上',
    steps: [{ click: 'button[aria-label="阅读设置"]' }, { click: 'button:has-text("翻页")' }, { click: 'button[aria-label="关闭"]' }],
  },
  {
    name: 'reader-txt-settings',
    label: 'TXT · 正文排版',
    note: '段落缩进 / 段间距 / 编码，只在 TXT 上出现',
    note_kind: 'txt',
    steps: [{ click: 'button[aria-label="阅读设置"]' }],
  },
];

export default { FIXTURE, LONG_CHAPTER, SCENES };
