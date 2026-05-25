/**
 * spawner.test.ts — Unit tests for spawner.ts.
 *
 * Tests: grid spawn, framesPerStep table boundaries, startFrames,
 * wave start-row drop, fire eligibility, max-enemy-bullets cap.
 */

import { describe, it, expect } from 'vitest';
import {
  spawnInvaderGrid,
  makeInvaderGrid,
  framesPerStep,
  startFrames,
  waveStartYOffset,
  bottomInvadersPerColumn,
  aliveCount,
  GRID_COLS,
  GRID_ROWS,
} from './spawner';
import {
  INVADER_GRID_START_X,
  INVADER_GRID_START_Y,
  MAX_ENEMY_BULLETS,
} from './entities';

// ─── Grid spawn ────────────────────────────────────────────────────────────────

describe('spawnInvaderGrid', () => {
  it('spawns exactly GRID_ROWS * GRID_COLS invaders', () => {
    const invaders = spawnInvaderGrid();
    expect(invaders.length).toBe(GRID_ROWS * GRID_COLS);
  });

  it('all invaders are alive on spawn', () => {
    const invaders = spawnInvaderGrid();
    expect(invaders.every((inv) => inv.alive)).toBe(true);
  });

  it('col values span 0..GRID_COLS-1', () => {
    const invaders = spawnInvaderGrid();
    const cols = new Set(invaders.map((inv) => inv.col));
    for (let c = 0; c < GRID_COLS; c++) {
      expect(cols.has(c)).toBe(true);
    }
  });

  it('row values span 0..GRID_ROWS-1', () => {
    const invaders = spawnInvaderGrid();
    const rows = new Set(invaders.map((inv) => inv.row));
    for (let r = 0; r < GRID_ROWS; r++) {
      expect(rows.has(r)).toBe(true);
    }
  });

  it('row 0 = type C, rows 1-2 = type B, rows 3-4 = type A', () => {
    const invaders = spawnInvaderGrid();
    for (const inv of invaders) {
      if (inv.row === 0) expect(inv.type).toBe('C');
      else if (inv.row <= 2) expect(inv.type).toBe('B');
      else expect(inv.type).toBe('A');
    }
  });

  it('all animation frames start at 0', () => {
    const invaders = spawnInvaderGrid();
    expect(invaders.every((inv) => inv.frame === 0)).toBe(true);
  });
});

describe('makeInvaderGrid', () => {
  it('grid starts at INVADER_GRID_START_X', () => {
    const grid = makeInvaderGrid(1);
    expect(grid.gridX).toBe(INVADER_GRID_START_X);
  });

  it('grid Y for wave 1 is INVADER_GRID_START_Y', () => {
    const grid = makeInvaderGrid(1);
    expect(grid.gridY).toBe(INVADER_GRID_START_Y);
  });

  it('grid direction starts at +1 (rightward)', () => {
    const grid = makeInvaderGrid(1);
    expect(grid.dir).toBe(1);
  });

  it('step accumulator starts at 0', () => {
    const grid = makeInvaderGrid(1);
    expect(grid.stepAccum).toBe(0);
  });

  it('animFrame starts at 0', () => {
    const grid = makeInvaderGrid(1);
    expect(grid.animFrame).toBe(0);
  });
});

// ─── Speed table — framesPerStep ──────────────────────────────────────────────

describe('framesPerStep', () => {
  // Table from CLAUDE.md: [minAlive, framesPerStep]
  const TABLE: Array<[number, number]> = [
    [55, 48],
    [54, 43], [43, 43],  // 54-43 → 43
    [42, 37], [31, 37],  // 42-31 → 37
    [30, 30], [22, 30],  // 30-22 → 30
    [21, 22], [16, 22],  // 21-16 → 22
    [15, 16], [11, 16],  // 15-11 → 16
    [10, 11], [ 8, 11],  // 10-8  → 11
    [ 7,  8], [ 5,  8],  // 7-5   → 8
    [ 4,  5],            // 4     → 5
    [ 3,  3],            // 3     → 3
    [ 2,  2],            // 2     → 2
    [ 1,  1],            // 1     → 1
  ];

  for (const [alive, expected] of TABLE) {
    it(`framesPerStep(${alive}) = ${expected}`, () => {
      expect(framesPerStep(alive)).toBe(expected);
    });
  }

  it('framesPerStep at every boundary of the table matches spec', () => {
    // Spot-check the exact values at boundary transitions
    expect(framesPerStep(55)).toBe(48);
    expect(framesPerStep(43)).toBe(43); // boundary: 43 alive = 43 fps
    expect(framesPerStep(42)).toBe(37); // just below → next tier
    expect(framesPerStep(31)).toBe(37);
    expect(framesPerStep(30)).toBe(30);
    expect(framesPerStep(22)).toBe(30);
    expect(framesPerStep(21)).toBe(22);
    expect(framesPerStep(16)).toBe(22);
    expect(framesPerStep(15)).toBe(16);
    expect(framesPerStep(11)).toBe(16);
    expect(framesPerStep(10)).toBe(11);
    expect(framesPerStep(8)).toBe(11);
    expect(framesPerStep(7)).toBe(8);
    expect(framesPerStep(5)).toBe(8);
    expect(framesPerStep(4)).toBe(5);
    expect(framesPerStep(3)).toBe(3);
    expect(framesPerStep(2)).toBe(2);
    expect(framesPerStep(1)).toBe(1);
  });
});

