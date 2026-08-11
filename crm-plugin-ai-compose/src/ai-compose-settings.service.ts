import { Injectable, Inject, Logger } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import {
  Db,
  DB_TOKEN,
  PLUGIN_REGISTRY,
  type PluginRegistryLike,
  AppException,
} from '../../../packages/plugin-host/src';
import { aiComposeSettings } from './schema';
import { encrypt, decrypt, isAiComposeSecretsKeyConfigured } from './ai-compose-crypto';

export const AI_COMPOSE_PLUGIN_NAME = 'crm_ai_compose';

export type AiComposeSettingsPublic = {
  baseUrl: string;
  defaultModel: string | null;
  allowedModels: string[];
  systemPrompt: string | null;
  apiKeyConfigured: boolean;
};

@Injectable()
export class AiComposeSettingsService {
  private readonly logger = new Logger(AiComposeSettingsService.name);

  constructor(
    @Inject(DB_TOKEN) private readonly db: Db,
    @Inject(PLUGIN_REGISTRY) private readonly registry: PluginRegistryLike,
  ) {}

  async assertPluginEnabled(): Promise<void> {
    const plugin = await this.registry.findByName(AI_COMPOSE_PLUGIN_NAME);
    if (!plugin?.enabled) {
      throw AppException.pluginDisabled('ai-compose');
    }
  }

  private async getRow() {
    const [row] = await this.db.select().from(aiComposeSettings).limit(1);
    return row ?? null;
  }

  async getSettings(): Promise<AiComposeSettingsPublic> {
    await this.assertPluginEnabled();
    const row = await this.getRow();
    return {
      baseUrl: row?.baseUrl ?? 'https://api.openai.com/v1',
      defaultModel: row?.defaultModel ?? null,
      allowedModels: row?.allowedModels ?? [],
      systemPrompt: row?.systemPrompt ?? null,
      apiKeyConfigured: !!row?.apiKeyEnc,
    };
  }

  async updateSettings(dto: {
    apiKey?: string;
    baseUrl?: string;
    defaultModel?: string | null;
    allowedModels?: string[];
    systemPrompt?: string | null;
  }): Promise<AiComposeSettingsPublic> {
    await this.assertPluginEnabled();

    const existing = await this.getRow();

    let apiKeyEnc: string | undefined = undefined;
    if (dto.apiKey !== undefined && dto.apiKey.trim()) {
      if (!isAiComposeSecretsKeyConfigured()) {
        throw AppException.badRequest('AI_COMPOSE_SECRETS_KEY is not configured');
      }
      apiKeyEnc = encrypt(dto.apiKey.trim());
    }

    const baseUrl = dto.baseUrl ?? existing?.baseUrl ?? 'https://api.openai.com/v1';
    if (
      !baseUrl.startsWith('https://') &&
      baseUrl !== 'http://localhost' &&
      !baseUrl.startsWith('http://localhost:')
    ) {
      throw AppException.badRequest(
        'baseUrl must use https:// (or http://localhost for local models)',
      );
    }

    const patch: Record<string, unknown> = {
      baseUrl,
      defaultModel:
        dto.defaultModel !== undefined ? dto.defaultModel : (existing?.defaultModel ?? null),
      allowedModels: dto.allowedModels ?? existing?.allowedModels ?? [],
      systemPrompt:
        dto.systemPrompt !== undefined ? dto.systemPrompt : (existing?.systemPrompt ?? null),
      updatedAt: new Date(),
    };

    if (apiKeyEnc !== undefined) {
      patch.apiKeyEnc = apiKeyEnc;
    }

    if (!existing) {
      await this.db.insert(aiComposeSettings).values(patch as any);
    } else {
      await this.db
        .update(aiComposeSettings)
        .set(patch as any)
        .where(eq(aiComposeSettings.id, existing.id));
    }

    this.logger.log('AI Compose settings updated');
    return this.getSettings();
  }

  /** Decrypt the stored API key for internal use; throws if missing. */
  async getDecryptedApiKey(): Promise<{ apiKey: string; baseUrl: string }> {
    const row = await this.getRow();
    if (!row?.apiKeyEnc) {
      throw AppException.badRequest('AI Compose API key is not configured');
    }
    return {
      apiKey: decrypt(row.apiKeyEnc),
      baseUrl: row.baseUrl,
    };
  }

  async getAllowedModels(): Promise<string[]> {
    const row = await this.getRow();
    return row?.allowedModels ?? [];
  }

  async getDefaultModel(): Promise<string | null> {
    const row = await this.getRow();
    return row?.defaultModel ?? null;
  }

  async getSystemPrompt(): Promise<string | null> {
    const row = await this.getRow();
    return row?.systemPrompt ?? null;
  }
}
