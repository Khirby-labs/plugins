import { encrypt, decrypt, isPokeloSecretsKeyConfigured } from './pokelo-crypto';
import { parseSseJsonRpc, parseSearchMatches, parseProjectList } from './pokelo-context.service';
import { PokeloSettingsService } from './pokelo-settings.service';
import { PokeloContextService } from './pokelo-context.service';

describe('pokelo-crypto', () => {
  const HEX_KEY = 'c'.repeat(64);

  beforeEach(() => {
    process.env.POKELO_SECRETS_KEY = HEX_KEY;
  });

  afterEach(() => {
    delete process.env.POKELO_SECRETS_KEY;
  });

  it('encrypts and decrypts back to the same plaintext', () => {
    const plaintext = 'mcp_test_token';
    const cipher = encrypt(plaintext);
    expect(cipher).not.toEqual(plaintext);
    expect(decrypt(cipher)).toEqual(plaintext);
  });

  it('isPokeloSecretsKeyConfigured returns false when key is unset', () => {
    delete process.env.POKELO_SECRETS_KEY;
    expect(isPokeloSecretsKeyConfigured()).toBe(false);
  });

  it('throws on missing key at encrypt time', () => {
    delete process.env.POKELO_SECRETS_KEY;
    expect(() => encrypt('anything')).toThrow('POKELO_SECRETS_KEY is not set');
  });
});

describe('parseSseJsonRpc / parseSearchMatches / parseProjectList', () => {
  it('parses SSE data lines', () => {
    const raw = [
      'event: message',
      'data: {"jsonrpc":"2.0","id":1,"result":{"content":[{"type":"text","text":"{\\"matches\\":[]}"}]}}',
      '',
    ].join('\n');
    const envelope = parseSseJsonRpc(raw);
    expect(envelope.result?.content?.[0]?.text).toContain('matches');
  });

  it('parses search matches JSON', () => {
    const matches = parseSearchMatches(
      JSON.stringify({ matches: [{ content: 'Snippet A' }, { content: 'Snippet B' }] }),
    );
    expect(matches).toEqual(['Snippet A', 'Snippet B']);
  });

  it('parses project list JSON', () => {
    const projects = parseProjectList(
      JSON.stringify({ items: [{ id: 'p1', name: 'Bearly CRM' }, { id: 'x' }] }),
    );
    expect(projects).toEqual([{ id: 'p1', name: 'Bearly CRM' }]);
  });
});

function makeSelectChain(returnValue: unknown[]) {
  const chain: Record<string, unknown> = {};
  const resolved = Promise.resolve(returnValue);
  (chain as any).then = resolved.then.bind(resolved);
  (chain as any).catch = resolved.catch.bind(resolved);
  chain.select = () => chain;
  chain.from = () => chain;
  chain.where = () => chain;
  chain.limit = () => chain;
  return chain;
}

function makeMockDb(row?: unknown) {
  const rows = row !== undefined ? [row] : [];
  return {
    select: () => makeSelectChain(rows),
    insert: () => {
      const chain: Record<string, unknown> = {};
      const resolved = Promise.resolve([]);
      (chain as any).then = resolved.then.bind(resolved);
      chain.values = () => chain;
      return chain;
    },
    update: () => {
      const chain: Record<string, unknown> = {};
      const resolved = Promise.resolve([]);
      (chain as any).then = resolved.then.bind(resolved);
      chain.set = () => chain;
      chain.where = () => chain;
      return chain;
    },
  };
}

function makeMockRegistry(enabled = true) {
  return {
    findByName: jest.fn().mockResolvedValue({ name: 'crm_pokelo', enabled, config: null }),
    isEnabled: jest.fn().mockReturnValue(enabled),
  };
}

describe('PokeloSettingsService', () => {
  const HEX_KEY = 'd'.repeat(64);

  beforeEach(() => {
    process.env.POKELO_SECRETS_KEY = HEX_KEY;
  });

  afterEach(() => {
    delete process.env.POKELO_SECRETS_KEY;
  });

  it('getSettings returns tokenConfigured false when empty', async () => {
    const service = new PokeloSettingsService(makeMockDb() as any, makeMockRegistry() as any);
    const settings = await service.getSettings();
    expect(settings.tokenConfigured).toBe(false);
    expect(settings.baseUrl).toBe('https://rag.bearly.pro/v1');
  });

  it('getCredentials decrypts stored token', async () => {
    const enc = encrypt('mcp_secret');
    const service = new PokeloSettingsService(
      makeMockDb({
        id: '1',
        baseUrl: 'https://rag.bearly.pro/v1',
        encryptedToken: enc,
        projectId: 'proj-1',
        projectIds: ['proj-1', 'proj-2'],
      }) as any,
      makeMockRegistry() as any,
    );
    const creds = await service.getCredentials();
    expect(creds?.token).toBe('mcp_secret');
    expect(creds?.projectIds).toEqual(['proj-1', 'proj-2']);
  });

  it('falls back to legacy projectId when projectIds empty', async () => {
    const enc = encrypt('mcp_secret');
    const service = new PokeloSettingsService(
      makeMockDb({
        id: '1',
        baseUrl: 'https://rag.bearly.pro/v1',
        encryptedToken: enc,
        projectId: 'legacy-only',
        projectIds: [],
      }) as any,
      makeMockRegistry() as any,
    );
    const settings = await service.getSettings();
    expect(settings.projectIds).toEqual(['legacy-only']);
  });
});

