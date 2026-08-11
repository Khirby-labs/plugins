export { DiscordPlugin, EVENT_PLACEHOLDERS } from './discord.plugin';
export { renderTemplate, truncateContent } from './template';
export { isDiscordWebhookUrl, isAllowedUrl } from './discord-client';
import { DiscordPlugin } from './discord.plugin';
import type { CrmPlugin } from '@khirby/plugin-sdk';

export function createPlugin(): CrmPlugin {
  return new DiscordPlugin();
}
