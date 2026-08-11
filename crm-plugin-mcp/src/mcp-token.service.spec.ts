import { McpTokenService, parseBearerToken, MCP_TOKEN_PREFIX } from './mcp-token.service';
import * as bcrypt from 'bcryptjs';

function makeChain(rows: unknown[] = []) {
  const chain: Record<string, unknown> = {
    select: () => chain,
    from: () => chain,
    where: () => chain,
    limit: jest.fn().mockResolvedValue(rows),
    delete: () => chain,
    insert: () => ({
      values: jest.fn().mockResolvedValue(undefined),
    }),
    update: () => ({
      set: () => ({
        where: jest.fn().mockResolvedValue(undefined),
      }),
    }),
  };
  // delete() is awaited in rotate/revoke — make the chain thenable for delete path
  (chain as { then?: unknown }).then = undefined;
  return chain;
}

describe('parseBearerToken', () => {
  it('extracts the token from a Bearer header', () => {
    expect(parseBearerToken('Bearer abc.def')).toBe('abc.def');
  });

  it('is case-insensitive on the scheme', () => {
    expect(parseBearerToken('bearer xyz')).toBe('xyz');
  });

  it('returns null for missing or malformed headers', () => {
    expect(parseBearerToken(undefined)).toBeNull();
    expect(parseBearerToken('')).toBeNull();
    expect(parseBearerToken('Basic abc')).toBeNull();
    expect(parseBearerToken('Bearer')).toBeNull();
  });
});

describe('McpTokenService', () => {
  const registry = {
    findByName: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    registry.findByName.mockResolvedValue({ name: 'crm_mcp', enabled: true, config: {} });
  });

  it('getStatus returns configured:false when no row', async () => {
    const db = makeChain([]);
    const svc = new McpTokenService(db as never, registry as never);
    await expect(svc.getStatus()).resolves.toEqual({ configured: false });
  });

  it('getStatus returns prefix and dates without the hash', async () => {
    const createdAt = new Date('2026-07-01T12:00:00.000Z');
    const db = makeChain([
      {
        id: 't1',
        tokenHash: '$2a$10$secret',
        prefix: 'brly_mcp_abcd…',
        createdAt,
        lastUsedAt: null,
      },
    ]);
    const svc = new McpTokenService(db as never, registry as never);
    const status = await svc.getStatus();
    expect(status).toEqual({
      configured: true,
      prefix: 'brly_mcp_abcd…',
      createdAt: createdAt.toISOString(),
      lastUsedAt: null,
    });
    expect(JSON.stringify(status)).not.toContain('tokenHash');
    expect(JSON.stringify(status)).not.toContain('$2a$');
  });

  it('rotate returns a brly_mcp_ token and stores a bcrypt hash', async () => {
    const values = jest.fn().mockResolvedValue(undefined);
    const db: Record<string, unknown> = {
      select: () => db,
      from: () => db,
      where: () => db,
      limit: jest.fn().mockResolvedValue([]),
      delete: jest.fn().mockResolvedValue(undefined),
      insert: () => ({ values }),
      update: () => ({ set: () => ({ where: jest.fn() }) }),
    };
    const svc = new McpTokenService(db as never, registry as never);
    const { token } = await svc.rotate();

    expect(token.startsWith(MCP_TOKEN_PREFIX)).toBe(true);
    expect(values).toHaveBeenCalled();
    const inserted = values.mock.calls[0][0] as { tokenHash: string; prefix: string };
    expect(inserted.tokenHash).not.toBe(token);
    expect(await bcrypt.compare(token, inserted.tokenHash)).toBe(true);
    expect(inserted.prefix.startsWith(token.slice(0, 8))).toBe(true);
  });

  it('verify returns true for a matching token', async () => {
    const plaintext = `${MCP_TOKEN_PREFIX}testtoken`;
    const tokenHash = await bcrypt.hash(plaintext, 4);
    const db = makeChain([
      { id: 't1', tokenHash, prefix: 'brly_mcp_…', createdAt: new Date(), lastUsedAt: null },
    ]);
    // update path for last_used_at
    (db as { update: () => unknown }).update = () => ({
      set: () => ({ where: jest.fn().mockResolvedValue(undefined) }),
    });
    const svc = new McpTokenService(db as never, registry as never);
    await expect(svc.verify(plaintext)).resolves.toBe(true);
    await expect(svc.verify('wrong')).resolves.toBe(false);
  });

  it('verify returns false when no token is configured', async () => {
    const db = makeChain([]);
    const svc = new McpTokenService(db as never, registry as never);
    await expect(svc.verify('anything')).resolves.toBe(false);
  });

  it('throws when plugin is disabled', async () => {
    registry.findByName.mockResolvedValue({ name: 'crm_mcp', enabled: false });
    const db = makeChain([]);
    const svc = new McpTokenService(db as never, registry as never);
    await expect(svc.getStatus()).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'PLUGIN_DISABLED' }),
    });
  });
});
