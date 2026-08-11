export { WebhookPlugin } from './webhook.plugin';
import { WebhookPlugin } from './webhook.plugin';
import type { CrmPlugin } from '@khirby/plugin-sdk';

export function createPlugin(): CrmPlugin {
  return new WebhookPlugin();
}
