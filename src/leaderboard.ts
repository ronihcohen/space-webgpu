import type { InputEvent } from './game/replay';

const API = '/api';
const LEADERBOARD_NAME_KEY = 'space-webgpu-leaderboard-name';

export interface SignedSeed {
  seed: string;
  issuedAt: number;
  sig: string;
}

export type { InputEvent };

export interface LeaderboardRow {
  id: number;
  name: string;
  score: number;
  created_at: string;
}

export class LeaderboardError extends Error {
  kind: 'offline' | 'rejected' | 'server';

  constructor(
    kind: 'offline' | 'rejected' | 'server',
    message: string,
  ) {
    super(message);
    this.name = 'LeaderboardError';
    this.kind = kind;
  }
}

async function parseJson<T>(response: Response): Promise<T> {
  return await response.json() as T;
}

export async function startRun(): Promise<SignedSeed | null> {
  try {
    const response = await fetch(`${API}/start`);
    if (!response.ok) return null;
    const data = await parseJson<SignedSeed>(response);
    if (
      typeof data.seed !== 'string' ||
      typeof data.issuedAt !== 'number' ||
      typeof data.sig !== 'string'
    ) {
      return null;
    }
    return data;
  } catch {
    return null;
  }
}

export async function submitRun(
  run: SignedSeed,
  name: string,
  inputLog: InputEvent[],
): Promise<{ rank: number }> {
  const cleaned = sanitiseName(name);
  if (cleaned === null) {
    throw new LeaderboardError('rejected', 'bad-name');
  }

  let response: Response;
  try {
    response = await fetch(`${API}/submit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...run, name: cleaned, inputLog }),
    });
  } catch {
    throw new LeaderboardError('offline', 'Network unavailable.');
  }

  let data: { rank?: number; error?: string; status?: string } = {};
  try {
    data = await parseJson(response);
  } catch {
    // Keep the status-based handling below.
  }

  if (response.ok) {
    return { rank: typeof data.rank === 'number' ? data.rank : 0 };
  }

  if (response.status >= 400 && response.status < 500) {
    throw new LeaderboardError('rejected', data.error ?? 'Run could not be verified.');
  }

  throw new LeaderboardError('server', data.error ?? 'Leaderboard server failed.');
}

export async function fetchTop10(): Promise<LeaderboardRow[]> {
  let response: Response;
  try {
    response = await fetch(`${API}/top`);
  } catch {
    throw new LeaderboardError('offline', 'Network unavailable.');
  }
  if (!response.ok) {
    throw new LeaderboardError('server', 'Could not load leaderboard.');
  }
  const data = await parseJson<{ rows: LeaderboardRow[] } | LeaderboardRow[]>(response);
  const rows = Array.isArray(data) ? data : data.rows;
  return [...rows].sort((a, b) => b.score - a.score || a.created_at.localeCompare(b.created_at));
}

export function sanitiseName(raw: string): string | null {
  const cleaned = raw
    .replace(/[\x00-\x1f\x7f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 20);
  return cleaned.length >= 1 ? cleaned : null;
}

export function loadSavedLeaderboardName(): string {
  try {
    const storage = globalThis.localStorage;
    return storage?.getItem(LEADERBOARD_NAME_KEY) ?? '';
  } catch {
    return '';
  }
}

export function saveLeaderboardName(raw: string): void {
  const cleaned = sanitiseName(raw);
  if (cleaned === null) return;
  try {
    globalThis.localStorage?.setItem(LEADERBOARD_NAME_KEY, cleaned);
  } catch {
    // Ignore storage failures; the overlay still works normally.
  }
}
