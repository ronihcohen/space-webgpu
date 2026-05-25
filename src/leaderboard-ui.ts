import {
  fetchTop10,
  submitRun,
  sanitiseName,
  LeaderboardError,
  loadSavedLeaderboardName,
  saveLeaderboardName,
  type LeaderboardRow,
  type SignedSeed,
} from './leaderboard';
import { setInputEnabled, type InputState } from './game/input';

interface ShowOptions {
  score: number;
  run: SignedSeed | null;
  input: InputState;
  onPlayAgain(): void;
}

const overlay = document.getElementById('leaderboard-overlay') as HTMLDivElement | null;

function formatScore(score: number): string {
  return score.toLocaleString('en-US');
}

function rowHtml(row: LeaderboardRow, index: number): string {
  return `<li><span>${index + 1}.</span><strong>${escapeHtml(row.name)}</strong><em>${formatScore(row.score)}</em></li>`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

async function loadRows(list: HTMLOListElement, status: HTMLParagraphElement): Promise<void> {
  status.textContent = 'Loading scores...';
  try {
    const rows = await fetchTop10();
    list.innerHTML = rows.length === 0
      ? '<li class="leaderboard-empty">No scores yet</li>'
      : rows.map(rowHtml).join('');
    status.textContent = '';
  } catch {
    list.innerHTML = '<li class="leaderboard-empty">Scores unavailable</li>';
    status.textContent = "Couldn't load scores.";
  }
}

export function showLeaderboardOverlay(options: ShowOptions): void {
  if (!overlay) return;

  let closed = false;
  setInputEnabled(options.input, false);
  overlay.innerHTML = `
    <div class="leaderboard-panel" role="dialog" aria-modal="true" aria-labelledby="leaderboard-title">
      <h1 id="leaderboard-title">GLOBAL HIGH SCORES</h1>
      <ol id="leaderboard-list" class="leaderboard-list"></ol>
      <p id="leaderboard-status" class="leaderboard-status"></p>
      <div class="leaderboard-submit">
        <p>Your score: <strong>${formatScore(options.score)}</strong></p>
        ${options.run ? `
          <form id="leaderboard-form">
            <label for="leaderboard-name">Name</label>
            <input id="leaderboard-name" name="name" maxlength="20" autocomplete="off" />
            <button type="submit">Submit</button>
          </form>
        ` : '<p class="leaderboard-note">Scores are not being recorded for this offline run.</p>'}
      </div>
      <button id="leaderboard-again" type="button">Play again</button>
    </div>
  `;
  overlay.classList.add('visible');

  const list = overlay.querySelector('#leaderboard-list') as HTMLOListElement;
  const status = overlay.querySelector('#leaderboard-status') as HTMLParagraphElement;
  const again = overlay.querySelector('#leaderboard-again') as HTMLButtonElement;
  const form = overlay.querySelector('#leaderboard-form') as HTMLFormElement | null;
  const input = overlay.querySelector('#leaderboard-name') as HTMLInputElement | null;

  const close = (): void => {
    if (closed) return;
    closed = true;
    overlay.classList.remove('visible');
    overlay.innerHTML = '';
    window.removeEventListener('keydown', onKeyDown);
    setInputEnabled(options.input, true);
    options.onPlayAgain();
  };

  function onKeyDown(event: KeyboardEvent): void {
    if (event.code === 'Space') {
      event.preventDefault();
      close();
    }
  }

  window.addEventListener('keydown', onKeyDown);
  again.addEventListener('click', close);
  input?.addEventListener('keydown', (event) => { event.stopPropagation(); });
  if (input) {
    input.value = loadSavedLeaderboardName();
    input.addEventListener('input', () => {
      saveLeaderboardName(input.value);
    });
  }
  input?.focus();

  const run = options.run;
  if (form && input && run) {
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const name = sanitiseName(input.value);
      if (name === null) {
        status.textContent = 'Enter a name.';
        return;
      }
      saveLeaderboardName(name);
      const button = form.querySelector('button') as HTMLButtonElement;
      button.disabled = true;
      status.textContent = 'Verifying...';
      try {
        const result = await submitRun(run, name, options.score);
        const rankMsg = result.rank > 0 ? `Submitted! You ranked #${result.rank}.` : 'Submitted!';
        form.remove();
        await loadRows(list, status);
        status.textContent = rankMsg;
      } catch (err) {
        console.error('[leaderboard] submit error:', err);
        const kind = err instanceof LeaderboardError ? err.kind : 'server';
        if (kind === 'offline') {
          status.textContent = "You're offline. Score not submitted.";
        } else if (kind === 'server') {
          status.textContent = 'Server error — tap Submit to retry.';
        } else {
          status.textContent = 'Run could not be verified.';
        }
        // Only permanently disable for rejected (bad token, expired seed).
        // Offline and server errors are transient — keep the button live so
        // the player can retry without losing their score.
        button.disabled = kind === 'rejected';
      }
    });
  }

  void loadRows(list, status);
}
