import { Controller, Get, Post, Body, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import {
  SessionGuard,
  PermissionGuard,
  RequireAnyPermission,
  RequirePluginEnabled,
  PluginEnabledGuard,
} from '../../../packages/plugin-host/src';
import { AiComposeSuggestService, type NewsletterContentType } from './ai-compose-suggest.service';
import { AI_COMPOSE_PLUGIN_NAME } from './ai-compose-settings.service';

@ApiTags('plugins-ai-compose')
@Controller('plugins/ai-compose')
@UseGuards(SessionGuard, PermissionGuard, PluginEnabledGuard)
@RequirePluginEnabled(AI_COMPOSE_PLUGIN_NAME)
export class AiComposeGenerateController {
  constructor(private readonly suggest: AiComposeSuggestService) {}

  @Get('availability')
  @ApiOperation({
    summary:
      'Whether AI Compose can generate (plugin enabled + API key). For feature gates in other plugins.',
  })
  availability() {
    return this.suggest.availability();
  }

  @Get('models/compose')
  @RequireAnyPermission(
    ['newsletter', 'manage'],
    ['leads', 'manage'],
    ['contacts', 'manage'],
    ['integrations', 'manage'],
  )
  @ApiOperation({
    summary:
      'Allowed models for compose UIs (mail / newsletter) — not limited to integrations admins',
  })
  composeModels() {
    return this.suggest.getComposeModels();
  }

  @Post('generate')
  @RequireAnyPermission(
    ['newsletter', 'manage'],
    ['leads', 'manage'],
    ['contacts', 'manage'],
    ['integrations', 'manage'],
  )
  @ApiOperation({
    summary:
      'Generate newsletter campaign body in the requested format (html / markdown / plain / richtext)',
  })
  generate(
    @Body()
    dto: {
      contentType: NewsletterContentType;
      name?: string;
      subject?: string;
      instruction?: string;
      existingBody?: string;
      templateName?: string;
      model?: string;
    },
  ) {
    return this.suggest.generateNewsletter(dto);
  }
}
