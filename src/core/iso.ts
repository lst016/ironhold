import { GRID } from './sim';

export const TW = 40; // tile width on screen
export const TH = 20; // tile height on screen
export const W = GRID * TW;
export const OY = 70; // screen y of the grid's top corner

/** Grid coords (continuous, cell units) to screen; `lift` raises the point above the ground. */
export const toScreen = (gx: number, gy: number, lift = 0) => ({
  x: W / 2 + (gx - gy) * (TW / 2),
  y: OY + (gx + gy) * (TH / 2) - lift,
});

/** Screen to ground-plane grid coords. */
export function toGrid(sx: number, sy: number) {
  const dx = (sx - W / 2) / (TW / 2);
  const dy = (sy - OY) / (TH / 2);
  return { x: (dx + dy) / 2, y: (dy - dx) / 2 };
}
