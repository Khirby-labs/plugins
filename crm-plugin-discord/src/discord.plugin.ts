import {
  CrmPlugin,
  CrmEvent,
  PluginContext,
  PluginConfigField,
  PluginConfigPlaceholder,
} from '@khirby/plugin-sdk';
import { isDiscordWebhookUrl, postDiscordMessage } from './discord-client';
import { renderTemplate } from './template';

export type DiscordEventType =
  'contact.created' | 'form.submitted' | 'lead.created' | 'lead.moved' | 'lead.deleted';

const TEMPLATE_KEYS: Record<DiscordEventType, string> = {
  'contact.created': 'DISCORD_TEMPLATE_CONTACT_CREATED',
  'form.submitted': 'DISCORD_TEMPLATE_FORM_SUBMITTED',
  'lead.created': 'DISCORD_TEMPLATE_LEAD_CREATED',
  'lead.moved': 'DISCORD_TEMPLATE_LEAD_MOVED',
  'lead.deleted': 'DISCORD_TEMPLATE_LEAD_DELETED',
};

/** Canonical placeholder tokens per event — legend + render stay in sync. */
export const EVENT_PLACEHOLDERS: Record<DiscordEventType, PluginConfigPlaceholder[]> = {
  'contact.created': [
    { token: 'email', label: 'Contact email', labelKey: 'plugins.discord.placeholders.email' },
    { token: 'name', label: 'Contact name', labelKey: 'plugins.discord.placeholders.name' },
    { token: 'id', label: 'Contact ID', labelKey: 'plugins.discord.placeholders.id' },
  ],
  'form.submitted': [
    {
      token: 'formName',
      label: 'Form name',
      labelKey: 'plugins.discord.placeholders.formName',
    },
    {
      token: 'formSlug',
      label: 'Form slug',
      labelKey: 'plugins.discord.placeholders.formSlug',
    },
    {
      token: 'contactEmail',
      label: 'Contact email',
      labelKey: 'plugins.discord.placeholders.contactEmail',
    },
    {
      token: 'contactId',
      label: 'Contact ID',
      labelKey: 'plugins.discord.placeholders.contactId',
    },
    {
      token: 'submissionId',
      label: 'Submission ID',
      labelKey: 'plugins.discord.placeholders.submissionId',
    },
  ],
  'lead.created': [
    { token: 'title', label: 'Lead title', labelKey: 'plugins.discord.placeholders.title' },
    { token: 'email', label: 'Contact email', labelKey: 'plugins.discord.placeholders.email' },
    { token: 'name', label: 'Contact name', labelKey: 'plugins.discord.placeholders.name' },
    {
      token: 'stageName',
      label: 'Pipeline stage',
      labelKey: 'plugins.discord.placeholders.stageName',
    },
    { token: 'value', label: 'Lead value', labelKey: 'plugins.discord.placeholders.value' },
    {
      token: 'priority',
      label: 'Priority',
      labelKey: 'plugins.discord.placeholders.priority',
    },
    {
      token: 'formName',
      label: 'Source form name',
      labelKey: 'plugins.discord.placeholders.formName',
    },
  ],
  'lead.moved': [
    { token: 'title', label: 'Lead title', labelKey: 'plugins.discord.placeholders.title' },
    { token: 'email', label: 'Contact email', labelKey: 'plugins.discord.placeholders.email' },
    { token: 'name', label: 'Contact name', labelKey: 'plugins.discord.placeholders.name' },
    {
      token: 'oldStageName',
      label: 'Previous stage',
      labelKey: 'plugins.discord.placeholders.oldStageName',
    },
    {
      token: 'newStageName',
      label: 'New stage',
      labelKey: 'plugins.discord.placeholders.newStageName',
    },
  ],
  'lead.deleted': [
    { token: 'title', label: 'Lead title', labelKey: 'plugins.discord.placeholders.title' },
    { token: 'email', label: 'Contact email', labelKey: 'plugins.discord.placeholders.email' },
    {
      token: 'stageName',
      label: 'Pipeline stage',
      labelKey: 'plugins.discord.placeholders.stageName',
    },
  ],
};

const DEFAULT_TEMPLATES: Record<DiscordEventType, string> = {
  'contact.created': '**New contact:** {{name}}\n{{email}}',
  'form.submitted': '**Form submitted:** {{formName}}\n{{contactEmail}}',
  'lead.created': '**New lead:** {{title}}\n{{email}} · {{stageName}}',
  'lead.moved': '**Lead moved:** {{title}}\n{{oldStageName}} → {{newStageName}}',
  'lead.deleted': '**Lead deleted:** {{title}}\n{{email}} · {{stageName}}',
};

function parseEvents(raw: string | undefined): Set<DiscordEventType> {
  if (!raw?.trim()) {
    return new Set([
      'contact.created',
      'form.submitted',
      'lead.created',
      'lead.moved',
      'lead.deleted',
    ]);
  }
  const allowed = new Set(Object.keys(TEMPLATE_KEYS) as DiscordEventType[]);
  return new Set(
    raw
      .split(',')
      .map((s) => s.trim())
      .filter((s): s is DiscordEventType => allowed.has(s as DiscordEventType)),
  );
}

