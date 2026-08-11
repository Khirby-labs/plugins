import { Injectable, Inject, Logger, BadRequestException } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import {
  DB_TOKEN,
  Db,
  PLUGIN_REGISTRY,
  type PluginRegistryLike,
  AppException,
} from '../../../packages/plugin-host/src';
import { toAppException } from './listmonk-errors';
import { lmCampaigns } from './listmonk-campaigns.schema';
import {
  parseConfig,
  fetchCampaigns,
  fetchCampaign,
  createCampaign as createListmonkCampaign,
  updateCampaign as updateListmonkCampaign,
  updateCampaignStatus,
  deleteCampaign as deleteListmonkCampaign,
  fetchCampaignAnalytics,
  fetchTemplates,
  previewCampaignEmail,
  type ListmonkCampaign,
} from './listmonk-client';

const PLUGIN_NAME = 'crm_listmonk';

export interface CreateCampaignDto {
  name: string;
  subject: string;
  lists: number[];
  fromEmail?: string;
  type: 'regular' | 'optin';
  contentType: 'richtext' | 'html' | 'markdown' | 'plain';
  body: string;
  templateId?: number;
  sendAt?: string;
  sendImmediately?: boolean;
  useMailboxReplyTo?: boolean;
}

export type CampaignListItem = ListmonkCampaign & {
  replyToAddress: string | null;
  repliesCount: number;
};

@Injectable()
export class ListmonkCampaignsService {
  private readonly logger = new Logger(ListmonkCampaignsService.name);

  constructor(
    @Inject(PLUGIN_REGISTRY) private registry: PluginRegistryLike,
    @Inject(DB_TOKEN) private db: Db,
  ) {}

  private async getPluginConfig(): Promise<Record<string, string>> {
    const plugin = await this.registry.findByName(PLUGIN_NAME);
    if (!plugin?.enabled) {
      throw AppException.pluginDisabled('listmonk');
    }
    if (!parseConfig(plugin.config ?? {})) {
      throw AppException.pluginNotConfigured(
        'listmonk',
        'Configure Listmonk URL, username and password in Plugins first.',
      );
    }
    return plugin.config ?? {};
  }

  /** Read firm mailbox from_address without importing core schema (ADR-0014). */
  async getMailboxFromAddress(): Promise<string | null> {
    const rows = await this.db.execute(sql`select from_address from mailboxes limit 1`);
    const list = Array.isArray(rows) ? rows : ((rows as { rows?: unknown[] }).rows ?? []);
    const first = list[0] as { from_address?: string } | undefined;
    return first?.from_address ?? null;
  }

  async getFromDefaults(): Promise<{ fromEmail: string | null }> {
    await this.getPluginConfig();
    return { fromEmail: await this.getMailboxFromAddress() };
  }

  private async localByListmonkId(listmonkId: number) {
    const [row] = await this.db
      .select()
      .from(lmCampaigns)
      .where(eq(lmCampaigns.listmonkCampaignId, listmonkId))
      .limit(1);
    return row ?? null;
  }

  async getCampaigns(
    page = 1,
    perPage = 20,
  ): Promise<{
    results: CampaignListItem[];
    total: number;
  }> {
    const config = await this.getPluginConfig();
    try {
      const { results, total } = await fetchCampaigns(config, page, perPage);
      const enriched: CampaignListItem[] = [];
      for (const camp of results) {
        const local = await this.localByListmonkId(camp.id);
        enriched.push({
          ...camp,
          replyToAddress: local?.replyToAddress ?? null,
          repliesCount: local?.repliesCount ?? 0,
        });
      }
      return { results: enriched, total };
    } catch (err) {
      throw toAppException(err, (m) => this.logger.error(m));
    }
  }

  async getCampaign(id: number): Promise<CampaignListItem> {
    const config = await this.getPluginConfig();
    try {
      const camp = await fetchCampaign(config, id);
      const local = await this.localByListmonkId(id);
      return {
        ...camp,
        replyToAddress: local?.replyToAddress ?? null,
        repliesCount: local?.repliesCount ?? 0,
      };
    } catch (err) {
      throw toAppException(err, (m) => this.logger.error(m));
    }
  }

