// The Researcher: city + niche -> shops with NO website (the leads we want).
import * as mock from './mock.js';
import * as places from './places.js';

const ENGINES = { mock, places };

// Pure: returns normalized leads (no DB). Filters out shops that already have a website.
export async function research({ niche, city, limit = 20, engine = 'mock', apiKey = '' }) {
  const mod = ENGINES[engine];
  if (!mod) throw new Error(`unknown researcher engine: ${engine}`);
  const found = await mod.search({ niche, city, limit, apiKey });
  return found.filter((l) => !l.hasWebsite);
}
