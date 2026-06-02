// Web search provider. Primary engine: Serper.dev (real Google results, cheap). The "mock" engine
// returns nothing (offline) — tests inject a search function directly instead.
export async function search(query, { engine = 'mock', apiKey = '', num = 10 } = {}) {
  if (engine === 'mock') return [];
  if (engine === 'serper') {
    if (!apiKey) throw new Error('SERPER_API_KEY not set (set it in app/.env or use a different engine)');
    const res = await fetch('https://google.serper.dev/search', {
      method: 'POST',
      headers: { 'X-API-KEY': apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ q: query, num, gl: 'us' }),
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) throw new Error(`Serper ${res.status}: ${await res.text()}`);
    const j = await res.json();
    return (j.organic || []).map((o) => ({ url: o.link, title: o.title || '', snippet: o.snippet || '', position: o.position }));
  }
  throw new Error(`unknown search engine: ${engine}`);
}

// Build a single-arg search function bound to config (what discovery/socials consume).
export function makeSearchFn({ engine, apiKey }) {
  if (engine === 'mock' || !apiKey) return null; // no real search available
  return (query) => search(query, { engine, apiKey });
}
