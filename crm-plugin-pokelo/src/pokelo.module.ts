import { Global, Module } from '@nestjs/common';
import { KNOWLEDGE_CONTEXT, POKELO_CONTEXT_SERVICE } from '../../../packages/plugin-host/src';
import { PokeloSettingsService } from './pokelo-settings.service';
import { PokeloContextService } from './pokelo-context.service';
import { PokeloSettingsController } from './pokelo-settings.controller';

/**
 * @Global so sibling plugins can @Optional()-inject KNOWLEDGE_CONTEXT (ADR-0047).
 * POKELO_CONTEXT_SERVICE stays as a second provide until published consumers bump.
 */
@Global()
@Module({
  controllers: [PokeloSettingsController],
  providers: [
    PokeloSettingsService,
    PokeloContextService,
    { provide: KNOWLEDGE_CONTEXT, useExisting: PokeloContextService },
    { provide: POKELO_CONTEXT_SERVICE, useExisting: PokeloContextService },
  ],
  exports: [KNOWLEDGE_CONTEXT, POKELO_CONTEXT_SERVICE],
})
export class PokeloModule {}
