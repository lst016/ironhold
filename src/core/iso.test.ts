import { describe, expect, it } from 'vitest';
import { toGrid, toScreen } from './iso';

describe('isometric projection', () => {
  it('round-trips grid -> screen -> grid', () => {
    for (const [x, y] of [[0, 0], [19.5, 0.5], [10, 10], [3.25, 17.75]]) {
      const s = toScreen(x, y);
      const g = toGrid(s.x, s.y);
      expect(g.x).toBeCloseTo(x, 9);
      expect(g.y).toBeCloseTo(y, 9);
    }
  });
  it('nearer cells (larger x+y) are lower on screen', () => {
    expect(toScreen(10, 10).y).toBeGreaterThan(toScreen(5, 5).y);
    expect(toScreen(10, 0).x).toBeGreaterThan(toScreen(0, 10).x);
  });
});
