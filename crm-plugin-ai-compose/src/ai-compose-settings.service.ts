import { Injectable, Inject, Logger } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import {
  Db,
  DB_TOKEN,
  PLUGIN_REGISTRY,
  type PluginRegistryLike,
  AppException,
  isReasoningEffort,
  type ReasoningEffort,
} from '@khirby/plugin-host';
import { aiComposeSettings } from './schema';
import { encrypt, decrypt, isAiComposeSecretsKeyConfigured } from './ai-compose-crypto';

export const AI_COMPOSE_PLUGIN_NAME = 'crm_ai_compose';

export type AiComposeSettingsPublic = {
  baseUrl: string;
  defaultModel: string | null;
  allowedModels: string[];
  systemPrompt: string | null;
  reasoningEffort: ReasoningEffort | null;
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
      reasoningEffort: isReasoningEffort(row?.reasoningEffort) ? row.reasoningEffort : null,
      apiKeyConfigured: !!row?.apiKeyEnc,
    };
  }

  async updateSettings(dto: {
    apiKey?: string;
    baseUrl?: string;
    defaultModel?: string | null;
    allowedModels?: string[];
    systemPrompt?: string | null;
    reasoningEffort?: ReasoningEffort | null;
  }): Promise<AiComposeSettingsPublic> {
    await this.assertPluginEnabled();

    const existing = await this.getRow();

    let apiKeyEnc: string | undefined = undefined;
    if (dto.apiKey !== undefined && dto.apiKey.trim()) {
      if (!isAiComposeSecretsKeyConfigured()) {
        throw AppException.badRequest('KHIRBY_SECRETS_KEY is not configured');
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

    if (
      dto.reasoningEffort !== undefined &&
      dto.reasoningEffort !== null &&
      !isReasoningEffort(dto.reasoningEffort)
    ) {
      throw AppException.badRequest('reasoningEffort must be none, low, medium, or high');
    }

    const patch: Record<string, unknown> = {
      baseUrl,
      defaultModel:
        dto.defaultModel !== undefined ? dto.defaultModel : (existing?.defaultModel ?? null),
      allowedModels: dto.allowedModels ?? existing?.allowedModels ?? [],
      systemPrompt:
        dto.systemPrompt !== undefined ? dto.systemPrompt : (existing?.systemPrompt ?? null),
      reasoningEffort:
        dto.reasoningEffort !== undefined
          ? dto.reasoningEffort
          : isReasoningEffort(existing?.reasoningEffort)
            ? existing.reasoningEffort
            : null,
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

  /** Decrypt the stored API key for internal use; throws if missing or unreadable. */
  async getDecryptedApiKey(): Promise<{ apiKey: string; baseUrl: string }> {
    const row = await this.getRow();
    if (!row?.apiKeyEnc) {
      throw AppException.pluginNotConfigured('ai-compose', 'AI Compose API key is not configured');
    }
    try {
      return {
        apiKey: decrypt(row.apiKeyEnc),
        baseUrl: row.baseUrl,
      };
    } catch (err) {
      this.logger.warn(
        `Failed to decrypt AI Compose API key: ${err instanceof Error ? err.message : 'unknown'}`,
      );
      throw AppException.pluginNotConfigured(
        'ai-compose',
        'AI Compose API key cannot be decrypted',
      );
    }
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

  async getReasoningEffort(): Promise<ReasoningEffort | null> {
    const row = await this.getRow();
    return isReasoningEffort(row?.reasoningEffort) ? row.reasoningEffort : null;
  }
}
