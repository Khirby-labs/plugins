import { Controller, Get, Patch, Body, UseGuards, Logger } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import {
  SessionGuard,
  PermissionGuard,
  RequirePermission,
  RequirePluginEnabled,
  PluginEnabledGuard,
  AppException,
} from '../../../packages/plugin-host/src';
import { PokeloSettingsService, POKELO_PLUGIN_NAME } from './pokelo-settings.service';
import { PokeloContextService } from './pokelo-context.service';

@ApiTags('plugins-pokelo')
@Controller('plugins/pokelo')
@UseGuards(SessionGuard, PermissionGuard, PluginEnabledGuard)
@RequirePermission('integrations', 'manage')
@RequirePluginEnabled(POKELO_PLUGIN_NAME)
export class PokeloSettingsController {
  private readonly logger = new Logger(PokeloSettingsController.name);

  constructor(
    private readonly settings: PokeloSettingsService,
    private readonly context: PokeloContextService,
  ) {}

  @Get('settings')
  @ApiOperation({ summary: 'Get Pokelo settings (token never returned)' })
  getSettings() {
    return this.settings.getSettings();
  }

  @Patch('settings')
  @ApiOperation({
    summary: 'Update Pokelo settings; auto-select the only project when none are bound',
  })
  async updateSettings(
    @Body()
    dto: {
      token?: string;
      baseUrl?: string;
      projectIds?: string[];
    },
  ) {
    let result = await this.settings.updateSettings(dto);

    const shouldAutoPick =
      !!dto.token?.trim() && dto.projectIds === undefined && result.projectIds.length === 0;

    if (shouldAutoPick && result.tokenConfigured) {
      try {
        const projects = await this.context.listProjects();
        if (projects.length === 1) {
          result = await this.settings.updateSettings({ projectIds: [projects[0].id] });
          this.logger.log(`Auto-selected Pokelo project ${projects[0].id}`);
        }
      } catch (err) {
        this.logger.warn(`Could not auto-select Pokelo project: ${(err as Error).message}`);
      }
    }

    return result;
  }

  @Get('projects')
  @ApiOperation({ summary: 'List Pokelo projects visible to the configured token' })
  async listProjects() {
    const settings = await this.settings.getSettings();
    if (!settings.tokenConfigured) {
      throw AppException.badRequest('Pokelo token is not configured. Save your settings first.');
    }
    return this.context.listProjects();
  }
}
