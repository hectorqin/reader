import {expect,it} from 'vitest';
import {parseRoute,routeHash} from '../src/ui/router.ts';
it('keeps playback item and part identities in every player URL',()=>{
  for(const page of ['player','player/lyrics','player/queue','player/chapters'] as const){
    const route={name:'media' as const,channel:'music' as const,itemId:'track-id',page,params:{part:'part-id'}};
    expect(parseRoute(routeHash(route))).toEqual(route);
    expect(routeHash(route)).toContain('/player/track-id/part-id');
  }
});
it('keeps return origins out of shareable URLs',()=>{
  expect(routeHash({name:'media',channel:'music',itemId:'track',page:'track',returnTo:'#/media/music/albums?offset=60'})).toBe('#/media/music/track/track');
});
