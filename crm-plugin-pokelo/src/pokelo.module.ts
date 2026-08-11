import { Global, Module } from '@nestjs/common';
import { POKELO_CONTEXT_SERVICE } from '../../../packages/plugin-host/src';
import { PokeloSettingsService } from './pokelo-settings.service';
import { PokeloContextService } from './pokelo-context.service';
import { PokeloSettingsController } from './pokelo-settings.controller';

/**
 * @Global so AI Compose (sibling plugin module) can @Optional()-inject
 * POKELO_CONTEXT_SERVICE (ADR-0022).
 */
@Global()
@Module({
  controllers: [PokeloSettingsController],
  providers: [
    PokeloSettingsService,
    PokeloContextService,
    { provide: POKELO_CONTEXT_SERVICE, useExisting: PokeloContextService },
  ],
  exports: [POKELO_CONTEXT_SERVICE],
})
export class PokeloModule {}
