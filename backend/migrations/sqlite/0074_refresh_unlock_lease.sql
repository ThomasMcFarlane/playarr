-- Device-bound unlock lease for PIN-locked profiles (TASKS 115). A refresh for
-- a profile that has a PIN is refused (`pin_required`) unless the device's
-- token family holds an unexpired lease; a full login or the unlock endpoint
-- grants one. NULL means locked. Existing rows start locked, so a PIN-locked
-- profile asks for its PIN once after the upgrade.
ALTER TABLE refresh_token_families ADD COLUMN unlock_until TEXT;
