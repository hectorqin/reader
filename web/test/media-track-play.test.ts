// @vitest-environment jsdom
import {expect,it,vi} from 'vitest';
import {MediaScreen} from '../src/media/screen.tsx';

it('plays a single complete version and routes ambiguous or missing resources to details',async()=>{
  const part={id:'part',available:true},play=vi.fn(),openTrack=vi.fn();
  const detail=vi.fn().mockResolvedValue({title:'曲目',editions:[{parts:[part]}]});
  const state={api:{detail},abort:new AbortController(),disposed:false,player:{play},openTrack};
  const run=()=>Reflect.apply(Reflect.get(MediaScreen.prototype,'playTrack'),state,['track']);
  await run();expect(play).toHaveBeenCalledWith([{part,title:'曲目',video:false}],0);
  detail.mockResolvedValue({editions:[{parts:[part]},{parts:[part]}]});await run();expect(openTrack).toHaveBeenCalledWith('track');
  detail.mockResolvedValue({editions:[{parts:[{available:false}]}]});await run();expect(openTrack).toHaveBeenCalledTimes(2);
  state.disposed=true;await run();expect(play).toHaveBeenCalledTimes(1);expect(openTrack).toHaveBeenCalledTimes(2);
});
