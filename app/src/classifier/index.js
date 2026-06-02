// Classifies an inbound reply into an intent (+ the requested change for edits).
// Rules now; a cheap LLM can replace this later behind the same function.
//
// Order matters: opt-out (compliance) → angry/legal → auto-reply (don't act on a bot) →
// pricing question → acknowledgement (not an edit) → otherwise an edit request.

// Opt-out is a COMMAND, not any sentence containing "stop"/"remove". "stop the red logo" and
// "remove the giant logo" are edits — so bare "stop"/"remove" never trigger opt-out; only an
// explicit unsubscribe, "remove me", or "stop <…> emailing/contacting/…" does.
const OPT_OUT = new RegExp([
  '\\bunsubscribe\\b', '\\bopt[\\s-]?out\\b', '\\bremove me\\b', '\\btake me off\\b',
  '\\bleave me alone\\b', '\\bnot interested\\b', '\\bno thanks?\\b.*\\b(stop|remove|unsubscribe)\\b',
  '\\bstop\\b\\s*\\w*\\s*(emailing|email|emails|contacting|contact|messaging|message|texting|sending|mailing|spamming)',
  '^\\s*stop[\\s.!]*$', "\\bdo ?n'?t\\s+(email|contact|message|reach out)",
].join('|'), 'i');

const ANGRY = /\b(scam|spam|sue|suing|lawyer|attorney|legal action|cease and desist|reported?|harass\w*|fraud|illegal)\b/i;

const AUTO_REPLY = new RegExp([
  'out of (the )?office', 'automatic reply', 'auto[-\\s]?reply', 'away from my (desk|office|email)',
  'on (vacation|holiday|leave|annual leave|maternity leave|parental leave)', 'currently away',
  "i('?m| am)\\s+(currently\\s+)?(out|away|on leave)", 'return(ing)? to the office', '\\booo\\b',
].join('|'), 'i');

const PRICE = /\b(how much|what.{0,20}\bcosts?\b|pricing|prices?|costs?|fees?|charges?|expensive|how do i (pay|sign ?up|buy)|per month|monthly|subscription)\b/i;

const ACK_PHRASES = ['thank you so much', 'thanks so much', 'thank you', 'thanks', 'thx', 'ty', 'got it',
  'received', 'noted', 'okay', 'ok', 'great', 'cool', 'perfect', 'awesome', 'sounds good', 'will do',
  'cheers', 'appreciate it', 'much appreciated', 'you'].sort((a, b) => b.length - a.length);

// True when the WHOLE message is just acknowledgement words ("thanks!", "got it, ok") — not an edit.
function isAcknowledgement(text) {
  let s = text.toLowerCase().replace(/[!.,;:]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!s) return false;
  for (let guard = 0; s && guard < 12; guard++) {
    const p = ACK_PHRASES.find((phrase) => s === phrase || s.startsWith(phrase + ' '));
    if (!p) break;
    s = s.slice(p.length).trim();
  }
  return s === '';
}

export function classify(text) {
  const t = (text || '').trim();
  if (!t) return { intent: 'other', change: '' };
  if (OPT_OUT.test(t)) return { intent: 'opt_out', change: '' };
  if (ANGRY.test(t)) return { intent: 'angry', change: '' };
  if (AUTO_REPLY.test(t)) return { intent: 'auto_reply', change: '' };
  if (PRICE.test(t)) return { intent: 'question', change: t };
  if (isAcknowledgement(t)) return { intent: 'other', change: '' };
  // Our email explicitly asks "tell me one thing you'd change", so a substantive reply is an edit.
  return { intent: 'edit_request', change: t };
}
