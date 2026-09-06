import { Global, Module } from '@nestjs/common';
import { AI_COMPOSE_LLM } from '../../../packages/plugin-host/src';
import { AiComposeSettingsService } from './ai-compose-settings.service';
import { AiComposeSuggestService } from './ai-compose-suggest.service';
import { AiComposeLlmService } from './ai-compose-llm.service';
import { AiComposeSettingsController } from './ai-compose-settings.controller';
import { AiComposeSuggestController } from './ai-compose-suggest.controller';
import { AiComposeGenerateController } from './ai-compose-generate.controller';

/** Host DI (DB_TOKEN, LEADS_SERVICE, MAIL_THREAD_SERVICE, PLUGIN_REGISTRY) comes from global PluginBridgeModule (ADR-0016). */
@Global()
@Module({
  controllers: [
    AiComposeSettingsController,
    AiComposeSuggestController,
    AiComposeGenerateController,
  ],
  providers: [
    AiComposeSettingsService,
    AiComposeSuggestService,
    AiComposeLlmService,
    { provide: AI_COMPOSE_LLM, useExisting: AiComposeLlmService },
  ],
  exports: [AI_COMPOSE_LLM],
})
export class AiComposeModule {}
