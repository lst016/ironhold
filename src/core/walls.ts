/**
 * Walls join their neighbours, so a wall's facing comes from the layout, not from the player.
 * The wall art runs along the grid's y axis (lower-left to upper-right on screen); the x axis uses its mirror.
 * A straight run or a lone end shows one full segment. A corner or T junction shows one half-segment
 * per neighbour so the pieces meet in the cell instead of crossing.
 */
export type Axis = 'x' | 'y';
/** `neg`/`pos` is the half that reaches toward the -1 / +1 neighbour on that axis. */
export interface WallPiece { axis: Axis; half: 'full' | 'neg' | 'pos' }

/**
 * Cells a drag passes through from `a` to `b` (excluding `a`, including `b`), one orthogonal step at a time so
 * every new wall touches the previous one. Each step moves along the axis with more distance left (x on a tie).
 */
export function wallPath(a: { x: number; y: number }, b: { x: number; y: number }): { x: number; y: number; axis: Axis }[] {
  const out: { x: number; y: number; axis: Axis }[] = [];
  let { x, y } = a;
  while (x !== b.x || y !== b.y) {
    const dx = b.x - x, dy = b.y - y;
    if (Math.abs(dx) >= Math.abs(dy)) { x += Math.sign(dx); out.push({ x, y, axis: 'x' }); }
    else { y += Math.sign(dy); out.push({ x, y, axis: 'y' }); }
  }
  return out;
}

export function wallPieces(has: (x: number, y: number) => boolean, x: number, y: number, dir: 0 | 1 = 0): WallPiece[] {
  const xn = has(x - 1, y), xp = has(x + 1, y), yn = has(x, y - 1), yp = has(x, y + 1);
  const onX = xn || xp, onY = yn || yp;
  // a lone wall keeps the facing the player chose
  if (!onX && !onY) return [{ axis: dir ? 'x' : 'y', half: 'full' }];
  if (onX !== onY) return [{ axis: onX ? 'x' : 'y', half: 'full' }];
  const side = (n: boolean, p: boolean, axis: Axis): WallPiece[] =>
    n && p ? [{ axis, half: 'full' }] : [{ axis, half: n ? 'neg' : 'pos' }];
  return [...side(yn, yp, 'y'), ...side(xn, xp, 'x')];
}
