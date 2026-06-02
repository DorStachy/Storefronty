// Classifies an inbound reply into an intent (+ the requested change for edits).
// Rules now; a cheap LLM can replace this later behind the same function.
const OPT_OUT = /\b(stop|unsubscribe|remove me|opt[\s-]?out|not interested|take me off|leave me alone)\b/i;
const ANGRY = /\b(scam|spam|sue|lawyer|legal action|reported|harass|fraud)\b/i;
const PRICE = /\b(how much|what.* cost|price|pricing|costs?|fees?|charge|expensive)\b/i;

export function classify(text) {
  const t = (text || '').trim();
  if (!t) return { intent: 'other', change: '' };
  if (OPT_OUT.test(t)) return { intent: 'opt_out', change: '' };
  if (ANGRY.test(t)) return { intent: 'angry', change: '' };
  if (PRICE.test(t)) return { intent: 'question', change: t };
  // Our email explicitly asks "tell me one thing you'd change", so a normal reply is an edit request.
  return { intent: 'edit_request', change: t };
}
