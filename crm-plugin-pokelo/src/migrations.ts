/**
 * Idempotent SQL for pokelo_settings.
 * Statements are split on `;` — do not use DO $$ blocks.
 */
export const POKELO_MIGRATIONS_SQL = `
CREATE TABLE IF NOT EXISTS pokelo_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  base_url TEXT NOT NULL DEFAULT 'https://rag.bearly.pro/v1',
  encrypted_token TEXT,
  project_id TEXT,
  project_ids TEXT[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE pokelo_settings ADD COLUMN IF NOT EXISTS project_ids TEXT[] NOT NULL DEFAULT '{}';

UPDATE pokelo_settings
SET project_ids = ARRAY[project_id]
WHERE project_id IS NOT NULL
  AND project_id <> ''
  AND (project_ids IS NULL OR cardinality(project_ids) = 0)
`;
