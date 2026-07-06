import { describe, it, expect } from "vitest";
import {
  toMinutes, minutesToLabel, entryStatus, isConfirmed, needsMyConfirmation,
  computeBalances, claimCount, isFull, canClaim, claimErrorMessage, canLogHours,
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
