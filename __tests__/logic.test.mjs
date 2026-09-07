import { describe, it, expect } from "vitest";
import {
  toMinutes, minutesToLabel, entryStatus, isConfirmed, needsMyConfirmation,
  computeBalances, claimCount, isFull, canClaim, claimErrorMessage, canLogHours, searchableFields,
  buildCalendarEvents, CALENDAR_EXPORT_HORIZON_DAYS, CALENDAR_EXPORT_MAX_EVENTS,
} from "../src/logic.js";

describe("time helpers", () => {
  it("toMinutes combines hours and minutes", () => {
    expect(toMinutes(2, 30)).toBe(150);
    expect(toMinutes("1", "15")).toBe(75);
    expect(toMinutes(0, 0)).toBe(0);
  });
  it("toMinutes floors and clamps junk to 0", () => {
    expect(toMinutes(-3, 10)).toBe(10);
    expect(toMinutes(1.9, 5.9)).toBe(65);
    expect(toMinutes("x", "y")).toBe(0);
  });
  it("minutesToLabel formats hours/minutes with sign", () => {
    expect(minutesToLabel(0)).toBe("0m");
    expect(minutesToLabel(45)).toBe("45m");
    expect(minutesToLabel(120)).toBe("2h");
    expect(minutesToLabel(150)).toBe("2h 30m");
    expect(minutesToLabel(-150)).toBe("-2h 30m");
  });
});

describe("agreement state", () => {
  const locked = { status: "locked", sitter_agreed: 1, parent_agreed: 1 };
  const pending = { status: "pending", sitter_agreed: 1, parent_agreed: 0 };
  it("only a locked agreement is confirmed", () => {
    expect(entryStatus(locked)).toBe("confirmed");
    expect(entryStatus(pending)).toBe("pending");
    expect(entryStatus(undefined)).toBe("pending");
    expect(isConfirmed(locked)).toBe(true);
    expect(isConfirmed(pending)).toBe(false);
  });

  const entry = { id: "e1", sitter_id: "s", parent_id: "p" };
  it("parent needs to confirm a pending entry; sitter already agreed", () => {
    expect(needsMyConfirmation(entry, pending, "p")).toBe(true);
    expect(needsMyConfirmation(entry, pending, "s")).toBe(false);
  });
  it("nobody needs to confirm once locked", () => {
    expect(needsMyConfirmation(entry, locked, "p")).toBe(false);
  });
  it("a non-participant never needs to confirm", () => {
    expect(needsMyConfirmation(entry, pending, "stranger")).toBe(false);
  });
});

describe("computeBalances", () => {
  // e1: A sat for B, 180m, confirmed → A +180 / B -180
  // e2: B sat for A, 90m, confirmed  → B +90  / A -90
  // e3: A sat for B, 60m, PENDING    → ignored
  const entries = [
    { id: "e1", sitter_id: "A", sitter_name: "Ann", parent_id: "B", parent_name: "Bo", minutes: 180 },
    { id: "e2", sitter_id: "B", sitter_name: "Bo", parent_id: "A", parent_name: "Ann", minutes: 90 },
    { id: "e3", sitter_id: "A", sitter_name: "Ann", parent_id: "B", parent_name: "Bo", minutes: 60 },
  ];
  const agreements = new Map([
    ["e1", { status: "locked" }],
    ["e2", { status: "locked" }],
    ["e3", { status: "pending" }],
  ]);

  it("nets only confirmed entries from A's perspective", () => {
    const bal = computeBalances(entries, agreements, "A");
    expect(bal.earned).toBe(180);
    expect(bal.spent).toBe(90);
    expect(bal.net).toBe(90);
    expect(bal.byPartner).toEqual([{ partnerId: "B", partnerName: "Bo", net: 90 }]);
  });

  it("is symmetric from B's perspective", () => {
    const bal = computeBalances(entries, agreements, "B");
    expect(bal.net).toBe(-90);
    expect(bal.byPartner[0].net).toBe(-90);
  });

  it("excludes pending entries entirely", () => {
    const onlyPending = computeBalances(
      [entries[2]], new Map([["e3", { status: "pending" }]]), "A");
    expect(onlyPending.net).toBe(0);
    expect(onlyPending.byPartner).toEqual([]);
  });

  it("accepts a plain object index too", () => {
    const bal = computeBalances(entries, { e1: { status: "locked" }, e2: { status: "locked" }, e3: { status: "pending" } }, "A");
    expect(bal.net).toBe(90);
  });
});

describe("coverage claiming", () => {
  const request = { id: "r1", requester_id: "R", capacity: 1, status: "open" };
  it("counts and detects fullness", () => {
    expect(claimCount("r1", [{ request_id: "r1" }, { request_id: "r2" }])).toBe(1);
    expect(isFull(request, [{ request_id: "r1", member_id: "X" }])).toBe(true);
    expect(isFull(request, [])).toBe(false);
  });
  it("lets an eligible member claim", () => {
    expect(canClaim(request, [], "X")).toBe(true);
  });
  it("blocks the requester from covering their own request", () => {
    expect(canClaim(request, [], "R")).toBe(false);
  });
  it("blocks claiming a full, closed, or already-claimed request", () => {
    expect(canClaim(request, [{ request_id: "r1", member_id: "Y" }], "X")).toBe(false);
    expect(canClaim({ ...request, status: "closed" }, [], "X")).toBe(false);
    expect(canClaim(request, [{ request_id: "r1", member_id: "X" }], "X")).toBe(false);
  });
  it("maps slot_claims 409 reasons to messages", () => {
    expect(claimErrorMessage({ reason: "slot_full" })).toMatch(/last opening/);
    expect(claimErrorMessage({ reason: "already_claimed" })).toMatch(/already/);
    expect(claimErrorMessage({ reason: "slot_closed" })).toMatch(/no longer open/);
    expect(claimErrorMessage({})).toMatch(/Could not claim/);
  });
});

