import { Injectable, Inject, Logger } from '@nestjs/common';
import { randomBytes } from 'crypto';
import * as bcrypt from 'bcryptjs';
import { eq } from 'drizzle-orm';
import { Db } from '../../../packages/plugin-host/src';
import { DB_TOKEN } from '../../../packages/plugin-host/src';
import { PLUGIN_REGISTRY, type PluginRegistryLike } from '../../../packages/plugin-host/src';
import { AppException } from '../../../packages/plugin-host/src';
import { mcpAccessTokens } from './schema';

export const MCP_PLUGIN_NAME = 'crm_mcp';
export const MCP_TOKEN_PREFIX = 'brly_mcp_';
const BCRYPT_ROUNDS = 10;
/** Characters of the plaintext token shown in the admin UI (never the hash). */
const DISPLAY_PREFIX_LEN = 16;

export type McpTokenStatus = {
  configured: boolean;
  prefix?: string;
  createdAt?: string;
  lastUsedAt?: string | null;
};

@Injectable()
export class McpTokenService {
  private readonly logger = new Logger(McpTokenService.name);

  constructor(
    @Inject(DB_TOKEN) private readonly db: Db,
    @Inject(PLUGIN_REGISTRY) private readonly registry: PluginRegistryLike,
  ) {}

  async assertPluginEnabled(): Promise<void> {
    const plugin = await this.registry.findByName(MCP_PLUGIN_NAME);
    if (!plugin?.enabled) {
      throw AppException.pluginDisabled('mcp');
    }
  }

  async getStatus(): Promise<McpTokenStatus> {
    await this.assertPluginEnabled();
    const [row] = await this.db.select().from(mcpAccessTokens).limit(1);
    if (!row) return { configured: false };
    return {
      configured: true,
      prefix: row.prefix,
      createdAt: row.createdAt.toISOString(),
      lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
    };
  }

  /** Generates a new token, replaces any existing one, returns plaintext once. */
  async rotate(): Promise<{ token: string }> {
    await this.assertPluginEnabled();
    const token = `${MCP_TOKEN_PREFIX}${randomBytes(32).toString('base64url')}`;
    const tokenHash = await bcrypt.hash(token, BCRYPT_ROUNDS);
    const prefix = `${token.slice(0, DISPLAY_PREFIX_LEN)}…`;

    await this.db.delete(mcpAccessTokens);
    await this.db.insert(mcpAccessTokens).values({
      tokenHash,
      prefix,
    } as any);

    this.logger.log('MCP access token rotated');
    return { token };
  }

  async revoke(): Promise<void> {
    await this.assertPluginEnabled();
    await this.db.delete(mcpAccessTokens);
    this.logger.log('MCP access token revoked');
  }

  /**
   * Verifies a bearer token against the stored hash.
   * Returns false when no token is configured or the secret does not match.
   * Does not check plugin enabled — callers do that separately for 503 vs 401.
   */
  async verify(plaintext: string): Promise<boolean> {
    const [row] = await this.db.select().from(mcpAccessTokens).limit(1);
    if (!row) return false;
    const ok = await bcrypt.compare(plaintext, row.tokenHash);
    if (ok) {
      void this.touchLastUsed(row.id).catch((err) =>
        this.logger.warn(`Failed to update last_used_at: ${(err as Error).message}`),
      );
    }
    return ok;
  }

  async hasConfiguredToken(): Promise<boolean> {
    const [row] = await this.db.select({ id: mcpAccessTokens.id }).from(mcpAccessTokens).limit(1);
    return Boolean(row);
  }

  private async touchLastUsed(id: string): Promise<void> {
    await this.db
      .update(mcpAccessTokens)
      .set({ lastUsedAt: new Date() } as any)
      .where(eq(mcpAccessTokens.id, id));
  }
}

/** Extract Bearer token from an Authorization header value. */
export function parseBearerToken(authorization: string | undefined): string | null {
  if (!authorization) return null;
  const match = /^Bearer\s+(\S+)$/i.exec(authorization.trim());
  return match?.[1] ?? null;
}
