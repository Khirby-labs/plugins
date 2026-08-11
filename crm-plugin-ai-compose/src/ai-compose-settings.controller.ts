import { Controller, Get, Patch, Body, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import {
  SessionGuard,
  PermissionGuard,
  RequirePermission,
  RequirePluginEnabled,
  PluginEnabledGuard,
  AppException,
} from '../../../packages/plugin-host/src';
import { AiComposeSettingsService } from './ai-compose-settings.service';
import { AiComposeSuggestService } from './ai-compose-suggest.service';
import { AI_COMPOSE_PLUGIN_NAME } from './ai-compose-settings.service';

@ApiTags('plugins-ai-compose')
@Controller('plugins/ai-compose')
@UseGuards(SessionGuard, PermissionGuard, PluginEnabledGuard)
@RequirePermission('integrations', 'manage')
@RequirePluginEnabled(AI_COMPOSE_PLUGIN_NAME)
export class AiComposeSettingsController {
  constructor(
    private readonly settings: AiComposeSettingsService,
    private readonly suggest: AiComposeSuggestService,
  ) {}

  @Get('settings')
  @ApiOperation({ summary: 'Get AI Compose settings (API key never returned)' })
  getSettings() {
    return this.settings.getSettings();
  }

  @Patch('settings')
  @ApiOperation({ summary: 'Update AI Compose settings' })
  updateSettings(
    @Body()
    dto: {
      apiKey?: string;
      baseUrl?: string;
      defaultModel?: string | null;
      allowedModels?: string[];
      systemPrompt?: string | null;
    },
  ) {
    return this.settings.updateSettings(dto);
  }

  @Get('models')
  @ApiOperation({ summary: 'Fetch available models from the configured AI provider' })
  async getModels() {
    const { apiKey, baseUrl } = await this.settings.getDecryptedApiKey().catch(() => {
      throw AppException.badRequest('API key is not configured. Save your settings first.');
    });
    return this.suggest.fetchModels(baseUrl, apiKey);
  }

  @Get('models/allowed')
  @ApiOperation({ summary: 'Get intersection of allowed models (admin allowlist) + default' })
  async getAllowedModels() {
    const defaultModel = await this.settings.getDefaultModel();
    const allowedModels = await this.settings.getAllowedModels();

    const toEntries = (ids: string[]) => ids.map((m) => ({ id: m, label: m }));

    if (allowedModels.length === 0) {
      const { apiKey, baseUrl } = await this.settings.getDecryptedApiKey().catch(() => ({
        apiKey: '',
        baseUrl: '',
      }));
      if (apiKey) {
        try {
          const all = await this.suggest.fetchModels(baseUrl, apiKey);
          return { models: all, defaultModel };
        } catch {
          return { models: [], defaultModel };
        }
      }
      return { models: [], defaultModel };
    }

    try {
      const { apiKey, baseUrl } = await this.settings.getDecryptedApiKey();
      const allModels = await this.suggest.fetchModels(baseUrl, apiKey);
      const allIds = new Set(allModels.map((m) => m.id));
      const models = allowedModels
        .filter((m) => allIds.has(m))
        .map((m) => {
          const found = allModels.find((x) => x.id === m);
          return { id: m, label: found?.label ?? m };
        });
      return { models, defaultModel };
    } catch {
      return { models: toEntries(allowedModels), defaultModel };
    }
  }
}