function flattenPayload(event: CrmEvent): Record<string, unknown> {
  const payload = event.payload as Record<string, unknown>;
  const flat: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(payload)) {
    if (value instanceof Date) {
      flat[key] = value.toISOString();
    } else if (value !== null && typeof value === 'object') {
      // Skip nested objects (e.g. form data / metadata) — templates use top-level tokens only.
      continue;
    } else {
      flat[key] = value;
    }
  }
  return flat;
}

function templateField(
  event: DiscordEventType,
  label: string,
  labelKey: string,
): PluginConfigField {
  return {
    key: TEMPLATE_KEYS[event],
    label,
    labelKey,
    type: 'textarea',
    placeholder: DEFAULT_TEMPLATES[event],
    description: 'Leave empty to use the default template',
    descriptionKey: 'plugins.discord.config.template.description',
    placeholders: EVENT_PLACEHOLDERS[event],
  };
}

export class DiscordPlugin implements CrmPlugin {
  name = 'crm_discord';
  displayName = 'Discord';
  displayNameKey = 'plugins.discord.displayName';
  description = 'Sends personalized Discord messages on selected CRM events';
  descriptionKey = 'plugins.discord.description';
  version = '1.0.0';

  getConfigSchema(): PluginConfigField[] {
    return [
      {
        key: 'DISCORD_WEBHOOK_URL',
        label: 'Webhook URL',
        labelKey: 'plugins.discord.config.url.label',
        type: 'url',
        placeholder: 'https://discord.com/api/webhooks/…',
        required: true,
        description: 'Incoming webhook URL from your Discord channel settings',
        descriptionKey: 'plugins.discord.config.url.description',
      },
      {
        key: 'DISCORD_USERNAME',
        label: 'Bot display name',
        labelKey: 'plugins.discord.config.username.label',
        type: 'text',
        placeholder: 'Bearly CRM',
        description: 'Optional — overrides the webhook default name for each message',
        descriptionKey: 'plugins.discord.config.username.description',
      },
      {
        key: 'DISCORD_EVENTS',
        label: 'Notify on',
        labelKey: 'plugins.discord.config.events.label',
        type: 'multiselect',
        description: 'Which CRM events post a message to Discord',
        descriptionKey: 'plugins.discord.config.events.description',
        options: [
          {
            value: 'contact.created',
            label: 'New contact',
            labelKey: 'plugins.discord.config.events.options.contactCreated',
          },
          {
            value: 'form.submitted',
            label: 'Form submitted',
            labelKey: 'plugins.discord.config.events.options.formSubmitted',
          },
          {
            value: 'lead.created',
            label: 'New lead',
            labelKey: 'plugins.discord.config.events.options.leadCreated',
          },
          {
            value: 'lead.moved',
            label: 'Lead moved',
            labelKey: 'plugins.discord.config.events.options.leadMoved',
          },
          {
            value: 'lead.deleted',
            label: 'Lead deleted',
            labelKey: 'plugins.discord.config.events.options.leadDeleted',
          },
        ],
      },
      templateField(
        'contact.created',
        'Template — new contact',
        'plugins.discord.config.template.contactCreated',
      ),
      templateField(
        'form.submitted',
        'Template — form submitted',
        'plugins.discord.config.template.formSubmitted',
      ),
      templateField(
        'lead.created',
        'Template — new lead',
        'plugins.discord.config.template.leadCreated',
      ),
      templateField(
        'lead.moved',
        'Template — lead moved',
        'plugins.discord.config.template.leadMoved',
      ),
      templateField(
        'lead.deleted',
        'Template — lead deleted',
        'plugins.discord.config.template.leadDeleted',
      ),
    ];
  }

  async onInit(ctx: PluginContext): Promise<void> {
    const url = ctx.config['DISCORD_WEBHOOK_URL'];
    if (!url) {
      ctx.log('DiscordPlugin: DISCORD_WEBHOOK_URL not set — plugin will be a no-op');
    } else if (!isDiscordWebhookUrl(url)) {
      ctx.log(`DiscordPlugin: DISCORD_WEBHOOK_URL invalid or blocked — ${url}`);
    } else {
      ctx.log('DiscordPlugin: initialized');
    }
  }

  async onEvent(event: CrmEvent, ctx: PluginContext): Promise<void> {
    const type = event.type as DiscordEventType;
    if (!(type in TEMPLATE_KEYS)) return;

    const enabled = parseEvents(ctx.config['DISCORD_EVENTS']);
    if (!enabled.has(type)) return;

    const url = ctx.config['DISCORD_WEBHOOK_URL'];
    if (!url) return;
    if (!isDiscordWebhookUrl(url)) {
      ctx.log(`DiscordPlugin: blocked disallowed URL ${url}`);
      return;
    }

    const templateKey = TEMPLATE_KEYS[type];
    const template = ctx.config[templateKey]?.trim() || DEFAULT_TEMPLATES[type];
    const content = renderTemplate(template, flattenPayload(event));
    if (!content.trim()) {
      ctx.log(`DiscordPlugin: empty content for ${type} — skipping`);
      return;
    }

    await postDiscordMessage(url, content, ctx.config['DISCORD_USERNAME'], ctx.log);
  }
}
