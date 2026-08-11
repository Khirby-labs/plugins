import { pgTable, uuid, text, timestamp } from 'drizzle-orm/pg-core';

export const mcpAccessTokens = pgTable('mcp_access_tokens', {
  id: uuid('id').defaultRandom().primaryKey(),
  tokenHash: text('token_hash').notNull(),
  prefix: text('prefix').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
});
