import { Global, Module } from '@nestjs/common';
import {
  KNOWLEDGE_CONTEXT,
  KNOWLEDGE_TOOLS,
  POKELO_CONTEXT_SERVICE,
} from '@khirby/plugin-host';
import { PokeloSettingsService } from './pokelo-settings.service';
import { PokeloContextService } from './pokelo-context.service';
import { PokeloSettingsController } from './pokelo-settings.controller';

/**
 * @Global so sibling plugins can resolve KNOWLEDGE_CONTEXT / KNOWLEDGE_TOOLS (ADR-0047, ADR-0050).
 * POKELO_CONTEXT_SERVICE stays as a second provide until published consumers bump.
 */
@Global()
@Module({
  controllers: [PokeloSettingsController],
  providers: [
    PokeloSettingsService,
    PokeloContextService,
    { provide: KNOWLEDGE_CONTEXT, useExisting: PokeloContextService },
    { provide: KNOWLEDGE_TOOLS, useExisting: PokeloContextService },
    { provide: POKELO_CONTEXT_SERVICE, useExisting: PokeloContextService },
  ],
  exports: [KNOWLEDGE_CONTEXT, KNOWLEDGE_TOOLS, POKELO_CONTEXT_SERVICE],
})
export class PokeloModule {}
