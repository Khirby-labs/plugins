import { pgTable, uuid, integer, text, timestamp } from 'drizzle-orm/pg-core';

export const lmCampaigns = pgTable('lm_campaigns', {
  id: uuid('id').defaultRandom().primaryKey(),
  listmonkCampaignId: integer('listmonk_campaign_id').notNull().unique(),
  name: text('name').notNull(),
  subject: text('subject').notNull(),
  status: text('status').notNull().default('draft'),
  fromEmail: text('from_email'),
  replyToAddress: text('reply_to_address'),
  sentCount: integer('sent_count').notNull().default(0),
  viewsCount: integer('views_count').notNull().default(0),
  clicksCount: integer('clicks_count').notNull().default(0),
  repliesCount: integer('replies_count').notNull().default(0),
  listIds: text('list_ids').notNull().default('[]'),
  sendAt: timestamp('send_at', { withTimezone: true }),
  startedAt: timestamp('started_at', { withTimezone: true }),
  statsLastSyncAt: timestamp('stats_last_sync_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

/** One CRM form assigned to a Listmonk list (ADR-0021). */
export const lmListForms = pgTable('lm_list_forms', {
  listmonkListId: integer('listmonk_list_id').primaryKey(),
  formId: uuid('form_id').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});
