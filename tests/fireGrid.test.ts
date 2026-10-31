import { describe, expect, it } from 'vitest';
import { Cell, FireGrid } from '../src/world/FireGrid';

const N = 61;
const CELL = 4;
const MID = Math.floor(N / 2);

/** Flat (or sloped) woodland grid centred on the origin. */
const makeGrid = (opts: { slopeX?: number; fuel?: (cx: number, cz: number) => number } = {}): FireGrid => {
  const heights = new Float32Array(N * N);
  const fuel = new Float32Array(N * N);
  for (let cz = 0; cz < N; cz++) {
    for (let cx = 0; cx < N; cx++) {
      heights[cz * N + cx] = (opts.slopeX ?? 0) * cx * CELL;
      fuel[cz * N + cx] = opts.fuel ? opts.fuel(cx, cz) : 1;
    }
  }
  return new FireGrid({ size: N, cellSize: CELL, originX: -MID * CELL, originZ: -MID * CELL, heights, fuel });
};

const run = (g: FireGrid, seconds: number, wx = 0, wz = 0, dt = 0.1): void => {
  for (let t = 0; t < seconds; t += dt) g.step(dt, wx, wz);
};

/** Furthest distance of a burning or burnt cell from the origin along a direction. */
const reach = (g: FireGrid, dx: number, dz: number): number => {
  let best = 0;
  for (let i = 0; i < g.state.length; i++) {
    if (g.state[i] === Cell.Unburnt) continue;
    best = Math.max(best, g.centreX(i) * dx + g.centreZ(i) * dz);
  }
  return best;
};

describe('FireGrid', () => {
  it('starts unburnt and ignites only flammable cells', () => {
    const g = makeGrid({ fuel: (cx) => (cx === MID ? 0 : 1) });
    expect(g.burningCount).toBe(0);
    expect(g.ignite(0, 0)).toBe(0);
    expect(g.ignite(CELL, 0)).toBe(1);
    expect(g.burningCount).toBe(1);
    expect(g.burningArea).toBe(CELL * CELL);
  });

  it('spreads outward from an ignition point', () => {
    const g = makeGrid();
    g.ignite(0, 0, 5);
    const start = g.burningCount;
    run(g, 40);
    expect(g.burningCount).toBeGreaterThan(start);
    expect(reach(g, 1, 0)).toBeGreaterThan(CELL * 3);
  });

  it('spreads faster downwind than upwind', () => {
    const g = makeGrid();
    g.ignite(0, 0);
    run(g, 40, 8, 0);
    expect(reach(g, 1, 0)).toBeGreaterThan(reach(g, -1, 0) * 1.4);
  });

  it('spreads faster uphill than downhill', () => {
    const g = makeGrid({ slopeX: 0.4 });
    g.ignite(MID * 0, 0);
    run(g, 30);
    expect(reach(g, 1, 0)).toBeGreaterThan(reach(g, -1, 0) * 1.5);
  });

  it('burns cells out and never re-ignites them', () => {
    const g = makeGrid({ fuel: (cx, cz) => (Math.hypot(cx - MID, cz - MID) < 4 ? 1 : 0) });
    g.ignite(0, 0);
    run(g, 120);
    expect(g.burningCount).toBe(0);
    const burnt = g.burntOut;
    expect(burnt).toBeGreaterThan(10);
    g.ignite(0, 0, 30);
    expect(g.burningCount).toBe(0);
    run(g, 20);
    expect(g.burntOut).toBe(burnt);
  });

  it('is stopped by a firebreak', () => {
    const g = makeGrid({ fuel: (cx) => (cx === MID + 3 || cx === MID + 4 ? 0 : 1) });
    g.ignite(-20, 0, 8);
    run(g, 200, 6, 0);
    const breakX = (MID + 3 - MID) * CELL;
    expect(reach(g, 1, 0)).toBeLessThan(breakX);
    for (let i = 0; i < g.state.length; i++) {
      if (g.centreX(i) > breakX) expect(g.state[i]).toBe(Cell.Unburnt);
    }
  });

  it('is not stopped by a gap with no break', () => {
    const g = makeGrid();
    g.ignite(-20, 0, 8);
    run(g, 200, 6, 0);
    expect(reach(g, 1, 0)).toBeGreaterThan(8 * CELL);
  });

  it('extinguishes burning cells with a strong drop', () => {
    const g = makeGrid();
    g.ignite(0, 0, 8);
    run(g, 5);
    expect(g.burningCount).toBeGreaterThan(5);
    g.douse(0, 0, 30, 1);
    expect(g.burningCount).toBe(0);
    expect(g.isClear(0, 0, 30)).toBe(true);
  });

  it('knocks back a weak drop without putting the fire out', () => {
    const g = makeGrid();
    g.ignite(0, 0);
    const i = g.cellAt(0, 0);
    g.douse(0, 0, 6, 0.2);
    expect(g.heat[i]).toBeLessThan(1);
    expect(g.isBurning(i)).toBe(true);
  });

  it('keeps wet cells from igniting until they dry', () => {
    const g = makeGrid();
    g.douse(20, 0, 10, 1, 30);
    g.ignite(-20, 0, 6);
    run(g, 20, 6, 0);
    const wetCell = g.cellAt(20, 0);
    expect(g.state[wetCell]).toBe(Cell.Unburnt);
    expect(g.wet[wetCell]).toBeGreaterThan(0);
    // Once dry, the fire can carry on through.
    run(g, 300, 6, 0);
    expect(g.state[wetCell]).not.toBe(Cell.Unburnt);
  });

  it('reports how much water landed on fire, and how hot and near the fire is', () => {
    const g = makeGrid();
    expect(g.nearestBurning(0, 0)).toBe(Infinity);
    g.ignite(0, 0, 8);
    expect(g.heatNear(0, 0, 30)).toBeGreaterThan(g.heatNear(25, 0, 30));
    expect(g.heatNear(200, 0, 30)).toBe(0);
    expect(g.nearestBurning(40, 0)).toBeGreaterThan(20);
    expect(g.douse(0, 0, 4, 0.1)).toBeGreaterThan(0);
    expect(g.douse(100, 100, 4, 0.1)).toBe(0);
  });

  it('reports changed cells once', () => {
    const g = makeGrid();
    g.ignite(0, 0);
    expect(g.drainChanges()).toEqual([g.cellAt(0, 0)]);
    expect(g.drainChanges()).toEqual([]);
  });

  it('is deterministic', () => {
    const a = makeGrid();
    const b = makeGrid();
    for (const g of [a, b]) {
      g.ignite(0, 0, 4);
      run(g, 60, 4, 2);
    }
    expect(Array.from(a.state)).toEqual(Array.from(b.state));
    expect(a.burningCount).toBe(b.burningCount);
  });

  it('ignores positions outside the grid', () => {
    const g = makeGrid();
    expect(g.cellAt(1e5, 0)).toBe(-1);
    expect(g.ignite(1e5, 0)).toBe(0);
    expect(() => g.douse(1e5, 0, 10, 1)).not.toThrow();
  });
});