// ─── startFrames ──────────────────────────────────────────────────────────────

describe('startFrames', () => {
  it('wave 1 = 48 (max(48 - 5*0, 16) = 48)', () => {
    expect(startFrames(1)).toBe(48);
  });

  it('wave 2 = 43 (max(48 - 5*1, 16) = 43)', () => {
    expect(startFrames(2)).toBe(43);
  });

  it('wave 3 = 38 (max(48 - 5*2, 16) = 38)', () => {
    expect(startFrames(3)).toBe(38);
  });

  it('wave 4 = 33 (max(48 - 5*3, 16) = 33)', () => {
    expect(startFrames(4)).toBe(33);
  });

  it('wave 5 = 28 (max(48 - 5*4, 16) = 28)', () => {
    expect(startFrames(5)).toBe(28);
  });

  it('wave 6 = 23 (max(48 - 5*5, 16) = 23)', () => {
    expect(startFrames(6)).toBe(23);
  });

  it('wave 7 = 18 (max(48 - 5*6, 16) = 18)', () => {
    expect(startFrames(7)).toBe(18);
  });

  it('floors at 16 — never goes below', () => {
    // wave 8: 48 - 5*7 = 13 → clamped to 16
    expect(startFrames(8)).toBe(16);
    expect(startFrames(9)).toBe(16);
    expect(startFrames(100)).toBe(16);
  });

  it('matches formula max(48 - 5*(N-1), 16) for N=1..6', () => {
    for (let n = 1; n <= 6; n++) {
      expect(startFrames(n)).toBe(Math.max(48 - 5 * (n - 1), 16));
    }
  });
});

// ─── Wave start-row drop ───────────────────────────────────────────────────────

describe('waveStartYOffset', () => {
  it('wave 1 has no offset (no drop on first wave)', () => {
    expect(waveStartYOffset(1)).toBe(0);
  });

  it('wave 2 drops 8px', () => {
    expect(waveStartYOffset(2)).toBe(8);
  });

  it('wave 3 drops 16px', () => {
    expect(waveStartYOffset(3)).toBe(16);
  });

  it('wave 4 drops 24px (max 3 drops × 8px)', () => {
    expect(waveStartYOffset(4)).toBe(24);
  });

  it('wave 5 also drops 24px (cap applies — waves 4+ are the same)', () => {
    expect(waveStartYOffset(5)).toBe(24);
  });

  it('wave 6 also drops 24px', () => {
    expect(waveStartYOffset(6)).toBe(24);
  });

  it('grid start Y never exceeds INVADER_GRID_START_Y + 24 for any wave', () => {
    for (let n = 1; n <= 10; n++) {
      const grid = makeInvaderGrid(n);
      expect(grid.gridY).toBe(INVADER_GRID_START_Y + waveStartYOffset(n));
      expect(grid.gridY).toBeLessThanOrEqual(INVADER_GRID_START_Y + 24);
    }
  });
});

// ─── Bottom-of-column fire eligibility ────────────────────────────────────────

describe('bottomInvadersPerColumn', () => {
  it('returns one entry per column in a full grid', () => {
    const grid = makeInvaderGrid(1);
    const bottomMap = bottomInvadersPerColumn(grid);
    expect(bottomMap.size).toBe(GRID_COLS);
  });

  it('initially the bottom row (4) is the bottom of every column', () => {
    const grid = makeInvaderGrid(1);
    const bottomMap = bottomInvadersPerColumn(grid);
    for (const [, row] of bottomMap) {
      expect(row).toBe(GRID_ROWS - 1); // row 4
    }
  });

  it('when bottom invader of a column dies, the one above becomes eligible', () => {
    const grid = makeInvaderGrid(1);
    // Kill the bottom invader of column 5 (row 4)
    const col = 5;
    const deadIdx = (GRID_ROWS - 1) * GRID_COLS + col; // row=4, col=5
    grid.invaders[deadIdx].alive = false;

    const bottomMap = bottomInvadersPerColumn(grid);
    // Column 5 should now point to row 3 (the one above)
    expect(bottomMap.get(col)).toBe(GRID_ROWS - 2);
  });

  it('column with all invaders dead is not in the map', () => {
    const grid = makeInvaderGrid(1);
    const col = 0;
    // Kill all invaders in column 0
    for (const inv of grid.invaders) {
      if (inv.col === col) inv.alive = false;
    }
    const bottomMap = bottomInvadersPerColumn(grid);
    expect(bottomMap.has(col)).toBe(false);
  });

  it('aliveCount returns 55 for a fresh grid', () => {
    const grid = makeInvaderGrid(1);
    expect(aliveCount(grid)).toBe(GRID_ROWS * GRID_COLS);
  });

  it('aliveCount decrements correctly as invaders die', () => {
    const grid = makeInvaderGrid(1);
    grid.invaders[0].alive = false;
    expect(aliveCount(grid)).toBe(GRID_ROWS * GRID_COLS - 1);
    grid.invaders[1].alive = false;
    expect(aliveCount(grid)).toBe(GRID_ROWS * GRID_COLS - 2);
  });
});

// ─── Max-3-enemy-bullets cap (documented behavior, verified in simulation) ────

describe('MAX_ENEMY_BULLETS', () => {
  it('MAX_ENEMY_BULLETS constant is 3', () => {
    // This test documents the authoritative value so regressions are caught
    expect(MAX_ENEMY_BULLETS).toBe(3);
  });
});
