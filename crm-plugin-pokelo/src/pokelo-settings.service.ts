import { Injectable, Inject, Logger } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import {
  Db,
  DB_TOKEN,
  PLUGIN_REGISTRY,
  type PluginRegistryLike,
  AppException,
} from '../../../packages/plugin-host/src';
import { pokeloSettings } from './schema';
import { encrypt, decrypt, isPokeloSecretsKeyConfigured } from './pokelo-crypto';

export const POKELO_PLUGIN_NAME = 'crm_pokelo';
export const DEFAULT_POKELO_BASE_URL = 'https://rag.bearly.pro/v1';

export type PokeloSettingsPublic = {
  baseUrl: string;
  /** Bound Pokelo project IDs (multi-select). */
  projectIds: string[];
  tokenConfigured: boolean;
};

function normalizeProjectIds(ids: unknown): string[] {
  if (!Array.isArray(ids)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of ids) {
    if (typeof raw !== 'string') continue;
    const id = raw.trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

/** Resolve bound IDs from row (project_ids preferred; legacy project_id fallback). */
export function resolveBoundProjectIds(
  row: {
    projectIds?: string[] | null;
    projectId?: string | null;
  } | null,
): string[] {
  if (!row) return [];
  const fromArray = normalizeProjectIds(row.projectIds);
  if (fromArray.length > 0) return fromArray;
  if (row.projectId?.trim()) return [row.projectId.trim()];
  return [];
}

@Injectable()
export class PokeloSettingsService {
  private readonly logger = new Logger(PokeloSettingsService.name);

  constructor(
    @Inject(DB_TOKEN) private readonly db: Db,
    @Inject(PLUGIN_REGISTRY) private readonly registry: PluginRegistryLike,
  ) {}

  async assertPluginEnabled(): Promise<void> {
    const plugin = await this.registry.findByName(POKELO_PLUGIN_NAME);
    if (!plugin?.enabled) {
      throw AppException.pluginDisabled('pokelo');
    }
  }

  async isPluginEnabled(): Promise<boolean> {
    if (this.registry.isEnabled?.(POKELO_PLUGIN_NAME) === false) {
      return false;
    }
    const plugin = await this.registry.findByName(POKELO_PLUGIN_NAME);
    return !!plugin?.enabled;
  }

  private async getRow() {
    const [row] = await this.db.select().from(pokeloSettings).limit(1);
    return row ?? null;
  }

  async getSettings(): Promise<PokeloSettingsPublic> {
    await this.assertPluginEnabled();
    const row = await this.getRow();
    return {
      baseUrl: row?.baseUrl ?? DEFAULT_POKELO_BASE_URL,
      projectIds: resolveBoundProjectIds(row),
      tokenConfigured: !!row?.encryptedToken,
    };
  }

  async updateSettings(dto: {
    token?: string;
    baseUrl?: string;
    projectIds?: string[];
  }): Promise<PokeloSettingsPublic> {
    await this.assertPluginEnabled();

    const existing = await this.getRow();

    let encryptedToken: string | undefined = undefined;
    if (dto.token !== undefined && dto.token.trim()) {
      if (!isPokeloSecretsKeyConfigured()) {
        throw AppException.badRequest('POKELO_SECRETS_KEY is not configured');
      }
      encryptedToken = encrypt(dto.token.trim());
    }

    const baseUrl = dto.baseUrl ?? existing?.baseUrl ?? DEFAULT_POKELO_BASE_URL;
    if (
      !baseUrl.startsWith('https://') &&
      baseUrl !== 'http://localhost' &&
      !baseUrl.startsWith('http://localhost:')
    ) {
      throw AppException.badRequest(
        'baseUrl must use https:// (or http://localhost for local Pokelo)',
      );
    }

    const projectIds =
      dto.projectIds !== undefined
        ? normalizeProjectIds(dto.projectIds)
        : resolveBoundProjectIds(existing);

    const patch: Record<string, unknown> = {
      baseUrl,
      projectIds,
      // Keep legacy column in sync (first id or null) for older rows / tooling
      projectId: projectIds[0] ?? null,
      updatedAt: new Date(),
    };

    if (encryptedToken !== undefined) {
      patch.encryptedToken = encryptedToken;
    }

    if (!existing) {
      await this.db.insert(pokeloSettings).values(patch as any);
    } else {
      await this.db
        .update(pokeloSettings)
        .set(patch as any)
        .where(eq(pokeloSettings.id, existing.id));
    }

    this.logger.log('Pokelo settings updated');
    return this.getSettings();
  }

  /** Internal: credentials for MCP calls. Returns null if token missing. */
  async getCredentials(): Promise<{
    token: string;
    baseUrl: string;
    projectIds: string[];
  } | null> {
    const row = await this.getRow();
    if (!row?.encryptedToken) return null;
    try {
      return {
        token: decrypt(row.encryptedToken),
        baseUrl: row.baseUrl || DEFAULT_POKELO_BASE_URL,
        projectIds: resolveBoundProjectIds(row),
      };
    } catch (err) {
      this.logger.warn(`Failed to decrypt Pokelo token: ${(err as Error).message}`);
      return null;
    }
  }
}
