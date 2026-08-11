import type { CrmPlugin, PluginContext, PluginSqlClient } from '@khirby/plugin-sdk';
import { PokeloModule } from './pokelo.module';
import { POKELO_MIGRATIONS_SQL } from './migrations';

export class PokeloPlugin implements CrmPlugin {
  name = 'crm_pokelo';
  displayName = 'Pokelo Knowledge Base';
  displayNameKey = 'plugins.pokelo.displayName';
  description = 'Enriches AI Compose with firm knowledge from Pokelo RAG (mail + campaigns).';
  descriptionKey = 'plugins.pokelo.description';
  version = '1.0.0';

  getNestModule() {
    return PokeloModule;
  }

  async onMigrate(sql: PluginSqlClient): Promise<void> {
    const statements = POKELO_MIGRATIONS_SQL.split(';')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    for (const statement of statements) {
      await sql.unsafe(statement);
    }
  }

  // Settings UI lives in Settings → Plugins (expand panel), not a sidebar route (ADR-0023).

  onInit(ctx: PluginContext): void {
    ctx.log('PokeloPlugin: initialized');
  }
}
