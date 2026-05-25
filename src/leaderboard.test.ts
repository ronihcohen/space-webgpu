import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  fetchTop10,
  LeaderboardError,
  loadSavedLeaderboardName,
  sanitiseName,
  saveLeaderboardName,
  startRun,
  submitRun,
  type SignedSeed,
} from './leaderboard';

const run: SignedSeed = { seed: 'abc', issuedAt: 123, sig: 'sig' };

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function mockFetch(response: Response | Promise<Response>): void {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response));
}

describe('sanitiseName', () => {
  it('strips controls, collapses whitespace, trims, and caps length', () => {
    expect(sanitiseName('\x00 Ada   Lovelace   Extra Long Name ')).toBe('Ada Lovelace Extra L');
  });

  it('rejects empty names', () => {
    expect(sanitiseName('   \n\t')).toBeNull();
  });
});

describe('saved name', () => {
  function makeStorage(): Storage {
    const map = new Map<string, string>();
    return {
      length: 0,
      clear() {
        map.clear();
      },
      getItem(key: string) {
        return map.has(key) ? map.get(key)! : null;
      },
      key(index: number) {
        return Array.from(map.keys())[index] ?? null;
      },
      removeItem(key: string) {
        map.delete(key);
      },
      setItem(key: string, value: string) {
        map.set(key, value);
      },
    } as Storage;
  }

  it('round-trips the last valid name', () => {
    vi.stubGlobal('localStorage', makeStorage());
    saveLeaderboardName('  Ada Lovelace  ');
    expect(loadSavedLeaderboardName()).toBe('Ada Lovelace');
  });

  it('ignores empty names', () => {
    vi.stubGlobal('localStorage', makeStorage());
    saveLeaderboardName('   ');
    expect(loadSavedLeaderboardName()).toBe('');
  });
});

describe('startRun', () => {
  it('returns signed seed data on success', async () => {
    mockFetch(new Response(JSON.stringify(run), { status: 200 }));
    await expect(startRun()).resolves.toEqual(run);
  });

  it('returns null on network failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    await expect(startRun()).resolves.toBeNull();
  });
});

describe('submitRun', () => {
  it('sends input log without a score field', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ rank: 2 }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(submitRun(run, 'AAA', [{ tick: 1, key: 2, down: true }])).resolves.toEqual({ rank: 2 });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.score).toBeUndefined();
    expect(body.inputLog).toEqual([{ tick: 1, key: 2, down: true }]);
  });

  it('throws rejected for 4xx responses', async () => {
    mockFetch(new Response(JSON.stringify({ error: 'bad-seed' }), { status: 400 }));
    await expect(submitRun(run, 'AAA', [])).rejects.toMatchObject({ kind: 'rejected' });
  });

  it('throws offline on network failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    await expect(submitRun(run, 'AAA', [])).rejects.toBeInstanceOf(LeaderboardError);
    await expect(submitRun(run, 'AAA', [])).rejects.toMatchObject({ kind: 'offline' });
  });
});

describe('fetchTop10', () => {
  it('sorts returned rows by score desc and created_at asc', async () => {
    mockFetch(new Response(JSON.stringify({
      rows: [
        { id: 1, name: 'B', score: 20, created_at: '2024-02-01T00:00:00Z' },
        { id: 2, name: 'A', score: 30, created_at: '2024-03-01T00:00:00Z' },
        { id: 3, name: 'C', score: 30, created_at: '2024-01-01T00:00:00Z' },
      ],
    }), { status: 200 }));
    await expect(fetchTop10()).resolves.toEqual([
      { id: 3, name: 'C', score: 30, created_at: '2024-01-01T00:00:00Z' },
      { id: 2, name: 'A', score: 30, created_at: '2024-03-01T00:00:00Z' },
      { id: 1, name: 'B', score: 20, created_at: '2024-02-01T00:00:00Z' },
    ]);
  });
});
