export interface CorsResponse {
  setHeader(name: string, value: string): void;
}

// Allow cross-origin reads/writes so the itch.io build (served from
// html-classic.itch.zone) can hit the global leaderboard on this domain.
// The anti-cheat model relies on the signed-seed HMAC, not on origin, so a
// permissive origin doesn't weaken it.
export function setCorsHeaders(res: CorsResponse): void {
  res.setHeader('Access-Control-Allow-Origin', '*');
}

export function setCorsPreflightHeaders(res: CorsResponse): void {
  setCorsHeaders(res);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}
