import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseMediaRange } from '../src/media/playback.ts';

test('media range parser handles suffix, open end, clipping and invalid inputs',()=>{
  assert.equal(parseMediaRange(undefined,0),undefined);
  assert.deepEqual(parseMediaRange('bytes=10-',100),{start:10,end:99});
  assert.deepEqual(parseMediaRange('bytes=-20',100),{start:80,end:99});
  assert.deepEqual(parseMediaRange('bytes=-200',100),{start:0,end:99});
  assert.deepEqual(parseMediaRange('bytes=20-200',100),{start:20,end:99});
  for(const value of ['bytes=-0','bytes=-','bytes=100-','bytes=30-20','bytes=1-2,5-6','items=0-4','bytes=9007199254740992-'])assert.throws(()=>parseMediaRange(value,100));
  assert.throws(()=>parseMediaRange('bytes=0-',0));
});
