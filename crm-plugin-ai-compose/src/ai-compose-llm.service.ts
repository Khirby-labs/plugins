import { Injectable, Logger } from '@nestjs/common';
import {
  AppException,
  isReasoningEffort,
  type AiComposeLlmLike,
} from '../../../packages/plugin-host/src';
import { AiComposeSettingsService } from './ai-compose-settings.service';
import { AiComposeSuggestService } from './ai-compose-suggest.service';

/** Host token surface for Ask Khirby agent chat (ADR-0040). */
@Injectable()
export class AiComposeLlmService implements AiComposeLlmLike {
  private readonly logger = new Logger(AiComposeLlmService.name);

  constructor(
    private readonly settings: AiComposeSettingsService,
    private readonly suggest: AiComposeSuggestService,
  ) {}

  async getCompletionConfig(): Promise<{
    baseUrl: string;
    apiKey: string;
    model: string;
    reasoningEffort?: 'none' | 'low' | 'medium' | 'high' | null;
    reasoningSupported?: boolean | null;
  } | null> {
    await this.settings.assertPluginEnabled();
    const { apiKey, baseUrl } = await this.settings.getDecryptedApiKey();
    const model = await this.settings.getDefaultModel();
    if (!model?.trim()) {
      throw AppException.pluginNotConfigured('ai-compose', 'No default model configured');
    }
    const reasoningEffort = await this.settings.getReasoningEffort();
    let reasoningSupported: boolean | null | undefined;
    if (isReasoningEffort(reasoningEffort)) {
      try {
        reasoningSupported =
          this.suggest.cachedReasoningSupport?.(baseUrl, model.trim()) ?? null;
      } catch (err) {
        this.logger.warn(
          `Reasoning catalog cache unavailable: ${err instanceof Error ? err.message : 'unknown'}`,
        );
        reasoningSupported = null;
      }
    }
    return {
      baseUrl,
      apiKey,
      model: model.trim(),
      reasoningEffort,
      reasoningSupported,
    };
  }
}
