import { fetchTop10, type LeaderboardRow } from './leaderboard';

const list = document.getElementById('list') as HTMLOListElement;
const status = document.getElementById('status') as HTMLParagraphElement;

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function rowHtml(row: LeaderboardRow, index: number): string {
  return `<li><span>${index + 1}.</span><strong>${escapeHtml(row.name)}</strong><em>${row.score.toLocaleString('en-US')}</em></li>`;
}

fetchTop10().then((rows) => {
  list.innerHTML = rows.length === 0
    ? '<li class="empty">No scores yet</li>'
    : rows.map(rowHtml).join('');
  status.textContent = '';
}).catch(() => {
  list.innerHTML = '<li class="empty">Scores unavailable</li>';
  status.textContent = "Couldn't load scores.";
});
