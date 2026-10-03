import { render } from '../src/shared/ui/render-root.ts';
// @vitest-environment jsdom
import {afterEach,expect,it} from 'vitest';
import {act} from 'react';

import {ArtistInfo} from '../src/features/media/components/artist-info.tsx';
import type {Item} from '../src/features/media/api/media-api.ts';
const root=document.createElement('div');document.body.append(root);
const item:Item={id:'artist',libraryId:'lib',kind:'artist',parentId:null,title:'Artist',overrides:{},metadata:{artistType:'Group',artistArea:'United Kingdom',artistDisambiguation:'<script>name collision</script>'}};
afterEach(()=>act(()=>render(null,root)));
it('labels associated area and disambiguation accurately and renders source text safely',()=>{
  act(()=>render(<ArtistInfo item={item}/>,root));
  expect(root.textContent).toContain('组合');expect(root.textContent).toContain('关联地区United Kingdom');
  expect(root.textContent).toContain('同名区分说明<script>name collision</script>');expect(root.querySelector('script')).toBeNull();
  expect(root.textContent).not.toContain('国籍');
});
it('omits an empty or unrelated artist profile',()=>{
  act(()=>render(<ArtistInfo item={{...item,metadata:{}}}/>,root));expect(root.textContent).toBe('');
  act(()=>render(<ArtistInfo item={{...item,kind:'track'}}/>,root));expect(root.textContent).toBe('');
});
