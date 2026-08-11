import { useI18n } from 'vue-i18n';
import en from './messages/en';
import pl from './messages/pl';

type ListmonkTranslator = {
  t: (key: string, ...args: unknown[]) => string;
  n: (value: number, key?: string) => string;
};

/**
 * Local catalog for Listmonk plugin UI — does not touch apps/web message files.
 * Cast avoids SPA schema.d.ts fighting plugin-local `en`/`pl` catalogs.
 */
export function useListmonkI18n(): ListmonkTranslator {
  return useI18n({
    inheritLocale: true,
    useScope: 'local',
    messages: { en, pl },
  } as never) as unknown as ListmonkTranslator;
}
