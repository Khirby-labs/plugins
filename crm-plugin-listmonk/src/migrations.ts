/** Plugin-owned SQL (CREATE IF NOT EXISTS — safe to retry). */
export const LISTMONK_CAMPAIGNS_MIGRATIONS_SQL = `
CREATE TABLE IF NOT EXISTS lm_campaigns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  listmonk_campaign_id INTEGER NOT NULL UNIQUE,
  name TEXT NOT NULL,
  subject TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  from_email TEXT,
  reply_to_address TEXT,
  sent_count INTEGER NOT NULL DEFAULT 0,
  views_count INTEGER NOT NULL DEFAULT 0,
  clicks_count INTEGER NOT NULL DEFAULT 0,
  replies_count INTEGER NOT NULL DEFAULT 0,
  list_ids TEXT NOT NULL DEFAULT '[]',
  send_at TIMESTAMPTZ,
  started_at TIMESTAMPTZ,
  stats_last_sync_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS lm_list_forms (
  listmonk_list_id INTEGER PRIMARY KEY,
  form_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS lm_list_forms_form_id_idx ON lm_list_forms (form_id)
`;
