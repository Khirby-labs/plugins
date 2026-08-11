export { ListmonkPlugin } from './listmonk.plugin';
import { ListmonkPlugin } from './listmonk.plugin';
import type { CrmPlugin } from '@khirby/plugin-sdk';

export function createPlugin(): CrmPlugin {
  return new ListmonkPlugin();
}
