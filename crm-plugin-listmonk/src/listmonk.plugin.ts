import {
  CrmPlugin,
  CrmEvent,
  PluginContext,
  FormSubmittedEvent,
  ContactCreatedEvent,
  EmailReceivedEvent,
  PluginFrontendRoute,
  PluginConfigField,
  PluginSqlClient,
} from '@khirby/plugin-sdk';
import { ListmonkNestModule } from './listmonk-nest.module';
import { isAllowedUrl, parseConfig, type ListmonkConfig } from './listmonk-client';
import { LISTMONK_CAMPAIGNS_MIGRATIONS_SQL } from './migrations';

async function addSubscriber(
  cfg: ListmonkConfig,
  email: string,
  name: string,
  ctx: PluginContext,
  listIds?: number[],
): Promise<void> {
  try {
    if (!isAllowedUrl(cfg.url)) {
      ctx.log(`ListmonkPlugin: blocked disallowed URL ${cfg.url}`);
      return;
    }
    const lists = listIds?.length ? listIds : cfg.listIds;
    const res = await fetch(`${cfg.url}/api/subscribers`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: cfg.authHeader,
      },
      body: JSON.stringify({
        email,
        name: name || email,
        status: 'enabled',
        lists,
      }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      ctx.log(`listmonk addSubscriber failed [${res.status}]: ${text}`);
    }
  } catch (err) {
    ctx.log(`listmonk addSubscriber error: ${(err as Error).message}`);
  }
}

/** Strip Re:/Odp:/Aw: prefixes for campaign subject matching. */
export function normalizeReplySubject(subject: string): string {
  let s = subject.trim();
  for (;;) {
    const next = s.replace(/^(re|odp|aw|fw|fwd)\s*:\s*/i, '').trim();
    if (next === s) break;
    s = next;
  }
  return s.toLowerCase();
}

// ─── Plugin ───────────────────────────────────────────────────────────────────

export class ListmonkPlugin implements CrmPlugin {
  name = 'crm_listmonk';
  displayName = 'Listmonk Newsletter';
  displayNameKey = 'plugins.listmonk.displayName';
  description = 'Subscribes contacts to listmonk lists on contact creation or form submission';
  descriptionKey = 'plugins.listmonk.description';
  version = '1.1.0';

  /** Raw postgres.js client retained for email.received reply attribution. */
  private sql: PluginSqlClient | null = null;

  getNestModule() {
    return ListmonkNestModule;
  }

  async onMigrate(sql: PluginSqlClient): Promise<void> {
    this.sql = sql;
    const statements = LISTMONK_CAMPAIGNS_MIGRATIONS_SQL.split(';')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    for (const statement of statements) {
      await sql.unsafe(statement);
    }
  }

  /**
   * Every user-facing string carries a stable `*Key` alongside the English
   * literal (ADR-0011). The SPA resolves the key and falls back to the literal,
   * so this plugin needs no message catalog of its own and stays readable even
   * in an SPA build that has never heard of it.
   */
  getConfigSchema(): PluginConfigField[] {
    return [
      {
        key: 'LISTMONK_URL',
        label: 'Server URL',
        labelKey: 'plugins.listmonk.config.url.label',
        type: 'url',
        placeholder: 'https://mail.example.com',
        required: true,
        description: 'Base URL of your Listmonk instance',
        descriptionKey: 'plugins.listmonk.config.url.description',
      },
      {
        key: 'LISTMONK_USER',
        label: 'Username',
        labelKey: 'plugins.listmonk.config.user.label',
        type: 'text',
        placeholder: 'admin',
        required: true,
      },
      {
        key: 'LISTMONK_PASSWORD',
        label: 'Password',
        labelKey: 'plugins.listmonk.config.password.label',
        type: 'password',
        required: true,
      },
      // List assignment is per-form in the Newsletter UI (ADR-0021). Subscribe-on
      // timing is not operator-configured — omit both from this schema.
    ];
  }

  getFrontendRoutes(): PluginFrontendRoute[] {
    return [
      {
        path: '/plugins/listmonk',
        name: 'plugin-listmonk',
        navLabel: 'Newsletter',
        navLabelKey: 'plugins.listmonk.nav',
        navIcon: '📨',
        component: () => Promise.resolve(null),
      },
    ];
  }

  onInit(ctx: PluginContext): void {
    const cfg = parseConfig(ctx.config);
    if (!cfg) {
      ctx.log(
        'ListmonkPlugin: not configured yet — set LISTMONK_URL, LISTMONK_USER and LISTMONK_PASSWORD in Plugins → Configure',
      );
    } else {
      ctx.log(`ListmonkPlugin: ready — lists=[${cfg.listIds}] subscribeOn=${cfg.subscribeOn}`);
    }
  }

  private async handleCampaignReply(event: EmailReceivedEvent, ctx: PluginContext): Promise<void> {
    if (!this.sql) return;
    // Decision C: only attribute replies when the sender is a CRM contact.
    if (!event.payload.contactId) return;

    const normalized = normalizeReplySubject(event.payload.subject);
    if (!normalized) return;

    try {
      const rows = await this.sql.unsafe(
        `select id, subject from lm_campaigns where lower(subject) = $1 limit 1`,
        [normalized],
      );
      const list = Array.isArray(rows) ? rows : [];
      const match = list[0] as { id?: string } | undefined;
      if (!match?.id) return;

      await this.sql.unsafe(
        `update lm_campaigns
         set replies_count = replies_count + 1, updated_at = now()
         where id = $1`,
        [match.id],
      );
      ctx.log(`ListmonkPlugin: attributed reply to campaign ${match.id}`);
    } catch (err) {
      ctx.log(`ListmonkPlugin: reply attribution failed: ${(err as Error).message}`);
    }
  }

  private async listIdsForForm(formId: string): Promise<number[] | null> {
    if (!this.sql) return null;
    try {
      const rows = await this.sql.unsafe(
        `select listmonk_list_id from lm_list_forms where form_id = $1`,
        [formId],
      );
      const list = Array.isArray(rows) ? rows : [];
      const ids = list
        .map((r) => Number((r as { listmonk_list_id?: number }).listmonk_list_id))
        .filter((n) => !Number.isNaN(n) && n > 0);
      return ids.length ? ids : null;
    } catch {
      return null;
    }
  }

  async onEvent(event: CrmEvent, ctx: PluginContext): Promise<void> {
    if (event.type === 'email.received') {
      await this.handleCampaignReply(event as EmailReceivedEvent, ctx);
      return;
    }

    const cfg = parseConfig(ctx.config);
    if (!cfg) return;

    if (event.type === 'contact.created') {
      if (cfg.subscribeOn === 'form.submitted') return;
      const { email, name } = (event as ContactCreatedEvent).payload;
      await addSubscriber(cfg, email, name ?? '', ctx);
      return;
    }

    if (event.type === 'form.submitted') {
      if (cfg.subscribeOn === 'contact.created') return;
      const { contactEmail, data, formId } = (event as FormSubmittedEvent).payload;
      const name = (data['name'] as string) ?? '';
      const mapped = await this.listIdsForForm(formId);
      await addSubscriber(cfg, contactEmail, name, ctx, mapped ?? undefined);
      return;
    }
  }
}
