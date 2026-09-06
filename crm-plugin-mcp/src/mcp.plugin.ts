import { CrmPlugin, PluginContext, PluginSqlClient } from '@khirby/plugin-sdk';
import { McpNestModule } from './mcp.module';
import { MCP_MIGRATIONS_SQL } from './migrations';

export class McpPlugin implements CrmPlugin {
  name = 'crm_mcp';
  displayName = 'MCP Server';
  displayNameKey = 'plugins.mcp.displayName';
  description = 'Connect an AI agent (Cursor, Claude) to create and update contacts with custom fields, leads, and boards; import contacts; and send mail attributed to a user—hard deletes stay in the CRM.';
  descriptionKey = 'plugins.mcp.description';
  version = '1.0.0';

  getNestModule() {
    return McpNestModule;
  }

  async onMigrate(sql: PluginSqlClient): Promise<void> {
    const statements = MCP_MIGRATIONS_SQL.split(';')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    for (const statement of statements) {
      await sql.unsafe(statement);
    }
  }

  // Settings UI lives in Settings → Plugins (expand panel), not a sidebar route (ADR-0023).

  onInit(ctx: PluginContext): void {
    ctx.log('McpPlugin: initialized');
  }
}
