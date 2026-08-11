import { CrmPlugin, CrmEvent, PluginContext, PluginConfigField } from '@khirby/plugin-sdk';

function isAllowedUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    if (!['http:', 'https:'].includes(u.protocol)) return false;
    const h = u.hostname;
    if (/^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.)/.test(h))
      return false;
    return true;
  } catch {
    return false;
  }
}

export class WebhookPlugin implements CrmPlugin {
  name = 'crm_webhook';
  displayName = 'Webhook';
  displayNameKey = 'plugins.webhook.displayName';
  description = 'Sends CRM events as JSON POSTs to a configured URL';
  descriptionKey = 'plugins.webhook.description';
  version = '1.0.0';

  /**
   * Stable `*Key` next to every English literal (ADR-0011): the SPA resolves the
   * key and falls back to the literal, so the backend ships no message catalog.
   */
  getConfigSchema(): PluginConfigField[] {
    return [
      {
        key: 'WEBHOOK_URL',
        label: 'Endpoint URL',
        labelKey: 'plugins.webhook.config.url.label',
        type: 'url',
        placeholder: 'https://hooks.example.com/crm',
        required: true,
        description: 'CRM events are sent as JSON POST requests to this URL',
        descriptionKey: 'plugins.webhook.config.url.description',
      },
      {
        key: 'WEBHOOK_SECRET',
        label: 'Secret header',
        labelKey: 'plugins.webhook.config.secret.label',
        type: 'password',
        description: 'Optional — sent as X-Webhook-Secret if set',
        descriptionKey: 'plugins.webhook.config.secret.description',
      },
    ];
  }

  async onInit(ctx: PluginContext): Promise<void> {
    const url = ctx.config['WEBHOOK_URL'];
    if (!url) {
      ctx.log('WebhookPlugin: WEBHOOK_URL not set — plugin will be a no-op');
    } else if (!isAllowedUrl(url)) {
      ctx.log(`WebhookPlugin: WEBHOOK_URL blocked (private/invalid) — ${url}`);
    } else {
      ctx.log(`WebhookPlugin: initialized, posting to ${url}`);
    }
  }

  async onEvent(event: CrmEvent, ctx: PluginContext): Promise<void> {
    const url = ctx.config['WEBHOOK_URL'];
    if (!url) return;
    if (!isAllowedUrl(url)) {
      ctx.log(`WebhookPlugin: blocked disallowed URL ${url}`);
      return;
    }

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(ctx.config['WEBHOOK_SECRET']
            ? { 'X-Webhook-Secret': ctx.config['WEBHOOK_SECRET'] }
            : {}),
        },
        body: JSON.stringify({
          event: event.type,
          payload: event.payload,
          timestamp: new Date().toISOString(),
        }),
      });

      if (!res.ok) {
        ctx.log(`WebhookPlugin: POST ${url} returned ${res.status}`);
      }
    } catch (err) {
      ctx.log(`WebhookPlugin: fetch error — ${(err as Error).message}`);
    }
  }
}