  async createCampaign(dto: CreateCampaignDto): Promise<CampaignListItem> {
    const config = await this.getPluginConfig();
    const crmCampaignId = randomUUID();
    let replyToAddress: string | null = null;
    let fromEmail = dto.fromEmail;
    const headers: Record<string, string>[] = [{ 'X-CRM-Campaign-Id': crmCampaignId }];

    if (dto.useMailboxReplyTo) {
      const mailboxFrom = await this.getMailboxFromAddress();
      if (!mailboxFrom) {
        throw new BadRequestException(
          'No firm mailbox configured — set up Mail or disable Reply-To.',
        );
      }
      replyToAddress = mailboxFrom;
      if (!fromEmail) fromEmail = mailboxFrom;
      headers.push({ 'Reply-To': mailboxFrom });
    }

    try {
      let created = await createListmonkCampaign(config, {
        name: dto.name,
        subject: dto.subject,
        lists: dto.lists,
        fromEmail,
        type: dto.type,
        contentType: dto.contentType,
        body: dto.body,
        templateId: dto.templateId,
        sendAt: dto.sendAt,
        headers,
      });

      if (dto.sendImmediately) {
        created = await updateCampaignStatus(config, created.id, 'running');
      } else if (dto.sendAt) {
        created = await updateCampaignStatus(config, created.id, 'scheduled');
      }

      await this.db.insert(lmCampaigns).values({
        id: crmCampaignId,
        listmonkCampaignId: created.id,
        name: created.name,
        subject: created.subject,
        status: created.status,
        fromEmail: created.fromEmail || fromEmail || null,
        replyToAddress,
        sentCount: created.sent,
        viewsCount: created.views,
        clicksCount: created.clicks,
        repliesCount: 0,
        listIds: JSON.stringify(dto.lists),
        sendAt: created.sendAt ? new Date(created.sendAt) : null,
        startedAt: created.startedAt ? new Date(created.startedAt) : null,
      } as any);

      return {
        ...created,
        replyToAddress,
        repliesCount: 0,
      };
    } catch (err) {
      if (err instanceof BadRequestException) throw err;
      throw toAppException(err, (m) => this.logger.error(m));
    }
  }

  /**
   * Update draft / scheduled / paused campaigns.
   * Listmonk only accepts content edits in draft — scheduled/paused are moved to
   * draft first, then re-scheduled or started per dto flags.
   */
  async updateCampaign(id: number, dto: CreateCampaignDto): Promise<CampaignListItem> {
    const config = await this.getPluginConfig();
    try {
      const existing = await fetchCampaign(config, id);
      if (!['draft', 'scheduled', 'paused'].includes(existing.status)) {
        throw new BadRequestException(
          `Campaign in status "${existing.status}" cannot be edited — pause or cancel it first.`,
        );
      }

      if (existing.status === 'scheduled' || existing.status === 'paused') {
        await updateCampaignStatus(config, id, 'draft');
      }

      const local = await this.localByListmonkId(id);
      const crmCampaignId = local?.id ?? randomUUID();
      let replyToAddress: string | null = local?.replyToAddress ?? null;
      let fromEmail = dto.fromEmail;
      const headers: Record<string, string>[] = [{ 'X-CRM-Campaign-Id': crmCampaignId }];

      if (dto.useMailboxReplyTo) {
        const mailboxFrom = await this.getMailboxFromAddress();
        if (!mailboxFrom) {
          throw new BadRequestException(
            'No firm mailbox configured — set up Mail or disable Reply-To.',
          );
        }
        replyToAddress = mailboxFrom;
        if (!fromEmail) fromEmail = mailboxFrom;
        headers.push({ 'Reply-To': mailboxFrom });
      } else {
        replyToAddress = null;
      }

      let updated = await updateListmonkCampaign(config, id, {
        name: dto.name,
        subject: dto.subject,
        lists: dto.lists,
        fromEmail,
        type: dto.type,
        contentType: dto.contentType,
        body: dto.body,
        templateId: dto.templateId,
        sendAt: dto.sendAt,
        headers,
      });

      if (dto.sendImmediately) {
        updated = await updateCampaignStatus(config, id, 'running');
      } else if (dto.sendAt) {
        updated = await updateCampaignStatus(config, id, 'scheduled');
      }

      if (local) {
        await this.db
          .update(lmCampaigns)
          .set({
            name: updated.name,
            subject: updated.subject,
            status: updated.status,
            fromEmail: updated.fromEmail || fromEmail || null,
            replyToAddress,
            listIds: JSON.stringify(dto.lists),
            sendAt: updated.sendAt ? new Date(updated.sendAt) : null,
            startedAt: updated.startedAt ? new Date(updated.startedAt) : null,
            updatedAt: new Date(),
          } as any)
          .where(eq(lmCampaigns.listmonkCampaignId, id));
      } else {
        await this.db.insert(lmCampaigns).values({
          id: crmCampaignId,
          listmonkCampaignId: updated.id,
          name: updated.name,
          subject: updated.subject,
          status: updated.status,
          fromEmail: updated.fromEmail || fromEmail || null,
          replyToAddress,
          listIds: JSON.stringify(dto.lists),
          sendAt: updated.sendAt ? new Date(updated.sendAt) : null,
          startedAt: updated.startedAt ? new Date(updated.startedAt) : null,
        } as any);
      }

      const refreshed = await this.localByListmonkId(id);
      return {
        ...updated,
        replyToAddress: refreshed?.replyToAddress ?? replyToAddress,
        repliesCount: refreshed?.repliesCount ?? 0,
      };
    } catch (err) {
      if (err instanceof BadRequestException) throw err;
      throw toAppException(err, (m) => this.logger.error(m));
    }
  }

