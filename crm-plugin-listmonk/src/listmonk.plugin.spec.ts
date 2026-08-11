import { ListmonkPlugin, normalizeReplySubject } from './listmonk.plugin';
import { CrmEvent, PluginContext } from '@khirby/plugin-sdk';

// ─── helpers ──────────────────────────────────────────────────────────────────

function makeCtx(overrides: Record<string, string> = {}): PluginContext {
  const defaults: Record<string, string> = {
    LISTMONK_URL: 'http://listmonk.test',
    LISTMONK_USER: 'admin',
    LISTMONK_PASSWORD: 'secret',
    LISTMONK_LIST_IDS: '1,2',
    LISTMONK_SUBSCRIBE_ON: 'both',
    ...overrides,
  };
  return {
    log: jest.fn(),
    config: defaults,
  };
}

function makeContactEvent(): CrmEvent {
  return {
    type: 'contact.created',
    payload: {
      id: 'c-1',
      email: 'jan@example.com',
      name: 'Jan Kowalski',
      createdAt: new Date(),
    },
  };
}

function makeFormEvent(): CrmEvent {
  return {
    type: 'form.submitted',
    payload: {
      submissionId: 'sub-1',
      formId: 'form-1',
      formSlug: 'kontakt',
      formName: 'Kontakt',
      contactId: 'c-1',
      contactEmail: 'jan@example.com',
      data: { name: 'Jan Kowalski' },
      createdAt: new Date(),
    },
  };
}

function mockFetch(ok: boolean, status = 200, body = '') {
  return jest.spyOn(global, 'fetch').mockResolvedValue({
    ok,
    status,
    text: jest.fn().mockResolvedValue(body),
  } as unknown as Response);
}

// ─── tests ────────────────────────────────────────────────────────────────────

