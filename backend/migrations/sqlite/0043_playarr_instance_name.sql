-- Preserve the immutable 0026 migration while applying the Playarr rename to
-- untouched default instance names. Operator-customised names are retained.
UPDATE system_settings
SET instance_name = 'Playarr Server'
WHERE id = '00000000-0000-0000-0000-00000000a001'
  AND instance_name = 'Streamarr';
