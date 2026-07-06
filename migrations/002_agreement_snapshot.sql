-- Freeze the confirmed sitting length into the endpoint_only ledger_agreements
-- row at confirmation time. `minutes` lives on the party_scoped ledger_entries
-- table, which EITHER named party can UPDATE at any time via raw /api/db -- so
-- after both confirmed, a party could inflate or shrink the credited minutes
-- while the entry still showed as Confirmed, corrupting the who-owes-whom ledger.
-- The `agreements` mechanism froze the consent FLAGS but not the AMOUNT.
--
-- The api/agree endpoint now copies `minutes` from ledger_entries into this
-- endpoint_only table at the moment the entry locks (manifest
-- agreements.snapshot_columns). Because this table blocks app-originated writes,
-- the snapshot is immutable; balances and the entry display derive from it for
-- confirmed entries (see computeBalances / renderEntryRow). Column name MUST match
-- the source column exactly (the endpoint copies by name).
ALTER TABLE app_babysitting_coop__ledger_agreements ADD COLUMN minutes INTEGER;

-- Backfill snapshots for entries that are already confirmed (locked), copying the
-- current ledger_entries value so historical confirmed entries keep counting.
UPDATE app_babysitting_coop__ledger_agreements
SET minutes = (
  SELECT minutes FROM app_babysitting_coop__ledger_entries e
  WHERE e.id = app_babysitting_coop__ledger_agreements.id
)
WHERE status = 'locked';
