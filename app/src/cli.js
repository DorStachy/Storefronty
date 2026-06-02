// Command-line entry for the pipeline. Run via the package.json scripts.
import { config } from './config.js';
import { openDatabase } from './db.js';
import { seedFromResearch } from './orchestrator.js';

function flags(argv) {
  const o = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) { o[argv[i].slice(2)] = argv[i + 1]?.startsWith('--') ? true : argv[++i]; }
  }
  return o;
}

const [cmd, ...rest] = process.argv.slice(2);
const opts = flags(rest);
const db = openDatabase(config.dbPath);

switch (cmd) {
  case 'init': {
    console.log(`✓ database ready at ${config.dbPath}`);
    break;
  }
  case 'research': {
    const niche = opts.niche || 'barbershop';
    const city = opts.city || 'Austin, TX';
    const limit = Number(opts.limit || 10);
    const engine = opts.engine || config.researcher.engine;
    console.log(`Researching ${niche} in "${city}" via ${engine} (limit ${limit})…`);
    const r = await seedFromResearch(db, { niche, city, limit, engine, apiKey: config.researcher.googleKey });
    console.log(`  found ${r.found} no-website shops · inserted ${r.inserted} new · skipped ${r.skipped} dup`);
    break;
  }
  case 'leads': {
    const rows = db.listLeads(opts.status);
    for (const l of rows) console.log(`#${l.id}  [${l.status}]  ${l.niche.padEnd(10)}  ${l.name} — ${l.city || ''}`);
    console.log(`\n${rows.length} lead(s). By status:`, db.countByStatus().map((c) => `${c.status}:${c.n}`).join('  '));
    break;
  }
  case 'lead': {
    const id = Number(rest[0] || opts.id);
    const l = db.getLead(id);
    if (!l) { console.log(`lead ${id} not found`); break; }
    console.log(l);
    console.log('— events —');
    for (const e of db.eventsFor(id)) console.log(`  ${e.created_at}  ${e.type}  ${e.payload || ''}`);
    break;
  }
  default:
    console.log(`Storefronty pipeline CLI
  init                          create / migrate the database
  research --city --niche --limit [--engine mock|places]
  leads [--status <state>]      list leads
  lead <id>                     show one lead + its event history`);
}

db.close();
