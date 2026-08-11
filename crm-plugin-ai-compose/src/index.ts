export { AiComposePlugin } from './ai-compose.plugin';
import { AiComposePlugin } from './ai-compose.plugin';
import type { CrmPlugin } from '@khirby/plugin-sdk';

export function createPlugin(): CrmPlugin {
  return new AiComposePlugin();
}
