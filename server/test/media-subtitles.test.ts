import { test } from 'node:test';
import assert from 'node:assert/strict';
import { subtitleToVtt } from '../src/media/subtitles.ts';

test('SRT and VTT are normalized to safe plain-text cues', () => {
  const srt = '1\r\n00:00:01,100 --> 00:00:03,500\r\n<b>你好</b> & 世界\r\n\r\n2\r\n00:00:04,000 --> 00:00:02,000\r\ninvalid interval';
  assert.equal(subtitleToVtt(Buffer.from(srt), 'srt'), 'WEBVTT\n\n1\n00:00:01.100 --> 00:00:03.500\n你好 &amp; 世界\n');
  const vtt = 'WEBVTT\n\nSTYLE\n::cue { color:red; }\n\nNOTE invisible\n\nlabel\n00:01.000 --> 00:02.000 align:start\n<v Speaker>Hello</v>';
  assert.equal(subtitleToVtt(Buffer.from(vtt), 'vtt'), 'WEBVTT\n\n1\n00:00:01.000 --> 00:00:02.000\nHello\n');
});

test('ASS retains dialogue commas and line breaks, removes overrides and drawings', () => {
  const ass = '[Script Info]\nTitle: test\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\nDialogue: 0,0:00:01.20,0:00:04.50,Default,,0,0,0,,{\\i1}Hello, world\\N第二行\nDialogue: 0,0:00:01.20,0:00:04.50,Default,,0,0,0,,{\\p1}m 1 2 l 3 4';
  assert.equal(subtitleToVtt(Buffer.from(ass), 'ass'), 'WEBVTT\n\n1\n00:00:01.200 --> 00:00:04.500\nHello, world\n第二行\n');
});

test('subtitle encodings and invalid content have bounded behavior', () => {
  const text = '1\n00:00:01,000 --> 00:00:02,000\n中文';
  assert.ok(subtitleToVtt(Buffer.concat([Buffer.from([255,254]),Buffer.from(text,'utf16le')]), 'srt').includes('中文'));
  assert.throws(() => subtitleToVtt(Buffer.alloc(2*1024*1024+1), 'srt'), { code:'MEDIA_SUBTITLE_INVALID' });
  assert.throws(() => subtitleToVtt(Buffer.from('<html>not subtitles</html>'), 'vtt'), { code:'MEDIA_SUBTITLE_INVALID' });
  assert.throws(() => subtitleToVtt(Buffer.from(text), 'unknown'), { code:'MEDIA_SUBTITLE_INVALID' });
  assert.throws(() => subtitleToVtt(Buffer.from('1\n00:99:01,000 --> 00:99:02,000\nbad'), 'srt'), { code:'MEDIA_SUBTITLE_INVALID' });
});
