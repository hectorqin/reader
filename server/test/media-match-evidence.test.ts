import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchEvidence } from '../src/media/match-evidence.ts';
import type { MediaItem } from '../src/media/catalog.ts';
const item:MediaItem={id:'i',libraryId:'l',parentId:null,kind:'movie',title:'电影 2',ordinal:0,metadata:{year:2024},overrides:{}};
test('matching evidence requires corroboration and never drops sequel numbers',()=>{
  assert.equal(matchEvidence(item,{externalId:'1',title:'电影２',year:2024}).level,'strong');
  assert.equal(matchEvidence(item,{externalId:'1',title:'电影',year:2024}).level,'review');
  assert.equal(matchEvidence(item,{externalId:'1',title:'电影2'}).level,'review');
  assert.equal(matchEvidence(item,{externalId:'1',title:'电影2',year:2004}).level,'conflict');
  assert.equal(matchEvidence({...item,overrides:{year:2004}},{externalId:'1',title:'电影2',year:2004}).level,'strong');
  const music={...item,kind:'album' as const,metadata:{year:2024,artist:'歌手甲'}};
  assert.equal(matchEvidence(music,{externalId:'1',title:'电影2',year:2024,artist:'歌手甲'}).level,'strong');
  assert.equal(matchEvidence(music,{externalId:'1',title:'电影2',year:2024,artist:'歌手乙'}).level,'conflict');
  assert.equal(matchEvidence({...music,kind:'audiobook'},{externalId:'1',title:'电影2',year:2024,artist:'歌手甲'}).level,'review');
});
