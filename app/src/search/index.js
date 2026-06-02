// Web search provider. Two real engines, both return real Google results:
//   - "serper"  → Serper.dev    POST https://google.serper.dev/search
//   - "serpapi" → SerpApi       GET  https://serpapi.com/search
// Confusingly-similar names; different products, different keys. The "mock" engine returns
// nothing (offline) — tests inject a search function directly instead.
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
  if (engine === 'serpapi') {
    if (!apiKey) throw new Error('SERPAPI_KEY not set (set it in app/.env or use a different engine)');
    const u = new URL('https://serpapi.com/search');
    u.searchParams.set('engine', 'google');
    u.searchParams.set('q', query);
    u.searchParams.set('num', String(num));
    u.searchParams.set('gl', 'us');
    u.searchParams.set('api_key', apiKey);
    const res = await fetch(u, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) throw new Error(`SerpApi ${res.status}: ${await res.text()}`);
    const j = await res.json();
    return (j.organic_results || []).map((o) => ({ url: o.link, title: o.title || '', snippet: o.snippet || '', position: o.position }));
  }
  throw new Error(`unknown search engine: ${engine}`);
}

// Build a single-arg search function bound to config (what discovery/socials consume).
// Picks the right per-engine key from the search config block.
export function makeSearchFn(searchCfg = {}) {
  const engine = searchCfg.engine || 'mock';
  if (engine === 'mock') return null;
  const apiKey = engine === 'serpapi' ? searchCfg.serpapiKey : searchCfg.serperKey;
  if (!apiKey) return null;
  return (query) => search(query, { engine, apiKey });
}
