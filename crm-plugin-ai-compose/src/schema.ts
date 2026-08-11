import { pgTable, uuid, text, timestamp } from 'drizzle-orm/pg-core';

export const aiComposeSettings = pgTable('ai_compose_settings', {
  id: uuid('id').defaultRandom().primaryKey(),
  apiKeyEnc: text('api_key_enc'),
  baseUrl: text('base_url').notNull().default('https://api.openai.com/v1'),
  defaultModel: text('default_model'),
  allowedModels: text('allowed_models').array().notNull().default([]),
  systemPrompt: text('system_prompt'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export type AiComposeSettings = typeof aiComposeSettings.$inferSelect;
