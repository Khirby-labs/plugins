import { pgTable, uuid, text, timestamp } from 'drizzle-orm/pg-core';

export const pokeloSettings = pgTable('pokelo_settings', {
  id: uuid('id').defaultRandom().primaryKey(),
  baseUrl: text('base_url').notNull().default('https://rag.bearly.pro/v1'),
  encryptedToken: text('encrypted_token'),
  /** @deprecated prefer projectIds — kept for migration from single-project installs */
  projectId: text('project_id'),
  projectIds: text('project_ids').array().notNull().default([]),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export type PokeloSettings = typeof pokeloSettings.$inferSelect;
