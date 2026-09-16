import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseFilename, detectLanguage } from '../src/indexer/filename.ts';

test('parses "title - author" when the author is a recognisable CJK name', () => {
  const r = parseFilename('红楼梦 - 曹雪芹.epub');
  assert.equal(r.title, '红楼梦');
  assert.equal(r.author, '曹雪芹');
  assert.equal(r.language, 'zh');
});

test('parses "author - title" when the author is a recognisable CJK name', () => {
  const r = parseFilename('金庸 - 射雕英雄传.epub');
  assert.equal(r.title, '射雕英雄传');
  assert.equal(r.author, '金庸');
});

test('parses the 《title》author shape', () => {
  const r = parseFilename('《三体》刘慈欣.epub');
  assert.equal(r.title, '三体');
  assert.equal(r.author, '刘慈欣');
});

test('parses the "author - 《title》" shape', () => {
  const r = parseFilename('刘慈欣 - 《三体》.epub');
  assert.equal(r.title, '三体');
  assert.equal(r.author, '刘慈欣');
});

test('leaves a genuinely ambiguous CJK pair unsplit rather than guessing', () => {
  // "基地" is not a personal name and neither side carries a marker, so the
  // correct behaviour is to keep the whole string and report no author.
  const r = parseFilename('基地 - 阿西莫夫.epub');
  assert.equal(r.title, '基地 - 阿西莫夫');
  assert.equal(r.author, '');
});

test('extracts series and index from bracket style', () => {
  const r = parseFilename('[银河帝国 01] 基地.epub');
  assert.equal(r.series, '银河帝国');
  assert.equal(r.seriesIndex, 1);
  assert.equal(r.title, '基地');
});

test('extracts series from 第N卷 style', () => {
  const r = parseFilename('射雕英雄传（第1卷）.epub');
  assert.equal(r.series, '射雕英雄传');
  assert.equal(r.seriesIndex, 1);
  assert.equal(r.title, '射雕英雄传');
});

test('keeps author and title apart when a volume marker is present', () => {
  const r = parseFilename('金庸 - 射雕英雄传（第2册）.epub');
  assert.equal(r.title, '射雕英雄传');
  assert.equal(r.author, '金庸');
  assert.equal(r.seriesIndex, 2);
});

test('a bracket holding only a number sets the index but not a series name', () => {
  const r = parseFilename('[01] 基地.epub');
  assert.equal(r.series, '');
  assert.equal(r.seriesIndex, 1);
  assert.equal(r.title, '基地');
});

test('parses trailing parenthesised author', () => {
  const r = parseFilename('活着 (余华).epub');
  assert.equal(r.title, '活着');
  assert.equal(r.author, '余华');
});

test('strips download-site noise', () => {
  const r = parseFilename('红楼梦 - 曹雪芹 (z-lib.org).epub');
  assert.equal(r.title, '红楼梦');
  assert.equal(r.author, '曹雪芹');
  assert.ok(!r.title.includes('z-lib'));
});

test('keeps latin titles intact', () => {
  const r = parseFilename('The Pragmatic Programmer - Hunt, Andrew.epub');
  assert.equal(r.title, 'The Pragmatic Programmer');
  assert.equal(r.author, 'Hunt, Andrew');
  assert.equal(r.language, 'en');
});

test('falls back to the raw filename when no separator exists', () => {
  const r = parseFilename('深入理解计算机系统.epub');
  assert.equal(r.title, '深入理解计算机系统');
  assert.equal(r.author, '');
});

test('detectLanguage distinguishes ja from zh', () => {
  assert.equal(detectLanguage('ノルウェイの森'), 'ja');
  assert.equal(detectLanguage('挪威的森林'), 'zh');
  assert.equal(detectLanguage('Norwegian Wood'), 'en');
});
