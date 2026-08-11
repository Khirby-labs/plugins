export { McpPlugin } from './mcp.plugin';
import { McpPlugin } from './mcp.plugin';
import type { CrmPlugin } from '@khirby/plugin-sdk';

export function createPlugin(): CrmPlugin {
  return new McpPlugin();
}
