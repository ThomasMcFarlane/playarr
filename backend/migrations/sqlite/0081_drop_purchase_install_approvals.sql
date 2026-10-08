-- The `purchase` and `install` approval kinds are retired (owner decision, 9 Oct 2026): Playarr has no
-- store, so approvals cover only `content` and `time`.
--
-- Strip the retired kinds from stored household policies and delete their approval rows. Reading a
-- policy also skips unknown kinds (`HouseholdControls::approval_required`), so a policy replicated from
-- an older peer after this migration still loads.
UPDATE policies
SET household = json_set(
    household,
    '$.approval_required',
    json(COALESCE((
        SELECT json_group_array(value)
        FROM json_each(household, '$.approval_required')
        WHERE value NOT IN ('purchase', 'install')
    ), '[]'))
)
WHERE json_valid(household)
  AND EXISTS (
      SELECT 1 FROM json_each(household, '$.approval_required')
      WHERE value IN ('purchase', 'install')
  );

DELETE FROM household_approvals WHERE kind IN ('purchase', 'install');