  async updateStatus(
    id: number,
    status: 'draft' | 'scheduled' | 'running' | 'paused' | 'cancelled',
  ): Promise<CampaignListItem> {
    const config = await this.getPluginConfig();
    try {
      const updated = await updateCampaignStatus(config, id, status);
      await this.db
        .update(lmCampaigns)
        .set({
          status: updated.status,
          startedAt: updated.startedAt ? new Date(updated.startedAt) : null,
          updatedAt: new Date(),
        } as any)
        .where(eq(lmCampaigns.listmonkCampaignId, id));
      const local = await this.localByListmonkId(id);
      return {
        ...updated,
        replyToAddress: local?.replyToAddress ?? null,
        repliesCount: local?.repliesCount ?? 0,
      };
    } catch (err) {
      throw toAppException(err, (m) => this.logger.error(m));
    }
  }

  async deleteCampaign(id: number): Promise<void> {
    const config = await this.getPluginConfig();
    try {
      await deleteListmonkCampaign(config, id);
      await this.db.delete(lmCampaigns).where(eq(lmCampaigns.listmonkCampaignId, id));
    } catch (err) {
      throw toAppException(err, (m) => this.logger.error(m));
    }
  }

  async getCampaignStats(
    id: number,
    type: 'views' | 'clicks' | 'bounces' | 'links',
    from: string,
    to: string,
  ) {
    const config = await this.getPluginConfig();
    try {
      const items = await fetchCampaignAnalytics(config, id, type, from, to);
      const local = await this.localByListmonkId(id);
      return {
        items,
        repliesCount: local?.repliesCount ?? 0,
      };
    } catch (err) {
      throw toAppException(err, (m) => this.logger.error(m));
    }
  }

  async syncStats(id: number): Promise<CampaignListItem> {
    const config = await this.getPluginConfig();
    try {
      const camp = await fetchCampaign(config, id);
      await this.db
        .update(lmCampaigns)
        .set({
          status: camp.status,
          sentCount: camp.sent,
          viewsCount: camp.views,
          clicksCount: camp.clicks,
          statsLastSyncAt: new Date(),
          updatedAt: new Date(),
        } as any)
        .where(eq(lmCampaigns.listmonkCampaignId, id));
      const local = await this.localByListmonkId(id);
      return {
        ...camp,
        replyToAddress: local?.replyToAddress ?? null,
        repliesCount: local?.repliesCount ?? 0,
      };
    } catch (err) {
      throw toAppException(err, (m) => this.logger.error(m));
    }
  }

  async getTemplates() {
    const config = await this.getPluginConfig();
    try {
      return await fetchTemplates(config);
    } catch (err) {
      throw toAppException(err, (m) => this.logger.error(m));
    }
  }

  async previewCampaign(input: {
    templateId: number;
    contentType: 'richtext' | 'html' | 'markdown' | 'plain';
    body: string;
    campaignId?: number;
  }): Promise<{ html: string; source: 'listmonk' | 'local' }> {
    if (!input.templateId) {
      throw AppException.badRequest('templateId is required for preview');
    }
    const config = await this.getPluginConfig();
    try {
      return await previewCampaignEmail(config, input);
    } catch (err) {
      throw toAppException(err, (m) => this.logger.error(m));
    }
  }
}
