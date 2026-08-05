CREATE TABLE IF NOT EXISTS system_settings (
    id TEXT PRIMARY KEY,
    instance_name TEXT NOT NULL CHECK (
        length(trim(instance_name)) BETWEEN 1 AND 100
    )
);

INSERT INTO system_settings (id, instance_name)
VALUES ('00000000-0000-0000-0000-00000000a001', 'Streamarr')
ON CONFLICT (id) DO NOTHING;