describe('PokeloContextService.fetchContext', () => {
  const HEX_KEY = 'e'.repeat(64);

  beforeEach(() => {
    process.env.POKELO_SECRETS_KEY = HEX_KEY;
    global.fetch = jest.fn();
  });

  afterEach(() => {
    delete process.env.POKELO_SECRETS_KEY;
    jest.restoreAllMocks();
  });

  it('returns empty string when plugin disabled', async () => {
    const settings = new PokeloSettingsService(
      makeMockDb({
        encryptedToken: encrypt('t'),
        projectIds: ['p'],
        projectId: 'p',
        baseUrl: 'https://rag.bearly.pro/v1',
      }) as any,
      makeMockRegistry(false) as any,
    );
    const ctx = new PokeloContextService(settings);
    expect(await ctx.fetchContext('hello')).toBe('');
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('returns formatted snippets on MCP success', async () => {
    const settings = new PokeloSettingsService(
      makeMockDb({
        encryptedToken: encrypt('mcp_tok'),
        projectIds: ['proj-uuid'],
        projectId: 'proj-uuid',
        baseUrl: 'https://rag.bearly.pro/v1',
      }) as any,
      makeMockRegistry(true) as any,
    );

    const listPayload = {
      jsonrpc: '2.0',
      id: 1,
      result: {
        content: [
          {
            type: 'text',
            text: JSON.stringify({ items: [{ id: 'proj-uuid', name: 'Bearly CRM' }] }),
          },
        ],
      },
    };

    const searchPayload = {
      jsonrpc: '2.0',
      id: 1,
      result: {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              matches: [{ content: 'Firm pricing is X' }, { content: 'SLA is Y' }],
            }),
          },
        ],
      },
    };

    (global.fetch as jest.Mock)
      .mockResolvedValueOnce({
        ok: true,
        headers: { get: () => 'text/event-stream' },
        text: async () => `data: ${JSON.stringify(listPayload)}\n\n`,
      })
      .mockResolvedValueOnce({
        ok: true,
        headers: { get: () => 'text/event-stream' },
        text: async () => `data: ${JSON.stringify(searchPayload)}\n\n`,
      });

    const ctx = new PokeloContextService(settings);
    const result = await ctx.fetchContext('pricing');
    expect(result).toContain('--- Kontekst z Pokelo ---');
    expect(result).toContain('[Bearly CRM]');
    expect(result).toContain('Firm pricing is X');
    expect(result).toContain('SLA is Y');
    expect(result).toContain('--- Koniec kontekstu Pokelo ---');

    const searchCall = (global.fetch as jest.Mock).mock.calls.find(
      (c) => JSON.parse(c[1].body).params?.name === 'search_documents',
    );
    expect(searchCall[0]).toBe('https://rag.bearly.pro/v1/mcp');
    expect(searchCall[1].headers.Accept).toContain('text/event-stream');
    expect(searchCall[1].headers.Authorization).toBe('Bearer mcp_tok');
  });

  it('searches only requested projectIds subset', async () => {
    const settings = new PokeloSettingsService(
      makeMockDb({
        encryptedToken: encrypt('mcp_tok'),
        projectIds: ['a', 'b'],
        baseUrl: 'https://rag.bearly.pro/v1',
      }) as any,
      makeMockRegistry(true) as any,
    );

    const listPayload = {
      jsonrpc: '2.0',
      result: {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              items: [
                { id: 'a', name: 'CRM' },
                { id: 'b', name: 'Finsly' },
              ],
            }),
          },
        ],
      },
    };
    const searchPayload = {
      jsonrpc: '2.0',
      result: {
        content: [{ type: 'text', text: JSON.stringify({ matches: [{ content: 'Only A' }] }) }],
      },
    };

    (global.fetch as jest.Mock).mockImplementation(async (_url: string, init: { body: string }) => {
      const body = JSON.parse(init.body);
      const payload = body.params?.name === 'list_projects' ? listPayload : searchPayload;
      return {
        ok: true,
        headers: { get: () => 'application/json' },
        text: async () => JSON.stringify(payload),
      };
    });

    const ctx = new PokeloContextService(settings);
    await ctx.fetchContext('q', { projectIds: ['a'] });

    const searchBodies = (global.fetch as jest.Mock).mock.calls
      .map((c) => JSON.parse(c[1].body))
      .filter((b) => b.params?.name === 'search_documents');
    expect(searchBodies).toHaveLength(1);
    expect(searchBodies[0].params.arguments.projectId).toBe('a');
  });

  it('returns empty string on MCP error', async () => {
    const settings = new PokeloSettingsService(
      makeMockDb({
        encryptedToken: encrypt('mcp_tok'),
        projectIds: ['proj-uuid'],
        projectId: 'proj-uuid',
        baseUrl: 'https://rag.bearly.pro/v1',
      }) as any,
      makeMockRegistry(true) as any,
    );

    (global.fetch as jest.Mock).mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => 'Unauthorized',
    });

    const ctx = new PokeloContextService(settings);
    expect(await ctx.fetchContext('pricing')).toBe('');
  });
});
