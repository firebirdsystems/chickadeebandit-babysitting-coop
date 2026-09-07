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

/**
 * Fields the in-app search matches against (see hub-sdk `searchMatch`).
 * Notes and which kids were covered count as well as the title — a
 * past sitting is looked up by who was minded.
 */
export function searchableFields(item) {
  return [item.title, item.notes, item.kids, item.requester_name];
}

// ── Calendar export ───────────────────────────────────────────────────────────

export const CALENDAR_EXPORT_HORIZON_DAYS = 180;
export const CALENDAR_EXPORT_MAX_EVENTS = 100;

function atMidnight(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
}

/** Local `yyyy-mm-dd` for a Date — used only to place the horizon cutoff. */
export function isoDay(d) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * Build the `calendar_events` payload from upcoming coverage requests.
 *
 * Shape matches what the hub's cross-app aggregation consumes — see
 * `normalizeExportedEvent` in packages/hub/src/cloudflare/calendar-feed.ts.
 * A request with no `start_time` becomes an all-day entry: the hub derives
 * `allDay` from the absence of a `T` in `start`, so a date-only request
 * degrades on its own rather than being dropped.
 *
 * ONLY coverage_requests are exported. This blob is scope-wide — every member
 * of the household, and every household in a shared space, reads all of it, and
 * row policies do not filter it. coverage_requests is `adult_writable`, so
 * everyone in the scope can already see these rows. ledger_entries is
 * `party_scoped` (visible only to the two members named on the row) and
 * ledger_agreements is `endpoint_only` with `read: "adult"` — neither is
 * scope-wide, so putting either in this payload would hand every reader a
 * private exchange between two households. coverage_claims would be
 * permissible (`read: "everyone"`), but the request row is the dated thing and
 * naming the sitter adds no date, so it is left out.
 *
 * `notes` and `kids` are deliberately NOT exported. This payload reaches the
 * household's ICS feed, which external calendar services fetch: `notes` is free
 * text a parent wrote for the co-op, and `kids` is the children's names. The
 * title and the hours are what a calendar entry is FOR; there is no location
 * column on a request, so location is always "".
 */
export function buildCalendarEvents(requests, todayIso, from = new Date()) {
  const horizon = isoDay(new Date(atMidnight(from).getTime() + CALENDAR_EXPORT_HORIZON_DAYS * 86400000));
  return (requests || [])
    .filter((r) => r.status !== "cancelled")
    .filter((r) => r.date >= todayIso && r.date <= horizon)
    .map((r) => {
      const start = r.start_time ? `${r.date}T${r.start_time}` : r.date;
      const end = r.start_time && r.end_time ? `${r.date}T${r.end_time}` : start;
      return {
        id: r.id,
        title: r.title,
        description: statusLabel(r.status),
        location: "",
        start,
        end,
        all_day: !r.start_time,
        member_ids: r.requester_id ? [r.requester_id] : [],
        source_label: "Babysitting",
      };
    })
    .sort((a, b) => String(a.start).localeCompare(String(b.start)))
    .slice(0, CALENDAR_EXPORT_MAX_EVENTS);
}

/**
 * A one-word state, not free text a member typed.
 * The exported label deliberately differs from the internal status value:
 * `closed` here means a sitter took the request, but "Closed" on a calendar
 * entry reads as "cancelled" — the opposite — so it goes out as "Covered".
 */
function statusLabel(status) {
  const s = String(status || "");
  if (s === "closed") return "Covered";
  if (!s) return "Coverage";
  return s.charAt(0).toUpperCase() + s.slice(1);
}
