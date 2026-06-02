// The lead lifecycle. The orchestrator only ever moves a lead along an allowed edge.
export const STATES = {
  DISCOVERED: 'discovered',
  BUILT: 'built',
  DEPLOYED: 'deployed',
  EMAILED: 'emailed',
  FOLLOWUP_1: 'followup_1',
  FOLLOWUP_2: 'followup_2',
  REPLIED: 'replied',
  EDITING: 'editing',
  PENDING_APPROVAL: 'pending_approval',
  APPROVED: 'approved',
  LINK_SENT: 'link_sent',
  REACHED_PRICING: 'reached_pricing',
  PAID: 'paid',
  LIVE: 'live',
  // side exits
  OPTED_OUT: 'opted_out',
  BOUNCED: 'bounced',
  DEAD: 'dead',
  NEEDS_HUMAN: 'needs_human',
};

// Allowed forward transitions. Side-exits are allowed from almost anywhere (see canTransition).
const FORWARD = {
  discovered: ['built'],
  built: ['deployed'],
  deployed: ['emailed'],
  emailed: ['followup_1', 'replied'],
  followup_1: ['followup_2', 'replied'],
  followup_2: ['replied', 'dead'],
  replied: ['editing', 'reached_pricing'],
  editing: ['pending_approval', 'approved'],
  pending_approval: ['approved', 'editing'],
  approved: ['link_sent'],
  link_sent: ['reached_pricing', 'replied'],
  reached_pricing: ['paid'],
  paid: ['live'],
  live: [],
};

// These can be entered from any non-terminal state.
const SIDE_EXITS = new Set(['opted_out', 'bounced', 'needs_human', 'dead']);
const TERMINAL = new Set(['live', 'opted_out', 'dead']);

export function canTransition(from, to) {
  if (from === to) return true; // idempotent re-writes allowed
  if (SIDE_EXITS.has(to) && !TERMINAL.has(from)) return true;
  return (FORWARD[from] || []).includes(to);
}

export function assertTransition(from, to) {
  if (!canTransition(from, to)) {
    throw new Error(`illegal state transition: ${from} -> ${to}`);
  }
}
