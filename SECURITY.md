# Babysitting Co-op Ledger — Access-Control Review

Reviewed against `APP_REVIEW_GUIDE.md`. The lens: **client-side JS is not a
security boundary** — any household member can POST arbitrary SQL to `/api/db`
against this app's own tables, so every rule that matters must live in a
`row_policy` or a trusted hub endpoint.

## Tables and enforcement

| Table | Policy | Holds | Verdict |
|---|---|---|---|
| `coverage_requests` | `adult_writable` | Shared coverage board (adults) | 🟡 any adult can edit/delete any request |
| `coverage_claims` | `endpoint_only` (read everyone) + `slot_claims` | Sitter offers | 🟢 capacity + identity enforced server-side |
| `ledger_entries` | `party_scoped` (`sitter_id`,`parent_id`; self=`sitter_id`) | Per-sitting hours | 🟡 post-confirm edit/delete not frozen (platform limit) |
| `ledger_agreements` | `endpoint_only` (read adult) + `agreements` | Confirmation state | 🟢 only `api/agree` writes; balances derive from here |

## Findings

### 🟢 Balances cannot be self-minted — the core integrity property holds
A ledger entry credits the sitter and debits the parent, but **credit only counts
when the entry is confirmed**, and "confirmed" is read exclusively from
`ledger_entries`' sibling `ledger_agreements` table
([logic.js `entryStatus`/`computeBalances`](src/logic.js), enforced by
`agreements` in [manifest.json](manifest.json)). `ledger_agreements` is
`endpoint_only`: the *only* writer is the hub's `api/agree` endpoint, which sets a
caller to their **own** flag and locks only when both parties agree. A member who
forges an entry crediting themselves against a victim (allowed by `party_scoped`,
since they're a participant) gains nothing — the victim never confirms, so it stays
`pending` and is excluded from every balance. This is the borrowing-app pattern
applied to hours: item detail in a `party_scoped` table, consent in an
`endpoint_only` table.

### 🟢 Coverage capacity is enforced atomically
"One sitter, no double-booking" is a cross-row invariant a row policy cannot
express, so claims go through `slot_claims` (atomic `INSERT … SELECT`, server-derived
`member_id`/`claim_id`/`claimed_at`, `409` reasons handled in
[index.html `claimRequest`](src/index.html)). The `coverage_claims` table is
`endpoint_only`, so raw `/api/db` cannot bypass the capacity guard, and
`one_claim_per_member` blocks duplicate offers. Release only deletes the caller's
own claim.

### 🟢 Ledger confidentiality
`ledger_entries` is `party_scoped`, so a member reads/writes only rows they are
named on — the hours, note, and date of a sitting between two other members are
invisible to everyone else. `ledger_agreements` (which does not carry minutes or
notes) is scoped to `read: "adult"`, matching the adults-only audience.

### 🟡 Low — `ledger_entries` is not frozen after both parties confirm
`party_scoped` grants each participant full write to their rows, and the platform
has **no column-level write-immutability and no `frozen_when` source** for a lock
that lives in a *sibling* table. So after an entry is confirmed, either named party
could still `UPDATE … minutes` or `DELETE` the row via raw `/api/db`, changing the
derived balance.
- **Why it's bounded:** both parties are named adults who already consented; any
  change is visible to the counterparty (who sees the new value and can dispute /
  re-log), and neither can touch entries they aren't a party to. This is the exact
  residual the reference `borrowing` app ships with (post-lock term edits).
- **Fix if stricter integrity is ever required:** move confirmed sittings into an
  immutable `endpoint_only` table written by a bespoke "confirm" endpoint (or
  `append_only_records`) and derive balances only from that — the client would no
  longer hold a writable copy of the authoritative minutes. Not warranted at
  family/co-op trust level; flagged for completeness.

### 🟡 Low — any adult can edit or delete another member's coverage request
`coverage_requests` is `adult_writable`, so the server allows any adult to
`UPDATE`/`DELETE` any request; the "only the poster can close/reopen/delete" checks
in [index.html](src/index.html) (`closeRequest`, `deleteRequest`) are **client-side
only** and bypassable. Matches `potluck`/`shifts` (events are `adult_writable`) and
is acceptable for a cooperative board of trusted adults. If per-owner control is
wanted, switch to `owner_or_visibility` (`member_column: requester_id`,
`everyone_values: ["household"]`, `write_owner_only: true`) so only the poster
mutates a request while everyone still reads it.

## Other surfaces (all 🟢)
- **XSS:** every DB/user string is rendered through `esc()`; no `SELECT *` value is
  placed in the DOM unescaped. UI uses delegated `data-*` handlers, not
  `onclick="fn('${value}')"`, so there is no inline-handler injection.
- **Notifications:** confirmation and claim pushes are targeted to the single
  relevant member id; the coverage-posted push targets the explicit adult list, not
  the household-wide `"all"` default — no restricted content in a broad push.
- **Events:** `babysitting.coverage_posted` / `hours_confirmed` are gated by
  `publish_acls: require_role: "adult"`; no other app consumes them as authoritative
  value.
- **AI exports:** `open_coverage` and `recent_claims` are single-table SELECTs on
  everyone-readable tables (no `member_id` needed, no JOIN on a governed table). The
  private ledger is deliberately **not** exposed to MCP.
- **Money/units:** hours are stored as integer minutes (minor units), summed in JS;
  `minutes` is never filtered or sorted in SQL, so it can stay encrypted at rest.
- **Performance:** startup loads run in `Promise.all`; writes update local state
  optimistically (no full refetch); indexes cover the `status`/`date` and
  `sitter_id`/`parent_id` access paths.

## Per-app severity summary

| Severity | Count | Items |
|---|---|---|
| 🔴 High | 0 | — |
| 🟠 Medium | 0 | — |
| 🟡 Low | 2 | ledger rows not frozen post-confirm; adult can edit any coverage request |
| 🟢 None | — | balance integrity, capacity, ledger confidentiality, XSS, notifications, events, AI, perf |

No confidentiality breach or privilege escalation is reachable by any member. The
two Low items are known platform trade-offs (both mirror shipped reference apps),
not enforcement gaps in this app's design.
