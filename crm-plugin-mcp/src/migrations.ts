/**
 * Idempotent SQL for MCP access tokens.
 * Statements are split on `;` — do not use DO $$ blocks.
 */
export const MCP_MIGRATIONS_SQL = `
CREATE TABLE IF NOT EXISTS mcp_access_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash TEXT NOT NULL,
  prefix TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_used_at TIMESTAMPTZ
);
`;
