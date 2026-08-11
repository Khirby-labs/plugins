import { DiscordPlugin } from './discord.plugin';
import { isDiscordWebhookUrl } from './discord-client';
import { CrmEvent, PluginContext } from '@khirby/plugin-sdk';

function makeCtx(overrides: Record<string, string | undefined> = {}): PluginContext {
  return {
    log: jest.fn(),
    config: {
      DISCORD_WEBHOOK_URL: 'https://discord.com/api/webhooks/123456789012345678/abcdefghijklmnop',
      DISCORD_EVENTS: 'contact.created,lead.created',
      ...overrides,
    },
  };
}

function makeContactEvent(): CrmEvent {
  return {
    type: 'contact.created',
    payload: {
      id: 'c-1',
      email: 'jan@example.com',
      name: 'Jan',
      createdAt: new Date(),
    },
  };
}

function makeLeadEvent(): CrmEvent {
  return {
    type: 'lead.created',
    payload: {
      id: 'l-1',
      title: 'Jan',
      email: 'jan@example.com',
      name: 'Jan',
      stageId: 's1',
      stageName: 'New',
      value: null,
      priority: 'medium',
      formName: null,
      contactId: 'c-1',
      createdAt: new Date(),
    },
  };
}

function mockFetch(ok: boolean, status = 204) {
  return jest.spyOn(global, 'fetch').mockResolvedValue({
    ok,
    status,
    text: async () => '',
  } as Response);
}

describe('isDiscordWebhookUrl', () => {
  it('accepts discord.com webhook paths', () => {
    expect(
      isDiscordWebhookUrl('https://discord.com/api/webhooks/123456789012345678/token-here'),
    ).toBe(true);
  });

  it('rejects non-discord hosts', () => {
    expect(isDiscordWebhookUrl('https://evil.example/api/webhooks/1/token')).toBe(false);
  });

  it('rejects private hosts', () => {
    expect(isDiscordWebhookUrl('https://127.0.0.1/api/webhooks/1/token')).toBe(false);
  });
});

describe('DiscordPlugin', () => {
  let plugin: DiscordPlugin;

  beforeEach(() => {
    plugin = new DiscordPlugin();
    jest.restoreAllMocks();
  });

  it('exposes config schema with per-event placeholders', () => {
    const schema = plugin.getConfigSchema();
    const leadTpl = schema.find((f) => f.key === 'DISCORD_TEMPLATE_LEAD_CREATED');
    expect(leadTpl?.type).toBe('textarea');
    expect(leadTpl?.placeholders?.map((p) => p.token)).toEqual(
      expect.arrayContaining(['title', 'email', 'stageName']),
    );
  });

  it('no-ops when URL is missing', async () => {
    const fetchSpy = mockFetch(true);
    await plugin.onEvent(makeContactEvent(), makeCtx({ DISCORD_WEBHOOK_URL: undefined }));
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('skips events not in DISCORD_EVENTS', async () => {
    const fetchSpy = mockFetch(true);
    await plugin.onEvent(makeLeadEvent(), makeCtx({ DISCORD_EVENTS: 'contact.created' }));
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('posts rendered content on contact.created', async () => {
    const fetchSpy = mockFetch(true);
    await plugin.onEvent(makeContactEvent(), makeCtx());

    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining('discord.com/api/webhooks'),
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          content: '**New contact:** Jan\njan@example.com',
        }),
      }),
    );
  });

  it('uses custom template and username', async () => {
    const fetchSpy = mockFetch(true);
    await plugin.onEvent(
      makeContactEvent(),
      makeCtx({
        DISCORD_TEMPLATE_CONTACT_CREATED: 'Hello {{name}}',
        DISCORD_USERNAME: 'CRM Bot',
      }),
    );

    expect(fetchSpy).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        body: JSON.stringify({
          content: 'Hello Jan',
          username: 'CRM Bot',
        }),
      }),
    );
  });

  it('logs and does not throw on HTTP error', async () => {
    mockFetch(false, 400);
    const ctx = makeCtx();
    await expect(plugin.onEvent(makeContactEvent(), ctx)).resolves.toBeUndefined();
    expect(ctx.log).toHaveBeenCalledWith(expect.stringContaining('400'));
  });

  it('blocks non-discord URL', async () => {
    const fetchSpy = mockFetch(true);
    const ctx = makeCtx({ DISCORD_WEBHOOK_URL: 'https://example.com/hook' });
    await plugin.onEvent(makeContactEvent(), ctx);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(ctx.log).toHaveBeenCalledWith(expect.stringContaining('blocked'));
  });
});
