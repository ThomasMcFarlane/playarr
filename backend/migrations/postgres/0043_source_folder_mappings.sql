ALTER TABLE source_instances
ADD COLUMN folder_mappings TEXT NOT NULL DEFAULT '{}';
