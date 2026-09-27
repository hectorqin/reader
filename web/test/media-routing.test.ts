import { describe, expect, it } from 'vitest';
import { parseRoute, routeHash, parentOf, sameRoute } from '../src/ui/router.ts';

describe('media route isolation',()=>{
  it('round trips channel and detail links without changing reading paths',()=>{
    for(const channel of ['video','music','audiobook'] as const){
      const route={name:'media' as const,channel,itemId:'作品 / 01'};
      expect(parseRoute(routeHash(route))).toEqual(route);
      expect(parentOf(route)).toEqual({...route,itemId:''});
      expect(sameRoute(route,{...route,itemId:'different'})).toBe(false);
    }
    expect(parseRoute('#/book/book-id')).toEqual({name:'book',bookId:'book-id'});
    expect(parseRoute('#/sources')).toEqual({name:'sources'});
    expect(parseRoute('#/media')).toEqual({name:'media',channel:'video',itemId:''});
  });
});
