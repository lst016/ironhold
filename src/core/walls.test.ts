import { describe, expect, it } from 'vitest';
import { wallPath, wallPieces } from './walls';

describe('wallPath', () => {
  it('steps one cell at a time along a straight drag', () => {
    expect(wallPath({ x: 2, y: 5 }, { x: 5, y: 5 })).toEqual([
      { x: 3, y: 5, axis: 'x' }, { x: 4, y: 5, axis: 'x' }, { x: 5, y: 5, axis: 'x' },
    ]);
    expect(wallPath({ x: 4, y: 4 }, { x: 4, y: 2 })).toEqual([{ x: 4, y: 3, axis: 'y' }, { x: 4, y: 2, axis: 'y' }]);
  });

  it('keeps every cell touching the previous one on a diagonal drag', () => {
    const path = wallPath({ x: 0, y: 0 }, { x: 2, y: 2 });
    expect(path.at(-1)).toMatchObject({ x: 2, y: 2 });
    let prev = { x: 0, y: 0 };
    for (const c of path) {
      expect(Math.abs(c.x - prev.x) + Math.abs(c.y - prev.y)).toBe(1);
      prev = c;
    }
  });

  it('is empty when the pointer has not left the cell', () => {
    expect(wallPath({ x: 3, y: 3 }, { x: 3, y: 3 })).toEqual([]);
  });
});

const grid = (...cells: [number, number][]) => {
  const s = new Set(cells.map(([x, y]) => `${x},${y}`));
  return (x: number, y: number) => s.has(`${x},${y}`);
};

describe('wallPieces', () => {
  it('a lone wall follows the chosen facing', () => {
    expect(wallPieces(grid([5, 5]), 5, 5)).toEqual([{ axis: 'y', half: 'full' }]);
    expect(wallPieces(grid([5, 5]), 5, 5, 1)).toEqual([{ axis: 'x', half: 'full' }]);
  });

  it('a straight run turns with its neighbours, ignoring the chosen facing', () => {
    const row = grid([4, 5], [5, 5], [6, 5]);
    expect(wallPieces(row, 5, 5)).toEqual([{ axis: 'x', half: 'full' }]);
    expect(wallPieces(row, 4, 5)).toEqual([{ axis: 'x', half: 'full' }]);
    expect(wallPieces(grid([5, 4], [5, 5]), 5, 5, 1)).toEqual([{ axis: 'y', half: 'full' }]);
  });

  it('a corner joins two half-segments', () => {
    // top corner of a ring: neighbours at +x and +y
    expect(wallPieces(grid([6, 6], [7, 6], [6, 7]), 6, 6)).toEqual([{ axis: 'y', half: 'pos' }, { axis: 'x', half: 'pos' }]);
  });

  it('a T junction keeps the through-run whole', () => {
    expect(wallPieces(grid([4, 5], [5, 5], [6, 5], [5, 6]), 5, 5)).toEqual([{ axis: 'y', half: 'pos' }, { axis: 'x', half: 'full' }]);
  });
});
