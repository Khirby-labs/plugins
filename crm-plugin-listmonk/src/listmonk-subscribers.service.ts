import { Injectable, Inject, Logger, ConflictException } from '@nestjs/common';
import {
  PLUGIN_REGISTRY,
  CONTACTS_SERVICE,
  type PluginRegistryLike,
} from '../../../packages/plugin-host/src';
import { AppException } from '../../../packages/plugin-host/src';
import { toAppException } from './listmonk-errors';
import {
  parseConfig,
  lookupSubscribersByEmails,
  fetchAllSubscribers,
  type ListmonkSubscriber,
} from './listmonk-client';

const PLUGIN_NAME = 'crm_listmonk';

export interface ListmonkSubscriberDto {
  subscriberId: number;
  status: string;
  lists: { id: number; name: string; subscriptionStatus: string }[];
}

@Injectable()
export class ListmonkSubscribersService {
  private readonly logger = new Logger(ListmonkSubscribersService.name);

  constructor(
    @Inject(PLUGIN_REGISTRY) private registry: PluginRegistryLike,
    @Inject(CONTACTS_SERVICE) private contacts: any,
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

  private toDto(sub: ListmonkSubscriber): ListmonkSubscriberDto {
    return {
      subscriberId: sub.id,
      status: sub.status,
      lists: sub.lists,
    };
  }

  async lookupByEmails(emails: string[]): Promise<Record<string, ListmonkSubscriberDto>> {
    const config = await this.getPluginConfig();
    try {
      const map = await lookupSubscribersByEmails(config, emails);
      const out: Record<string, ListmonkSubscriberDto> = {};
      for (const [email, sub] of map) {
        out[email] = this.toDto(sub);
      }
      return out;
    } catch (err) {
      // Branch on the error TYPE, never on English text in its message.
      throw toAppException(err, (m) => this.logger.error(m));
    }
  }

  async syncToContacts(): Promise<{ imported: number; updated: number; total: number }> {
    const config = await this.getPluginConfig();
    let subscribers: ListmonkSubscriber[];
    try {
      subscribers = await fetchAllSubscribers(config);
    } catch (err) {
      throw toAppException(err, (m) => this.logger.error(m));
    }

    let imported = 0;
    let updated = 0;

    for (const sub of subscribers) {
      const listmonkMeta = {
        subscriberId: sub.id,
        status: sub.status,
        lists: sub.lists.map((l) => l.name),
        syncedAt: new Date().toISOString(),
      };

      try {
        await this.contacts.create({
          email: sub.email,
          name: sub.name || undefined,
          metadata: { listmonk: listmonkMeta },
        });
        imported++;
      } catch (err) {
        if (!(err instanceof ConflictException)) throw err;

        const existing = await this.contacts.upsertByEmail(sub.email, { name: sub.name });
        const metadata = {
          ...((existing.metadata as Record<string, unknown>) ?? {}),
          listmonk: listmonkMeta,
        };
        await this.contacts.update(existing.id, {
          name: sub.name || existing.name || undefined,
          metadata,
        });
        updated++;
      }
    }

    return { imported, updated, total: subscribers.length };
  }
}
