import { Injectable, Inject, Logger } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import {
  PLUGIN_REGISTRY,
  type PluginRegistryLike,
  DB_TOKEN,
  Db,
  AppException,
} from '../../../packages/plugin-host/src';
import { fetchRemoteLists } from './listmonk-client';
import { ListmonkNotConfiguredError, ListmonkUpstreamError } from './listmonk-errors';
import { lmListForms } from './listmonk-campaigns.schema';

const PLUGIN_NAME = 'crm_listmonk';

export type ListWithForm = {
  id: number;
  name: string;
  type: string;
  status: string;
  subscriberCount: number;
  formId: string | null;
  formName: string | null;
};

@Injectable()
export class ListmonkListsService {
  private readonly logger = new Logger(ListmonkListsService.name);

  constructor(
    @Inject(PLUGIN_REGISTRY) private registry: PluginRegistryLike,
    @Inject(DB_TOKEN) private db: Db,
  ) {}

  private async getPluginConfig(): Promise<Record<string, string>> {
    const plugin = await this.registry.findByName(PLUGIN_NAME);
    if (!plugin?.enabled) {
      throw AppException.pluginDisabled('listmonk');
    }
    return plugin.config ?? {};
  }

  async getFormOptions(): Promise<{ id: string; name: string }[]> {
    await this.getPluginConfig();
    const rows = await this.db.execute(sql`select id, name from forms order by name`);
    const list = Array.isArray(rows) ? rows : ((rows as { rows?: unknown[] }).rows ?? []);
    return list.map((r) => {
      const row = r as { id: string; name: string };
      return { id: String(row.id), name: String(row.name) };
    });
  }

  async getLists(): Promise<ListWithForm[]> {
    const config = await this.getPluginConfig();
    try {
      const remote = await fetchRemoteLists(config);
      const mappings = await this.db.select().from(lmListForms);
      const formNameById = new Map<string, string>();
      const forms = await this.getFormOptions();
      for (const f of forms) formNameById.set(f.id, f.name);

      const mapByList = new Map<number, string>();
      for (const m of mappings) {
        mapByList.set(m.listmonkListId, m.formId);
      }

      return remote.map((list) => {
        const formId = mapByList.get(list.id) ?? null;
        return {
          ...list,
          formId,
          formName: formId ? (formNameById.get(formId) ?? null) : null,
        };
      });
    } catch (err) {
      if (err instanceof ListmonkNotConfiguredError) {
        throw AppException.pluginNotConfigured('listmonk', err.message);
      }
      if (err instanceof ListmonkUpstreamError) {
        this.logger.error(`Listmonk ${err.status}: ${err.detail}`);
        throw AppException.upstreamFailed('listmonk');
      }
      // AppException from getPluginConfig / badRequest etc.
      if (err && typeof err === 'object' && 'getStatus' in err) {
        throw err;
      }
      this.logger.error(err instanceof Error ? err.message : 'Unknown Listmonk failure');
      throw AppException.upstreamFailed('listmonk');
    }
  }

  async setListForm(
    listmonkListId: number,
    formId: string | null,
  ): Promise<{ listmonkListId: number; formId: string | null }> {
    await this.getPluginConfig();

    if (formId == null || formId === '') {
      await this.db.delete(lmListForms).where(eq(lmListForms.listmonkListId, listmonkListId));
      return { listmonkListId, formId: null };
    }

    const forms = await this.getFormOptions();
    if (!forms.some((f) => f.id === formId)) {
      throw AppException.badRequest('Form not found');
    }

    const existing = await this.db
      .select()
      .from(lmListForms)
      .where(eq(lmListForms.listmonkListId, listmonkListId))
      .limit(1);

    if (existing[0]) {
      await this.db
        .update(lmListForms)
        .set({ formId, updatedAt: new Date() } as any)
        .where(eq(lmListForms.listmonkListId, listmonkListId));
    } else {
      await this.db.insert(lmListForms).values({
        listmonkListId,
        formId,
      } as any);
    }

    return { listmonkListId, formId };
  }
}
