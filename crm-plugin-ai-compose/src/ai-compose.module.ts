import { Module } from '@nestjs/common';
import { AiComposeSettingsService } from './ai-compose-settings.service';
import { AiComposeSuggestService } from './ai-compose-suggest.service';
import { AiComposeSettingsController } from './ai-compose-settings.controller';
import { AiComposeSuggestController } from './ai-compose-suggest.controller';
import { AiComposeGenerateController } from './ai-compose-generate.controller';

/** Host DI (DB_TOKEN, LEADS_SERVICE, MAIL_THREAD_SERVICE, PLUGIN_REGISTRY) comes from global PluginBridgeModule (ADR-0016). */
@Module({
  controllers: [
    AiComposeSettingsController,
    AiComposeSuggestController,
    AiComposeGenerateController,
  ],
  providers: [AiComposeSettingsService, AiComposeSuggestService],
})
export class AiComposeModule {}
