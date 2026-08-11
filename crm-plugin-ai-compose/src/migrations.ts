/**
 * Idempotent SQL for ai_compose_settings.
 * Statements are split on `;` — do not use DO $$ blocks.
 */
export const AI_COMPOSE_MIGRATIONS_SQL = `
CREATE TABLE IF NOT EXISTS ai_compose_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  api_key_enc TEXT,
  base_url TEXT NOT NULL DEFAULT 'https://api.openai.com/v1',
  default_model TEXT,
  allowed_models TEXT[] NOT NULL DEFAULT '{}',
  system_prompt TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
)
`;
