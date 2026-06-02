// The sweep: broaden across niches × cities (paginated Places), and find QUALIFIED SENDABLE leads —
// verified NO_WEBSITE (100%) AND a contact email found. Reports the funnel
// (scanned → no-website → has-email → sendable) and persists each sendable lead with its email.
// Everything is dependency-injected so the funnel logic is unit-tested offline.
export async function sweep(db, { niches, cities, perCity = 20, want = 3, maxScan = Infinity }, deps) {
  const { placesSearch, buildIdentity, discover, discoverEmail, onLog = () => {} } = deps;
  let scanned = 0, noWebsite = 0, hasEmail = 0;
  const sendable = [];
  const done = () => sendable.length >= want || scanned >= maxScan;

  for (const city of cities) {
    for (const niche of niches) {
      if (done()) break;
      let cands = [];
      try { cands = await placesSearch({ niche, city, limit: perCity }); }
      catch (e) { onLog(`  ! places error ${niche} / ${city}: ${e.message || e}`); continue; }
      onLog(`\n— ${niche} in ${city} (${cands.length}) —`);
      for (const c of cands) {
        if (done()) break;
        scanned++;
        if (c.hasWebsite) { onLog(`  · has-site(engine)  ${c.name}`); continue; }
        const id = buildIdentity(c);
        let v;
        try { v = await discover(id); } catch { v = { status: 'UNCERTAIN' }; }
        if (v.status !== 'NO_WEBSITE') { onLog(`  · ${v.status}        ${c.name}`); continue; }
        noWebsite++;
        let em;
        try { em = await discoverEmail(id); } catch { em = { email: null }; }
        onLog(`  ✓ NO_WEBSITE      ${c.name}  ${em.email ? `→ ${em.email} (${em.confidence})` : '→ no email'}`);
        if (!em.email) continue;
        hasEmail++;
        const { id: leadId } = db.insertLead({ ...c, email: em.email, website_status: 'none' });
        db.recordEvent(leadId, 'email_found', { email: em.email, confidence: em.confidence, source: em.source });
        sendable.push({ leadId, name: c.name, city: c.city, email: em.email, confidence: em.confidence, reasons: v.reasons || [] });
      }
    }
  }
  return { scanned, noWebsite, hasEmail, sendable };
}
