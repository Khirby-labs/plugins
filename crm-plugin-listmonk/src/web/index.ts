import type { PluginWebEntry } from '@khirby/plugin-sdk';
import en from './messages/en';
import pl from './messages/pl';

export const webEntry: PluginWebEntry = {
  name: 'crm_listmonk',
  component: () => import('./ListmonkView.vue'),
  messages: { en, pl },
};
