const CACHE_TIME = 60 * 60 * 1000;

function readCache(key) {
  try {
    return JSON.parse(localStorage.getItem(key) || 'null');
  } catch {
    return null;
  }
}

function writeCache(key, count) {
  try {
    localStorage.setItem(key, JSON.stringify({ count, time: Date.now() }));
  } catch {}
}

export async function showGithubStars(repo, { badge, counter }) {
  const key = `stars:${repo}`;
  const show = (count) => {
    counter.textContent = Number(count).toLocaleString('es');
    badge.hidden = false;
  };

  const cached = readCache(key);
  if (cached) show(cached.count);
  if (cached && Date.now() - cached.time < CACHE_TIME) return;

  try {
    const response = await fetch(`https://api.github.com/repos/${repo}`);
    if (!response.ok) return;
    const { stargazers_count: count } = await response.json();
    if (typeof count !== 'number') return;
    show(count);
    writeCache(key, count);
  } catch {}
}
