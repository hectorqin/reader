import {expect,it} from 'vitest';
import {historyDay,historyPosition} from '../src/media/history-labels.ts';

it('groups by local calendar date across year and month boundaries',()=>{
  const now=new Date(2026,0,1,0,5);
  expect(historyDay(new Date(2026,0,1,0,1).getTime(),now)).toBe('今天');
  expect(historyDay(new Date(2025,11,31,23,58).getTime(),now)).toBe('昨天');
  expect(historyDay(new Date(2025,11,30,12).getTime(),now)).toBe('2025年12月30日');
  expect(historyDay(undefined,now)).toBe('更早');expect(historyDay(NaN,now)).toBe('更早');
});
it('shows chapter-relative progress including hours, without negative or invalid times',()=>{
  expect(historyPosition(151.9,13)).toBe('02:18');
  expect(historyPosition(4101,400)).toBe('1:01:41');
  expect(historyPosition(5,20)).toBe('00:00');expect(historyPosition(NaN,0)).toBe('00:00');
});
