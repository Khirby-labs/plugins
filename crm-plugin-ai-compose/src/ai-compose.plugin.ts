import type { CrmPlugin, PluginContext, PluginSqlClient } from '@khirby/plugin-sdk';
import { AiComposeModule } from './ai-compose.module';
import { AI_COMPOSE_MIGRATIONS_SQL } from './migrations';

export class AiComposePlugin implements CrmPlugin {
  name = 'crm_ai_compose';
  displayName = 'AI Compose';
  displayNameKey = 'plugins.aiCompose.displayName';
  description = 'AI-powered reply draft suggestions (BYOK, OpenAI-compatible)';
  descriptionKey = 'plugins.aiCompose.description';
  version = '1.0.0';

  getNestModule() {
    return AiComposeModule;
  }

  async onMigrate(sql: PluginSqlClient): Promise<void> {
    const statements = AI_COMPOSE_MIGRATIONS_SQL.split(';')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    for (const statement of statements) {
      await sql.unsafe(statement);
    }
  }

  // Settings UI lives in Settings → Plugins (expand panel), not a sidebar route (ADR-0023).

  onInit(ctx: PluginContext): void {
    ctx.log('AiComposePlugin: initialized');
  }
}