describe("canLogHours mirrors adult_writable / party_scoped adult use", () => {
  it("requires an adult", () => {
    expect(canLogHours({ role: "adult" })).toBe(true);
    expect(canLogHours({ role: "child" })).toBe(false);
    expect(canLogHours(null)).toBe(false);
  });
});

describe("searchableFields", () => {
  it("matches on the notes and which kids were covered", () => {
    const fields = searchableFields({ title: "Friday evening", notes: "bedtime done", kids: "Mia and Sam", requester_name: "Ada" });
    expect(fields).toContain("Mia and Sam");
    expect(fields).toContain("bedtime done");
  });
});

describe("buildCalendarEvents", () => {
  const from = new Date(2026, 0, 15);       // 2026-01-15, local
  const todayIso = "2026-01-15";
  const base = {
    id: "r1", requester_id: "A", requester_name: "Ada", title: "Friday evening",
    date: "2026-01-20", start_time: "18:00", end_time: "21:30", kids: "Mia and Sam",
    est_minutes: 210, capacity: 1, status: "open", notes: "bedtime is 8",
  };

  it("builds a timed entry for an upcoming request", () => {
    const [e] = buildCalendarEvents([base], todayIso, from);
    expect(e).toEqual({
      id: "r1",
      title: "Friday evening",
      description: "Open",
      location: "",
      start: "2026-01-20T18:00",
      end: "2026-01-20T21:30",
      all_day: false,
      member_ids: ["A"],
      source_label: "Babysitting",
    });
  });

  it("a closed request is labelled Covered, not Closed", () => {
    // A closed request means a sitter took it, so the sitting still happens and
    // the entry stays on the calendar. "Closed" would read as cancelled.
    const [e] = buildCalendarEvents([{ ...base, status: "closed" }], todayIso, from);
    expect(e.description).toBe("Covered");
    const [unknown] = buildCalendarEvents([{ ...base, status: "" }], todayIso, from);
    expect(unknown.description).toBe("Coverage");
  });

  it("a request with no start time is an all-day entry ending where it starts", () => {
    const [e] = buildCalendarEvents([{ ...base, start_time: "", end_time: "" }], todayIso, from);
    expect(e.start).toBe("2026-01-20");
    expect(e.end).toBe("2026-01-20");
    expect(e.all_day).toBe(true);
  });

  it("falls back to the start when only the end time is missing", () => {
    const [e] = buildCalendarEvents([{ ...base, end_time: "" }], todayIso, from);
    expect(e.end).toBe("2026-01-20T18:00");
  });

  it("leaves member_ids empty when the requester is unknown", () => {
    const [e] = buildCalendarEvents([{ ...base, requester_id: "" }], todayIso, from);
    expect(e.member_ids).toEqual([]);
  });

  it("excludes past requests and requests beyond the horizon", () => {
    const past = { ...base, id: "past", date: "2026-01-14" };
    const beyond = { ...base, id: "beyond", date: "2026-12-31" };
    const ids = buildCalendarEvents([past, base, beyond], todayIso, from).map(e => e.id);
    expect(ids).toEqual(["r1"]);
  });

  it("excludes cancelled requests", () => {
    const events = buildCalendarEvents([{ ...base, status: "cancelled" }], todayIso, from);
    expect(events).toEqual([]);
  });

  it("never exports the notes or the kids' names", () => {
    // This payload is scope-wide and reaches the household ICS feed, which
    // external calendar services fetch. `notes` is free text a parent wrote for
    // the co-op and `kids` is the children's names — neither belongs on a feed
    // that leaves the household. Assert on the serialized blob, because that is
    // exactly what gets POSTed to the store.
    const json = JSON.stringify(buildCalendarEvents([base], todayIso, from));
    expect(json).not.toContain("bedtime is 8");
    expect(json).not.toContain("Mia and Sam");
    expect(json).not.toContain("notes");
    expect(json).not.toContain("kids");
  });

  it("caps at CALENDAR_EXPORT_MAX_EVENTS, keeping the nearest requests", () => {
    const rows = [];
    for (let i = 0; i < CALENDAR_EXPORT_MAX_EVENTS + 20; i++) {
      const day = String(16 + (i % 14)).padStart(2, "0");
      rows.push({ ...base, id: `r${i}`, date: `2026-01-${day}` });
    }
    const events = buildCalendarEvents(rows, todayIso, from);
    expect(events.length).toBe(CALENDAR_EXPORT_MAX_EVENTS);
    // Sorted ascending, so the cap sheds the FURTHEST out, never the soonest.
    expect(events[0].start.startsWith("2026-01-16")).toBe(true);
    const kept = events.map(e => e.start);
    expect([...kept].sort()).toEqual(kept);
    expect(kept[kept.length - 1] < "2026-01-29").toBe(true);
  });

  it("horizon is half a year — a co-op is arranged a season ahead at most", () => {
    expect(CALENDAR_EXPORT_HORIZON_DAYS).toBe(180);
  });
});