describe('ListmonkPlugin', () => {
  afterEach(() => jest.restoreAllMocks());

  const plugin = new ListmonkPlugin();

  // ── onInit ──────────────────────────────────────────────────────────────────

  describe('onInit', () => {
    it('loguje "ready" gdy konfiguracja kompletna', () => {
      const ctx = makeCtx();
      plugin.onInit(ctx);
      expect(ctx.log).toHaveBeenCalledWith(expect.stringContaining('ready'));
      expect(ctx.log).toHaveBeenCalledWith(expect.stringContaining('[1,2]'));
    });

    it('loguje brak konfiguracji gdy brak LISTMONK_URL', () => {
      const ctx = makeCtx({ LISTMONK_URL: '' });
      plugin.onInit(ctx);
      expect(ctx.log).toHaveBeenCalledWith(expect.stringContaining('not configured yet'));
    });

    it('loguje brak konfiguracji gdy brak LISTMONK_USER', () => {
      const ctx = makeCtx({ LISTMONK_USER: '' });
      plugin.onInit(ctx);
      expect(ctx.log).toHaveBeenCalledWith(expect.stringContaining('not configured yet'));
    });
  });

  // ── onEvent — contact.created ────────────────────────────────────────────────

  describe('onEvent — contact.created', () => {
    it('wysyła POST do /api/subscribers z email i listami', async () => {
      const fetchMock = mockFetch(true);
      const ctx = makeCtx();

      await plugin.onEvent(makeContactEvent(), ctx);

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('http://listmonk.test/api/subscribers');
      expect(init.method).toBe('POST');

      const body = JSON.parse(init.body as string);
      expect(body.email).toBe('jan@example.com');
      expect(body.name).toBe('Jan Kowalski');
      expect(body.lists).toEqual([1, 2]);

      const auth = (init.headers as Record<string, string>).Authorization;
      expect(auth).toBe('Basic ' + Buffer.from('admin:secret').toString('base64'));
    });

    it('NIE wysyła gdy subscribeOn=form.submitted', async () => {
      const fetchMock = mockFetch(true);
      const ctx = makeCtx({ LISTMONK_SUBSCRIBE_ON: 'form.submitted' });

      await plugin.onEvent(makeContactEvent(), ctx);

      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('nie rzuca gdy fetch zwraca błąd HTTP', async () => {
      mockFetch(false, 500, 'Internal Server Error');
      const ctx = makeCtx();

      await expect(plugin.onEvent(makeContactEvent(), ctx)).resolves.not.toThrow();
      expect(ctx.log).toHaveBeenCalledWith(expect.stringContaining('500'));
    });

    it('nie rzuca gdy fetch rzuca wyjątek sieciowy', async () => {
      jest.spyOn(global, 'fetch').mockRejectedValue(new Error('ECONNREFUSED'));
      const ctx = makeCtx();

      await expect(plugin.onEvent(makeContactEvent(), ctx)).resolves.not.toThrow();
      expect(ctx.log).toHaveBeenCalledWith(expect.stringContaining('ECONNREFUSED'));
    });
  });

  // ── onEvent — form.submitted ─────────────────────────────────────────────────

  describe('onEvent — form.submitted', () => {
    it('wysyła POST z contactEmail i name z data', async () => {
      const fetchMock = mockFetch(true);
      const ctx = makeCtx();

      await plugin.onEvent(makeFormEvent(), ctx);

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const body = JSON.parse((fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string);
      expect(body.email).toBe('jan@example.com');
      expect(body.name).toBe('Jan Kowalski');
    });

    it('NIE wysyła gdy subscribeOn=contact.created', async () => {
      const fetchMock = mockFetch(true);
      const ctx = makeCtx({ LISTMONK_SUBSCRIBE_ON: 'contact.created' });

      await plugin.onEvent(makeFormEvent(), ctx);

      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('używa list z lm_list_forms gdy formularz jest przypisany', async () => {
      const fetchMock = mockFetch(true);
      const ctx = makeCtx();
      const sql = jest.fn().mockResolvedValue([{ listmonk_list_id: 9 }, { listmonk_list_id: 11 }]);
      (sql as unknown as { unsafe: typeof sql }).unsafe = sql;
      await plugin.onMigrate(sql as never);

      await plugin.onEvent(makeFormEvent(), ctx);

      const body = JSON.parse((fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string);
      expect(body.lists).toEqual([9, 11]);
    });

    it('używa email jako name gdy data.name brak', async () => {
      const fetchMock = mockFetch(true);
      const ctx = makeCtx();
      const event: CrmEvent = {
        type: 'form.submitted',
        payload: {
          submissionId: 'sub-2',
          formId: 'form-1',
          formSlug: 'kontakt',
          formName: 'Kontakt',
          contactId: 'c-2',
          contactEmail: 'anon@example.com',
          data: {},
          createdAt: new Date(),
        },
      };

      await plugin.onEvent(event, ctx);

      const body = JSON.parse((fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string);
      expect(body.name).toBe('anon@example.com');
    });
  });

  // ── brak konfiguracji ────────────────────────────────────────────────────────

  describe('brak konfiguracji', () => {
    it('onEvent nic nie robi gdy brak LISTMONK_URL', async () => {
      const fetchMock = mockFetch(true);
      const ctx = makeCtx({ LISTMONK_URL: '' });

      await plugin.onEvent(makeContactEvent(), ctx);

      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  // ── parsowanie LISTMONK_LIST_IDS ─────────────────────────────────────────────

  describe('parsowanie list IDs', () => {
    it('parsuje poprawnie "3,5,7"', async () => {
      const fetchMock = mockFetch(true);
      const ctx = makeCtx({ LISTMONK_LIST_IDS: '3,5,7' });

      await plugin.onEvent(makeContactEvent(), ctx);

      const body = JSON.parse((fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string);
      expect(body.lists).toEqual([3, 5, 7]);
    });

    it('fallback do [1] gdy LISTMONK_LIST_IDS pusty', async () => {
      const fetchMock = mockFetch(true);
      const ctx = makeCtx({ LISTMONK_LIST_IDS: '' });

      await plugin.onEvent(makeContactEvent(), ctx);

      const body = JSON.parse((fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string);
      expect(body.lists).toEqual([1]);
    });

    it('fallback do [1] gdy LISTMONK_LIST_IDS nie ustawione', async () => {
      const fetchMock = mockFetch(true);
      const { LISTMONK_LIST_IDS: _, ...rest } = makeCtx().config as Record<string, string>;
      const ctx: PluginContext = { log: jest.fn(), config: rest };

      await plugin.onEvent(makeContactEvent(), ctx);

      const body = JSON.parse((fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string);
      expect(body.lists).toEqual([1]);
    });
  });

  describe('normalizeReplySubject', () => {
    it('strips Re:/Odp: prefixes', () => {
      expect(normalizeReplySubject('Re: Hello')).toBe('hello');
      expect(normalizeReplySubject('Odp: Re: Hello')).toBe('hello');
    });
  });

  describe('onEvent — email.received', () => {
    it('inkrementuje replies_count gdy kontakt i subject match', async () => {
      const unsafe = jest.fn().mockResolvedValue(undefined);
      await plugin.onMigrate({ unsafe });
      unsafe.mockReset();
      unsafe
        .mockResolvedValueOnce([{ id: 'camp-1', subject: 'Hello' }])
        .mockResolvedValueOnce(undefined);

      const ctx = makeCtx();
      await plugin.onEvent(
        {
          type: 'email.received',
          payload: {
            messageId: 'm1',
            threadId: 't1',
            mailboxId: 'mb1',
            fromAddress: 'jan@example.com',
            toAddresses: ['crm@example.com'],
            subject: 'Re: Hello',
            bodyText: 'thanks',
            contactId: 'c-1',
            receivedAt: new Date(),
          },
        },
        ctx,
      );

      expect(unsafe).toHaveBeenCalledWith(
        expect.stringContaining('select id, subject from lm_campaigns'),
        ['hello'],
      );
      expect(unsafe).toHaveBeenCalledWith(
        expect.stringContaining('replies_count = replies_count + 1'),
        ['camp-1'],
      );
    });

    it('pomija gdy brak contactId', async () => {
      const unsafe = jest.fn().mockResolvedValue(undefined);
      await plugin.onMigrate({ unsafe });
      unsafe.mockClear();

      await plugin.onEvent(
        {
          type: 'email.received',
          payload: {
            messageId: 'm1',
            threadId: 't1',
            mailboxId: 'mb1',
            fromAddress: 'stranger@example.com',
            toAddresses: ['crm@example.com'],
            subject: 'Re: Hello',
            bodyText: 'hi',
            contactId: null,
            receivedAt: new Date(),
          },
        },
        makeCtx(),
      );

      expect(unsafe).not.toHaveBeenCalled();
    });
  });

  describe('onMigrate', () => {
    it('tworzy tabele lm_campaigns i lm_list_forms', async () => {
      const unsafe = jest.fn().mockResolvedValue(undefined);
      await plugin.onMigrate({ unsafe });
      expect(unsafe).toHaveBeenCalledWith(expect.stringContaining('lm_campaigns'));
      expect(unsafe).toHaveBeenCalledWith(expect.stringContaining('lm_list_forms'));
    });
  });
});
