import { encrypt, decrypt, isAiComposeSecretsKeyConfigured } from './ai-compose-crypto';
import { AiComposeSettingsService } from './ai-compose-settings.service';
import {
  AiComposeSuggestService,
  stripCodeFences,
  parsePokeloRoute,
} from './ai-compose-suggest.service';
import { AppException } from '../../../packages/plugin-host/src';

// ──────────────────────────────────────────────────────────────────────────────
// Crypto round-trip
// ──────────────────────────────────────────────────────────────────────────────

describe('ai-compose-crypto', () => {
  const HEX_KEY = 'a'.repeat(64);

  beforeEach(() => {
    process.env.AI_COMPOSE_SECRETS_KEY = HEX_KEY;
  });

  afterEach(() => {
    delete process.env.AI_COMPOSE_SECRETS_KEY;
  });

  it('encrypts and decrypts back to the same plaintext', () => {
    const plaintext = 'sk-super-secret-key';
    const cipher = encrypt(plaintext);
    expect(cipher).not.toEqual(plaintext);
    expect(decrypt(cipher)).toEqual(plaintext);
  });

  it('isAiComposeSecretsKeyConfigured returns false when key is unset', () => {
    delete process.env.AI_COMPOSE_SECRETS_KEY;
    expect(isAiComposeSecretsKeyConfigured()).toBe(false);
  });

  it('isAiComposeSecretsKeyConfigured returns true when key is correct', () => {
    process.env.AI_COMPOSE_SECRETS_KEY = HEX_KEY;
    expect(isAiComposeSecretsKeyConfigured()).toBe(true);
  });

  it('throws on missing key at encrypt time', () => {
    delete process.env.AI_COMPOSE_SECRETS_KEY;
    expect(() => encrypt('anything')).toThrow('AI_COMPOSE_SECRETS_KEY is not set');
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Settings service — allowlist / model resolution
// ──────────────────────────────────────────────────────────────────────────────

function makeSelectChain(returnValue: unknown[]) {
  // Drizzle chain: select().from().where?().limit() resolves to array
  const chain: Record<string, unknown> = {};
  const resolved = Promise.resolve(returnValue);
  // Add a then so the chain itself is awaitable (matches `const [x] = await chain`)
  (chain as any).then = resolved.then.bind(resolved);
  (chain as any).catch = resolved.catch.bind(resolved);
  chain.select = () => chain;
  chain.from = () => chain;
  chain.where = () => chain;
  chain.limit = () => chain;
  return chain;
}

function makeInsertChain() {
  const chain: Record<string, unknown> = {};
  const resolved = Promise.resolve([]);
  (chain as any).then = resolved.then.bind(resolved);
  (chain as any).catch = resolved.catch.bind(resolved);
  chain.values = () => chain;
  return chain;
}

function makeUpdateChain() {
  const chain: Record<string, unknown> = {};
  const resolved = Promise.resolve([]);
  (chain as any).then = resolved.then.bind(resolved);
  (chain as any).catch = resolved.catch.bind(resolved);
  chain.set = () => chain;
  chain.where = () => chain;
  return chain;
}

function makeMockDb(row?: unknown) {
  const rows = row !== undefined ? [row] : [];
  return {
    select: () => makeSelectChain(rows),
    insert: () => makeInsertChain(),
    update: () => makeUpdateChain(),
    delete: () => Promise.resolve([]),
  };
}

function makeMockRegistry(enabled = true) {
  return {
    findByName: jest.fn().mockResolvedValue({ name: 'crm_ai_compose', enabled, config: null }),
    isEnabled: jest.fn().mockReturnValue(enabled),
  };
}

describe('AiComposeSettingsService', () => {
  const HEX_KEY = 'b'.repeat(64);

  beforeEach(() => {
    process.env.AI_COMPOSE_SECRETS_KEY = HEX_KEY;
  });

  afterEach(() => {
    delete process.env.AI_COMPOSE_SECRETS_KEY;
  });

  it('getSettings returns apiKeyConfigured: false when no row', async () => {
    const db = makeMockDb(); // empty result
    const registry = makeMockRegistry(true);
    const service = new AiComposeSettingsService(db as any, registry as any);
    const settings = await service.getSettings();
    expect(settings.apiKeyConfigured).toBe(false);
    expect(settings.baseUrl).toBe('https://api.openai.com/v1');
  });

  it('getSettings returns apiKeyConfigured: true when row has apiKeyEnc', async () => {
    const enc = encrypt('sk-test');
    const db = makeMockDb({
      apiKeyEnc: enc,
      baseUrl: 'https://api.openai.com/v1',
      defaultModel: null,
      allowedModels: [],
      systemPrompt: null,
    });
    const registry = makeMockRegistry(true);
    const service = new AiComposeSettingsService(db as any, registry as any);
    const settings = await service.getSettings();
    expect(settings.apiKeyConfigured).toBe(true);
  });

  it('throws 503 when plugin is disabled', async () => {
    const db = makeMockDb();
    const registry = makeMockRegistry(false);
    const service = new AiComposeSettingsService(db as any, registry as any);
    await expect(service.getSettings()).rejects.toThrow();
  });

  it('updateSettings rejects http baseUrl (not localhost)', async () => {
    const db = makeMockDb();
    const registry = makeMockRegistry(true);
    const service = new AiComposeSettingsService(db as any, registry as any);
    await expect(service.updateSettings({ baseUrl: 'http://evil.example.com' })).rejects.toThrow();
  });

  it('allows http://localhost baseUrl', async () => {
    const db = makeMockDb();
    const registry = makeMockRegistry(true);
    const service = new AiComposeSettingsService(db as any, registry as any);
    await expect(service.updateSettings({ baseUrl: 'http://localhost' })).resolves.toBeDefined();
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Suggest service — prompt assembly + provider call
// ──────────────────────────────────────────────────────────────────────────────

function makeSettingsService(
  overrides: Partial<{
    apiKey: string;
    baseUrl: string;
    allowedModels: string[];
    defaultModel: string | null;
    systemPrompt: string | null;
  }> = {},
) {
  const cfg = {
    apiKey: 'sk-test',
    baseUrl: 'https://api.openai.com/v1',
    allowedModels: ['gpt-4o', 'gpt-3.5-turbo'],
    defaultModel: 'gpt-4o',
    systemPrompt: null,
    ...overrides,
  };

  return {
    getDecryptedApiKey: jest.fn().mockResolvedValue({ apiKey: cfg.apiKey, baseUrl: cfg.baseUrl }),
    getAllowedModels: jest.fn().mockResolvedValue(cfg.allowedModels),
    getDefaultModel: jest.fn().mockResolvedValue(cfg.defaultModel),
    getSystemPrompt: jest.fn().mockResolvedValue(cfg.systemPrompt),
    assertPluginEnabled: jest.fn().mockResolvedValue(undefined),
  };
}

const MOCK_THREAD = {
  id: 'thread-1',
  subject: 'Hello',
  contactId: 'c-1',
  leadId: 'l-1',
  contactEmail: 'client@example.com',
  contactName: 'Jane Doe',
  messages: [
    {
      id: 'm-1',
      direction: 'inbound' as const,
      bodyText: 'Hi, I need help with my order.',
      sentAt: '2024-01-01T10:00:00Z',
      receivedAt: null,
      fromAddress: 'client@example.com',
      toAddresses: ['support@company.com'],
    },
  ],
};

describe('AiComposeSuggestService', () => {
  const mockMailThreads = {
    getThread: jest.fn().mockResolvedValue(MOCK_THREAD),
  };

  const mockLeads = {
    findById: jest.fn().mockResolvedValue({
      id: 'l-1',
      title: 'Jane Doe lead',
      contactEmail: 'client@example.com',
      contactName: 'Jane Doe',
      formName: 'Contact form',
      value: '1000',
      priority: 'high',
      submission: {
        data: {
          name: 'Jane Doe',
          email: 'client@example.com',
          message: 'I need a full CRM rollout for my company.',
          _hp: 'bot',
        },
      },
    }),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch = jest.fn();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('returns a draft from the provider', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: 'Draft reply here.' } }],
      }),
    });

    const settings = makeSettingsService();
    const service = new AiComposeSuggestService(
      settings as any,
      mockMailThreads as any,
      mockLeads as any,
    );

    const result = await service.suggest({ threadId: 'thread-1', leadId: 'l-1' });
    expect(result.draft).toBe('Draft reply here.');
    expect(result.modelUsed).toBe('gpt-4o');
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/chat/completions'),
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('throws 400 when model not in allowlist', async () => {
    const settings = makeSettingsService({ allowedModels: ['gpt-4o'] });
    const service = new AiComposeSuggestService(
      settings as any,
      mockMailThreads as any,
      mockLeads as any,
    );

    await expect(service.suggest({ threadId: 'thread-1', model: 'claude-3' })).rejects.toThrow();
  });

  it('throws 400 when API key is not configured', async () => {
    const settings = {
      ...makeSettingsService(),
      getDecryptedApiKey: jest
        .fn()
        .mockRejectedValue(AppException.badRequest('AI Compose API key is not configured')),
    };
    const service = new AiComposeSuggestService(
      settings as any,
      mockMailThreads as any,
      mockLeads as any,
    );

    await expect(service.suggest({ threadId: 'thread-1' })).rejects.toThrow(
      'AI Compose API key is not configured',
    );
  });

  it('throws 400 when provider returns error', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => 'Unauthorized',
    });

    const settings = makeSettingsService();
    const service = new AiComposeSuggestService(
      settings as any,
      mockMailThreads as any,
      mockLeads as any,
    );

    await expect(service.suggest({ threadId: 'thread-1' })).rejects.toThrow();
  });

  it('uses instruction parameter when provided', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: 'With instruction.' } }] }),
    });

    const settings = makeSettingsService();
    const service = new AiComposeSuggestService(
      settings as any,
      mockMailThreads as any,
      mockLeads as any,
    );

    await service.suggest({ threadId: 'thread-1', instruction: 'Be formal' });

    const callArgs = (global.fetch as jest.Mock).mock.calls[0];
    const body = JSON.parse(callArgs[1].body);
    const systemMsg = body.messages.find((m: { role: string }) => m.role === 'system');
    expect(systemMsg.content).toContain('Be formal');
  });

  it('drafts a first outbound from lead context without a thread', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: 'Hello Jane, …' } }],
      }),
    });

    const settings = makeSettingsService();
    const service = new AiComposeSuggestService(
      settings as any,
      mockMailThreads as any,
      mockLeads as any,
    );

    const result = await service.suggest({ leadId: 'l-1' });
    expect(result.draft).toBe('Hello Jane, …');
    expect(mockMailThreads.getThread).not.toHaveBeenCalled();

    const callArgs = (global.fetch as jest.Mock).mock.calls[0];
    const body = JSON.parse(callArgs[1].body);
    const userMsg = body.messages.find((m: { role: string }) => m.role === 'user');
    expect(userMsg.content).toContain('Lead context:');
    expect(userMsg.content).toContain('Jane Doe');
    expect(userMsg.content).toContain('Form submission:');
    expect(userMsg.content).toContain('I need a full CRM rollout for my company.');
    expect(userMsg.content).not.toContain('bot');
    expect(userMsg.content).toContain('form submission');
  });

  it('throws 400 when neither threadId nor leadId is provided', async () => {
    const settings = makeSettingsService();
    const service = new AiComposeSuggestService(
      settings as any,
      mockMailThreads as any,
      mockLeads as any,
    );

    await expect(service.suggest({})).rejects.toThrow('Either threadId or leadId is required');
  });

  it('appends Pokelo snippets to the system message when context service is present', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: 'Draft' } }] }),
    });

    const pokelo = {
      fetchContext: jest.fn().mockResolvedValue('--- Kontekst z Pokelo ---\nPricing is X'),
      listBoundProjects: jest.fn().mockResolvedValue([{ id: 'p1', name: 'CRM' }]),
    };
    const settings = makeSettingsService();
    const service = new AiComposeSuggestService(
      settings as any,
      mockMailThreads as any,
      mockLeads as any,
      pokelo as any,
    );

    await service.suggest({ threadId: 'thread-1', leadId: 'l-1', instruction: 'Be brief' });

    expect(pokelo.fetchContext).toHaveBeenCalledWith(expect.any(String), {
      projectIds: ['p1'],
    });
    const body = JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body);
    const systemMsg = body.messages.find((m: { role: string }) => m.role === 'system');
    expect(systemMsg.content).toContain('Kontekst z Pokelo');
    expect(systemMsg.content).toContain('Pricing is X');
  });

  it('routes across multiple Pokelo projects then fetches follow-up', async () => {
    (global.fetch as jest.Mock).mockImplementation(async (_url: string, init: { body: string }) => {
      const body = JSON.parse(init.body);
      const system = body.messages?.[0]?.content ?? '';
      if (typeof system === 'string' && system.includes('route knowledge-base')) {
        // Router payload must match draft call (no max_tokens / no temperature:0)
        expect(body.max_tokens).toBeUndefined();
        expect(body.temperature).toBe(0.7);
        return {
          ok: true,
          json: async () => ({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    primary: ['crm'],
                    followUp: ['finsly'],
                  }),
                },
              },
            ],
          }),
        };
      }
      return {
        ok: true,
        json: async () => ({ choices: [{ message: { content: 'Draft' } }] }),
      };
    });

    const pokelo = {
      listBoundProjects: jest.fn().mockResolvedValue([
        { id: 'crm', name: 'Bearly CRM' },
        { id: 'finsly', name: 'Finsly' },
        { id: 'pokelo', name: 'Pokelo' },
      ]),
      fetchContext: jest
        .fn()
        .mockResolvedValueOnce('--- Kontekst z Pokelo ---\n[Bearly CRM] CRM facts')
        .mockResolvedValueOnce('--- Kontekst z Pokelo ---\n[Finsly] Billing facts'),
    };

    const service = new AiComposeSuggestService(
      makeSettingsService() as any,
      mockMailThreads as any,
      mockLeads as any,
      pokelo as any,
    );

    await service.suggest({ threadId: 'thread-1', instruction: 'Mention Finsly pricing' });

    expect(pokelo.fetchContext).toHaveBeenNthCalledWith(1, expect.any(String), {
      projectIds: ['crm'],
    });
    expect(pokelo.fetchContext).toHaveBeenNthCalledWith(2, expect.any(String), {
      projectIds: ['finsly'],
    });

    const composeCall = (global.fetch as jest.Mock).mock.calls.find((c) => {
      const body = JSON.parse(c[1].body);
      return !String(body.messages?.[0]?.content ?? '').includes('route knowledge-base');
    });
    const systemMsg = JSON.parse(composeCall[1].body).messages.find(
      (m: { role: string }) => m.role === 'system',
    );
    expect(systemMsg.content).toContain('CRM facts');
    expect(systemMsg.content).toContain('Billing facts');
  });

  it('searches both projects directly when exactly two are bound (no router)', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: 'Draft' } }] }),
    });

    const pokelo = {
      listBoundProjects: jest.fn().mockResolvedValue([
        { id: 'crm', name: 'Bearly CRM' },
        { id: 'finsly', name: 'Finsly' },
      ]),
      fetchContext: jest.fn().mockResolvedValue('--- Kontekst z Pokelo ---\n[CRM] a\n[Finsly] b'),
    };

    const service = new AiComposeSuggestService(
      makeSettingsService() as any,
      mockMailThreads as any,
      mockLeads as any,
      pokelo as any,
    );

    await service.suggest({ threadId: 'thread-1', instruction: 'Hello' });

    expect(pokelo.fetchContext).toHaveBeenCalledTimes(1);
    expect(pokelo.fetchContext).toHaveBeenCalledWith(expect.any(String), {
      projectIds: ['crm', 'finsly'],
    });
    // Only the compose completion — no router call
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('works without Pokelo when context service is null', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: 'Draft' } }] }),
    });

    const settings = makeSettingsService();
    const service = new AiComposeSuggestService(
      settings as any,
      mockMailThreads as any,
      mockLeads as any,
      null,
    );

    await service.suggest({ threadId: 'thread-1' });
    const body = JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body);
    const systemMsg = body.messages.find((m: { role: string }) => m.role === 'system');
    expect(systemMsg.content).not.toContain('Kontekst z Pokelo');
  });
});

