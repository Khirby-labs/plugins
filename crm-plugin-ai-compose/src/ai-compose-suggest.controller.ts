import { Controller, Post, Body, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import {
  SessionGuard,
  PermissionGuard,
  RequireAnyPermission,
  RequirePluginEnabled,
  PluginEnabledGuard,
} from '../../../packages/plugin-host/src';
import { AiComposeSuggestService } from './ai-compose-suggest.service';
import { AI_COMPOSE_PLUGIN_NAME } from './ai-compose-settings.service';

@ApiTags('plugins-ai-compose')
@Controller('plugins/ai-compose')
@UseGuards(SessionGuard, PermissionGuard, PluginEnabledGuard)
@RequireAnyPermission(['leads', 'manage'], ['contacts', 'manage'])
@RequirePluginEnabled(AI_COMPOSE_PLUGIN_NAME)
export class AiComposeSuggestController {
  constructor(private readonly suggest: AiComposeSuggestService) {}

  @Post('suggest')
  @ApiOperation({
    summary:
      'Generate an AI draft for a mail thread reply or a first outbound to a lead (never auto-sends)',
  })
  generateSuggestion(
    @Body()
    dto: {
      threadId?: string;
      leadId?: string;
      model?: string;
      instruction?: string;
    },
  ) {
    return this.suggest.suggest(dto);
  }
}
