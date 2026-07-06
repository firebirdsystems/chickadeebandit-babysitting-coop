// Pure, framework-free logic for the Babysitting Co-op Ledger.
// Imported by both src/index.html (in the browser) and __tests__/logic.test.mjs.
// No DOM, no network, no module-level app state.

import { isAdult } from "./shared.js";
export { isAdult };

// ── Time helpers ──────────────────────────────────────────────────────────────

/** Combine whole hours + minutes into a single integer minute count. */
export function toMinutes(hours, minutes) {
  const h = Math.max(0, Math.floor(Number(hours) || 0));
  const m = Math.max(0, Math.floor(Number(minutes) || 0));
  return h * 60 + m;
}

/** Format a signed or unsigned minute count as "3h 30m" / "45m" / "0m". */
export function minutesToLabel(minutes) {
  const total = Math.round(Number(minutes) || 0);
  const sign = total < 0 ? "-" : "";
  const abs = Math.abs(total);
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  if (h && m) return `${sign}${h}h ${m}m`;
  if (h) return `${sign}${h}h`;
  return `${sign}${m}m`;
}

// ── Agreement / confirmation state ────────────────────────────────────────────

/**
 * Derive an entry's effective confirmation state from its agreement row.
 * The agreement row is the ONLY trustworthy source (endpoint_only); a value on
 * the party_scoped ledger row itself must never be used for this.
 * Returns "confirmed" | "pending".
 */
export function entryStatus(agreement) {
  return agreement && agreement.status === "locked" ? "confirmed" : "pending";
}

/** True once both parties have agreed. */
export function isConfirmed(agreement) {
  return entryStatus(agreement) === "confirmed";
}

/**
 * Whether `me` still needs to confirm this entry (they are a participant, the
 * entry is not yet confirmed, and their own flag is not yet set). The sitter is
 * the creator and auto-agrees, so in practice this is the parent's action.
 */
export function needsMyConfirmation(entry, agreement, meId) {
  if (!entry || !meId) return false;
  if (isConfirmed(agreement)) return false;
  if (entry.sitter_id === meId) return !(agreement && agreement.sitter_agreed);
  if (entry.parent_id === meId) return !(agreement && agreement.parent_agreed);
  return false;
}

/** Only the sitter (the member who provided care) may log an entry. */
export function canLogHours(me) {
  return isAdult(me);
}

// ── Balances ──────────────────────────────────────────────────────────────────

/**
 * Compute the caller's co-op balance from confirmed entries only.
 * A confirmed entry credits the sitter and debits the parent, in minutes.
 *
 * Returns:
 *   { earned, spent, net, byPartner: [{ partnerId, partnerName, net }] }
 * where net > 0 means the co-op owes `me` care, net < 0 means `me` owes care.
 * byPartner is sorted by descending |net|.
 */
export function computeBalances(entries, agreementsById, meId) {
  let earned = 0;
  let spent = 0;
  const partners = new Map(); // partnerId -> { partnerId, partnerName, net }

  for (const e of entries || []) {
    const agreement = agreementsById.get?.(e.id) ?? agreementsById[e.id];
    if (!isConfirmed(agreement)) continue;
    // Once confirmed, the credited amount is frozen in the endpoint_only
    // ledger_agreements snapshot (minutes). A post-confirmation edit to the
    // party_scoped ledger_entries.minutes via raw /api/db must NOT change the
    // balance — always prefer the snapshot for confirmed entries.
    const source = confirmedMinutes(agreement, e);
    const mins = Math.max(0, Math.round(Number(source) || 0));
    if (e.sitter_id === meId) {
      earned += mins;
      bump(partners, e.parent_id, e.parent_name, mins);
    } else if (e.parent_id === meId) {
      spent += mins;
      bump(partners, e.sitter_id, e.sitter_name, -mins);
    }
  }

  const byPartner = [...partners.values()]
    .filter((p) => p.net !== 0)
    .sort((a, b) => Math.abs(b.net) - Math.abs(a.net));

  return { earned, spent, net: earned - spent, byPartner };
}

/**
 * The authoritative minute count for a confirmed entry: the frozen snapshot on
 * the (endpoint_only) agreement row when present, else the entry's own value
 * (pending entries, or rows predating the snapshot column).
 */
export function confirmedMinutes(agreement, entry) {
  const snap = agreement?.minutes;
  return snap != null && snap !== "" ? snap : entry?.minutes;
}

function bump(map, partnerId, partnerName, delta) {
  const cur = map.get(partnerId) || { partnerId, partnerName, net: 0 };
  cur.net += delta;
  cur.partnerName = partnerName || cur.partnerName;
  map.set(partnerId, cur);
}

// ── Coverage board ────────────────────────────────────────────────────────────

/** Number of sitters who have claimed a request. */
export function claimCount(requestId, claims) {
  return (claims || []).filter((c) => c.request_id === requestId).length;
}

/** True when the request has no remaining sitter capacity. */
export function isFull(request, claims) {
  return claimCount(request.id, claims) >= Number(request.capacity || 0);
}

/** Whether `me` may still claim this request (open, room left, not already claimed). */
export function canClaim(request, claims, meId) {
  if (!request || !meId) return false;
  if (request.status !== "open") return false;
  if (isFull(request, claims)) return false;
  if (request.requester_id === meId) return false; // don't sit for yourself
  return !(claims || []).some((c) => c.request_id === request.id && c.member_id === meId);
}

/** Map a slot_claims 409 reason to a human message. */
export function claimErrorMessage(json) {
  switch (json && json.reason) {
    case "slot_full": return "Someone just claimed the last opening.";
    case "already_claimed": return "You already offered to cover this.";
    case "slot_closed": return "That request is no longer open.";
    default: return (json && json.error) || "Could not claim that request.";
  }
}
