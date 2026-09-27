import {expect,it} from 'vitest';
import {parseRoute,routeHash,sameRoute,parentOf,type Route} from '../src/ui/router.ts';
import {mediaPages,isItemPage} from '../src/media/page-route.ts';

it.each(mediaPages)('round-trips the independent %s page',page=>{
  const params=page==='file'?{asset:'文件/01'}:page==='library-edit'||page==='library-permissions'?{library:'库/01'}:page==='narrator'||page==='narrator-work'?{narrator:'周宁',...(page==='narrator-work'?{work:'作品/01'}:{})}:undefined;
  const route:Route={name:'media',channel:page==='search'||page==='favorites'?'video':'music',itemId:isItemPage(page)?'作品/01':'',page,...(params?{params}:{})};
  expect(parseRoute(routeHash(route))).toEqual(route);
  expect(sameRoute(route,{name:'media',channel:'music',itemId:''})).toBe(false);
});
it('keeps personal-page origin in a reloadable URL and resolves deterministic parents',()=>{
  const page:Route={name:'media',channel:'audiobook',itemId:'',page:'history',fromSettings:true};
  expect(parseRoute(routeHash(page))).toEqual(page);
  expect(parentOf(page)).toEqual({name:'media',channel:'audiobook',itemId:'',page:'settings'});
  expect(parentOf({...page,fromSettings:false})).toEqual({name:'media',channel:'audiobook',itemId:''});
  expect(parentOf({...page,page:'settings/browse',fromSettings:false})).toEqual({name:'media',channel:'audiobook',itemId:'',page:'settings'});
  expect(sameRoute(page,{...page,fromSettings:false})).toBe(false);
});
it('keeps existing media detail and reading URLs unchanged',()=>{
  expect(parseRoute('#/media/video/film-42')).toEqual({name:'media',channel:'video',itemId:'film-42'});
  expect(routeHash(parseRoute('#/book/book-42'))).toBe('#/book/book-42');
});
it('keeps origin metadata out of URLs while retaining deterministic direct-link parents',()=>{
  const origin:Route={name:'media',channel:'music',itemId:'',page:'albums',params:{library:'music',offset:'60',sort:'title-asc'}};
  const detail:Route={name:'media',channel:'music',itemId:'album',page:'album',returnTo:routeHash(origin)};
  expect(parentOf(detail)).toEqual(origin);
  expect(routeHash(detail)).not.toContain('return=');
  expect(parentOf(parseRoute(routeHash(detail)))).toEqual({name:'media',channel:'music',itemId:'',page:'albums'});
  expect(parentOf({...detail,returnTo:'https://example.com'})).toEqual({name:'media',channel:'music',itemId:'',page:'albums'});
});
it('gives direct links useful parents without retaining a child selection',()=>{
  expect(parentOf(parseRoute('#/media/music/items/a/metadata'))).toEqual({name:'media',channel:'music',itemId:'a'});
  expect(parentOf(parseRoute('#/media/music/files/f?library=m&path=album'))).toEqual({name:'media',channel:'music',itemId:'',page:'folders',params:{library:'m',path:'album'}});
  expect(parentOf(parseRoute('#/media/audiobook/narrators/person/works/book'))).toEqual({name:'media',channel:'audiobook',itemId:'',page:'narrator',params:{narrator:'person'}});
});

it('uses a single global search URL and canonicalizes old channel links',()=>{
  expect(routeHash({name:'media',channel:'music',itemId:'',page:'search',returnTo:'#/media/music/albums',params:{q:'hello',scope:'all'}})).toBe('#/media/search?q=hello');
  expect(routeHash(parseRoute('#/media/audiobook/search?q=test&scope=music'))).toBe('#/media/search?q=test&scope=music');
  expect(parseRoute('#/media/search')).toEqual({name:'media',channel:'video',itemId:'',page:'search'});
});

it('uses a single cross-channel favorites URL and retains old links',()=>{
  for(const channel of ['video','music','audiobook'] as const){
    expect(routeHash({name:'media',channel,itemId:'',page:'favorites'})).toBe('#/media/favorites');
    expect(routeHash(parseRoute(`#/media/${channel}/favorites?offset=60&scope=music`))).toBe('#/media/favorites?offset=60&scope=music');
  }
  expect(parseRoute('#/media/favorites?scope=audiobook&from=settings')).toEqual({name:'media',channel:'video',page:'favorites',itemId:'',params:{scope:'audiobook'},fromSettings:true});
  expect(sameRoute(parseRoute('#/media/music/favorites'),parseRoute('#/media/favorites'))).toBe(true);
});

it('allows every favorite detail to return to the global collection with its filters',()=>{
  const origin='#/media/favorites?offset=60&scope=music';
  for(const [channel,page,itemId] of [['video','movie','film'],['music','album','album'],['music','artist','artist'],['audiobook','book','book']] as const){
    expect(parentOf({name:'media',channel,page,itemId,returnTo:origin})).toEqual(parseRoute(origin));
  }
});
