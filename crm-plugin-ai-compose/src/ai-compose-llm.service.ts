import { Injectable } from '@nestjs/common';
import type { AiComposeLlmLike } from '../../../packages/plugin-host/src';
import { AiComposeSettingsService } from './ai-compose-settings.service';

/** Host token surface for Ask Khirby agent chat (ADR-0040). */
@Injectable()
export class AiComposeLlmService implements AiComposeLlmLike {
  constructor(private readonly settings: AiComposeSettingsService) {}

  async getCompletionConfig(): Promise<{
    baseUrl: string;
    apiKey: string;
    model: string;
  } | null> {
    try {
      await this.settings.assertPluginEnabled();
      const { apiKey, baseUrl } = await this.settings.getDecryptedApiKey();
      const model = await this.settings.getDefaultModel();
      if (!model?.trim()) return null;
      return { baseUrl, apiKey, model: model.trim() };
    } catch {
      return null;
    }
  }
}
