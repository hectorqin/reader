import { render } from '../src/shared/ui/render-root.ts';
// @vitest-environment jsdom
import {afterEach,expect,it,vi} from 'vitest';
import {act} from 'react';

import {MediaDetailHeading} from '../src/features/media/components/detail-heading.tsx';
import {EditionDetails} from '../src/features/media/components/edition-details.tsx';
import type {Edition,Item,MediaApi} from '../src/features/media/api/media-api.ts';

const root=document.createElement('div');document.body.append(root);
afterEach(()=>act(()=>render(null,root)));
const item:Item={id:'book',libraryId:'books',kind:'audiobook',title:'山间来信',parentId:null,metadata:{author:'来源作者',narrator:'周宁',year:2024},overrides:{author:'人工作者'}};
const edition:Edition={id:'original',label:'完整演播版',parts:[{id:'one',assetId:'file',title:'第一章',start:0,end:3600,available:true},{id:'two',assetId:'file',title:'第二章',start:3600,end:6480,available:true}]};

it('shows known library, overridden credits and the selected edition duration without double counting chapter starts',()=>{
  act(()=>render(<MediaDetailHeading item={item} libraryName="床头故事" edition={edition}/>,root));
  expect(root.querySelector('.media-detail-kind')?.textContent).toBe('有声书');expect(root.textContent).not.toContain('完整演播版');expect(root.textContent).toContain('人工作者 著 · 周宁 演播 · 2024');expect(root.textContent).not.toContain('来源作者');
  expect(root.textContent).toContain('2 章');expect(root.textContent).toContain('1 小时 48 分');
  act(()=>render(<MediaDetailHeading item={item} edition={{...edition,parts:[{...edition.parts[0]!,end:null}]}}/>,root));
  expect(root.textContent).toContain('1 章');expect(root.textContent).not.toContain('小时');expect(root.textContent).not.toContain('0 秒');
});

it('does not render a zero duration for an empty edition',()=>{
  act(()=>render(<MediaDetailHeading item={{...item,kind:'movie',title:'无资源电影'}} edition={{...edition,label:'空版本',parts:[]}}/>,root));
  expect(root.textContent).not.toContain('0 秒');
});

it('offers explicit alternate-version and refresh actions for a wholly missing edition',()=>{
  const refresh=vi.fn(),choose=vi.fn(),play=vi.fn();
  act(()=>render(<EditionDetails api={{} as MediaApi} edition={{...edition,parts:edition.parts.map(part=>({...part,available:false}))}} busy={false} onPlay={play} onQueue={vi.fn()} onRefresh={refresh} onChooseVersion={choose} showTools={false}/>,root));
  expect(root.textContent).toContain('这个版本的资源已缺失');expect(play).not.toHaveBeenCalled();
  act(()=>[...root.querySelectorAll('button')].find(button=>button.textContent==='选择其他版本')!.click());expect(choose).toHaveBeenCalledOnce();
  act(()=>[...root.querySelectorAll('button')].find(button=>button.textContent==='刷新资源状态')!.click());expect(refresh).toHaveBeenCalledOnce();
  expect([...root.querySelectorAll<HTMLButtonElement>('[aria-label="资源缺失"]')].every(button=>button.disabled)).toBe(true);
});
