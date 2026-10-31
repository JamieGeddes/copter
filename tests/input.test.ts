import { describe, expect, it } from 'vitest';
import { axesFromKeys } from '../src/input/bindings';

const keys = (...codes: string[]) => new Set(codes);

describe('axesFromKeys', () => {
  it('treats cursor keys and WASD identically', () => {
    const pairs: [string, string][] = [
      ['KeyW', 'ArrowUp'],
      ['KeyS', 'ArrowDown'],
      ['KeyA', 'ArrowLeft'],
      ['KeyD', 'ArrowRight'],
    ];
    for (const [wasd, arrow] of pairs) {
      expect(axesFromKeys(keys(wasd))).toEqual(axesFromKeys(keys(arrow)));
    }
  });

  it('maps directions to screen axes', () => {
    expect(axesFromKeys(keys('ArrowUp'))).toMatchObject({ x: 0, y: 1 });
    expect(axesFromKeys(keys('ArrowRight'))).toMatchObject({ x: 1, y: 0 });
  });

  it('normalises diagonals', () => {
    const a = axesFromKeys(keys('ArrowUp', 'KeyD'));
    expect(Math.hypot(a.x, a.y)).toBeCloseTo(1);
  });

  it('cancels opposing keys', () => {
    expect(axesFromKeys(keys('ArrowLeft', 'KeyD'))).toMatchObject({ x: 0, y: 0 });
  });

  it('reads the collective', () => {
    expect(axesFromKeys(keys('Space')).climb).toBe(1);
    expect(axesFromKeys(keys('ShiftLeft')).climb).toBe(-1);
    expect(axesFromKeys(keys('Space', 'ShiftLeft')).climb).toBe(0);
  });
});
