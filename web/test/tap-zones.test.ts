import { describe, expect, it } from 'vitest';
import { isLastMenuCell, normalizeTapZones, tapActionAt, tapZonePreset } from '../src/ui/tap-zones.ts';

describe('点击区域', () => {
  it('turns the old two-way switch into the grid it meant', () => {
    expect(normalizeTapZones(undefined)).toEqual(tapZonePreset('standard'));
    expect(normalizeTapZones(undefined, 'reversed').slice(0, 3)).toEqual(['next', 'menu', 'previous']);
  });

  it('rejects a malformed grid and keeps at least one 菜单', () => {
    expect(normalizeTapZones(['next'])).toEqual(tapZonePreset('standard'));
    expect(normalizeTapZones(Array(9).fill('bogus'))).toEqual(tapZonePreset('standard'));
    const noMenu = normalizeTapZones(Array(9).fill('next'));
    expect(noMenu[4]).toBe('menu');
    expect(noMenu.filter(action => action === 'menu')).toHaveLength(1);
  });

  it('reads a cell row-major and mirrors it for a right-to-left book', () => {
    const grid = normalizeTapZones(['previous', 'previous', 'next', 'previous', 'menu', 'next', 'previous', 'next', 'next']);
    expect(tapActionAt(grid, 1, 0, false)).toBe('previous');
    expect(tapActionAt(grid, 1, 2, false)).toBe('next');
    expect(tapActionAt(grid, 0, 1, true)).toBe('next');
    expect(tapActionAt(grid, 2, 1, true)).toBe('previous');
  });

  it('knows which 菜单 cell is the last one', () => {
    const grid = tapZonePreset('standard');
    expect(isLastMenuCell(grid, 4)).toBe(false);
    const single = normalizeTapZones(['previous', 'menu', 'next', 'previous', 'next', 'next', 'previous', 'next', 'next']);
    expect(isLastMenuCell(single, 1)).toBe(true);
    expect(isLastMenuCell(single, 0)).toBe(false);
  });
});
