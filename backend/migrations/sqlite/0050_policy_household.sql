-- Household and child controls (docs/architecture/household-controls.md):
-- JSON-encoded `playarr_model::HouseholdControls` on `policies`. `'{}'`
-- deserialises to the default (no household restrictions), so existing
-- policies are unchanged.
ALTER TABLE policies ADD COLUMN household TEXT NOT NULL DEFAULT '{}';