describe('AiComposeSuggestService.generateNewsletter', () => {
  const mockMailThreads = { getThread: jest.fn() };
  const mockLeads = { findById: jest.fn() };

  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch = jest.fn();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function service(settings = makeSettingsService()) {
    return new AiComposeSuggestService(settings as any, mockMailThreads as any, mockLeads as any);
  }

  it('asks the model for HTML and strips fences', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: '```html\n<p>Hello list</p>\n```' } }],
      }),
    });

    const result = await service().generateNewsletter({
      contentType: 'html',
      subject: 'March update',
      instruction: 'Friendly product update',
    });

    expect(result.draft).toBe('<p>Hello list</p>');
    expect(result.modelUsed).toBe('gpt-4o');

    const body = JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body);
    const systemMsg = body.messages.find((m: { role: string }) => m.role === 'system');
    const userMsg = body.messages.find((m: { role: string }) => m.role === 'user');
    expect(systemMsg.content).toContain('Output format: HTML fragment');
    expect(systemMsg.content).toContain('note-box');
    expect(systemMsg.content).toContain('@TrackLink');
    expect(userMsg.content).toContain('Required output format: html');
    expect(userMsg.content).toContain('March update');
  });

  it('mentions the selected Listmonk template in the prompt', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: '<p>Hi</p>' } }] }),
    });

    await service().generateNewsletter({
      contentType: 'html',
      instruction: 'Product update',
      templateName: 'Finsly',
    });

    const body = JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body);
    const userMsg = body.messages.find((m: { role: string }) => m.role === 'user');
    expect(userMsg.content).toContain('Finsly');
    expect(userMsg.content).toContain('template');
  });

  it.each([
    ['markdown', 'Output format: Markdown body fragment'],
    ['plain', 'Output format: plain text body fragment'],
    ['richtext', 'Output format: simple HTML richtext fragment'],
  ] as const)('includes format spec for %s', async (contentType, needle) => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: 'Body' } }] }),
    });

    await service().generateNewsletter({ contentType, instruction: 'Say hello' });

    const body = JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body);
    const systemMsg = body.messages.find((m: { role: string }) => m.role === 'system');
    expect(systemMsg.content).toContain(needle);
  });

  it('throws when there is no brief or campaign context', async () => {
    await expect(service().generateNewsletter({ contentType: 'html' })).rejects.toThrow(
      'Provide an instruction',
    );
  });

  it('passes existingBody into the user prompt', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: 'Improved' } }] }),
    });

    await service().generateNewsletter({
      contentType: 'markdown',
      existingBody: '## Old draft',
      instruction: 'Make it punchier',
    });

    const body = JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body);
    const userMsg = body.messages.find((m: { role: string }) => m.role === 'user');
    expect(userMsg.content).toContain('## Old draft');
  });

  it('appends Pokelo snippets for newsletter generate', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: '<p>Hi</p>' } }] }),
    });

    const pokelo = {
      fetchContext: jest.fn().mockResolvedValue('--- Kontekst z Pokelo ---\nBrand voice: warm'),
      listBoundProjects: jest.fn().mockResolvedValue([{ id: 'p1', name: 'CRM' }]),
    };
    const svc = new AiComposeSuggestService(
      makeSettingsService() as any,
      mockMailThreads as any,
      mockLeads as any,
      pokelo as any,
    );

    await svc.generateNewsletter({
      contentType: 'html',
      name: 'March',
      subject: 'Update',
      instruction: 'Product news',
    });

    expect(pokelo.fetchContext).toHaveBeenCalledWith(expect.stringContaining('Product news'), {
      projectIds: ['p1'],
    });
    const body = JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body);
    const systemMsg = body.messages.find((m: { role: string }) => m.role === 'system');
    expect(systemMsg.content).toContain('Brand voice: warm');
  });
});

describe('parsePokeloRoute', () => {
  it('extracts primary and followUp IDs from JSON', () => {
    const route = parsePokeloRoute('Here you go:\n{"primary":["a","b"],"followUp":["c"]}\n', [
      'a',
      'b',
      'c',
      'd',
    ]);
    expect(route).toEqual({ primary: ['a', 'b'], followUp: ['c'] });
  });

  it('drops unknown IDs and caps lengths', () => {
    const route = parsePokeloRoute('{"primary":["a","b","x","y"],"followUp":["c","d"]}', [
      'a',
      'b',
      'c',
    ]);
    expect(route.primary).toEqual(['a', 'b']);
    expect(route.followUp).toEqual(['c']);
  });
});

describe('stripCodeFences', () => {
  it('unwraps fenced blocks', () => {
    expect(stripCodeFences('```md\n# Hi\n```')).toBe('# Hi');
  });

  it('leaves plain text alone', () => {
    expect(stripCodeFences('Just text')).toBe('Just text');
  });
});
