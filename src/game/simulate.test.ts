import { describe, expect, it } from 'vitest';
import { seedFrom } from './rng';
import { simulate } from './simulate';
import type { InputEvent } from './replay';

describe('simulate', () => {
  it('is stable for the same seed and input log', () => {
    const inputLog: InputEvent[] = [
      { tick: 0, key: 2, down: true },
      { tick: 30, key: 0, down: true },
      { tick: 90, key: 0, down: false },
      { tick: 120, key: 1, down: true },
      { tick: 180, key: 1, down: false },
    ];
    const a = simulate(seedFrom('stable'), inputLog, 600);
    const b = simulate(seedFrom('stable'), inputLog, 600);
    expect(a).toEqual(b);
  });

  it('reports in-progress for truncated logs', () => {
    expect(simulate(seedFrom('short'), [], 10).ended).toBe('in-progress');
  });
});
