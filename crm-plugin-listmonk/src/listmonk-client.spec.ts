import {
  fetchRemoteLists,
  parseConfig,
  lookupSubscribersByEmails,
  fetchAllSubscribers,
  fetchCampaigns,
  fetchCampaign,
  createCampaign,
  updateCampaign,
  updateCampaignStatus,
  deleteCampaign,
  fetchCampaignAnalytics,
  fetchTemplates,
  composeTemplatePreview,
  campaignBodyToHtml,
  previewCampaignEmail,
} from './listmonk-client';

function mockFetchResponse(data: unknown, ok = true, status = 200) {
  return jest.spyOn(global, 'fetch').mockResolvedValue({
    ok,
    status,
    json: jest.fn().mockResolvedValue(data),
    text: jest.fn().mockResolvedValue(JSON.stringify(data)),
  } as unknown as Response);
}

describe('listmonk-client', () => {
  afterEach(() => jest.restoreAllMocks());

  const config = {
    LISTMONK_URL: 'https://mail.example.com',
    LISTMONK_USER: 'admin',
    LISTMONK_PASSWORD: 'secret',
  };

  describe('fetchRemoteLists', () => {
    it('mapuje listy z API Listmonk', async () => {
      mockFetchResponse({
        data: {
          results: [
            { id: 1, name: 'Newsletter', type: 'public', status: 'active', subscriber_count: 42 },
            { id: 2, name: 'VIP', type: 'private', status: 'archived', subscriber_count: 0 },
          ],
        },
      });

      const lists = await fetchRemoteLists(config);

      expect(lists).toEqual([
        { id: 1, name: 'Newsletter', type: 'public', status: 'active', subscriberCount: 42 },
        { id: 2, name: 'VIP', type: 'private', status: 'archived', subscriberCount: 0 },
      ]);

      const [url, init] = (fetch as jest.Mock).mock.calls[0] as [string, RequestInit];
      expect(url).toBe('https://mail.example.com/api/lists?per_page=all');
      expect((init.headers as Record<string, string>).Authorization).toBe(
        'Basic ' + Buffer.from('admin:secret').toString('base64'),
      );
    });

    it('rzuca gdy brak konfiguracji', async () => {
      await expect(fetchRemoteLists({})).rejects.toThrow('Configure Listmonk');
    });

    it('rzuca gdy API zwraca błąd', async () => {
      mockFetchResponse({ error: 'unauthorized' }, false, 401);
      await expect(fetchRemoteLists(config)).rejects.toThrow('401');
    });
  });

  describe('parseConfig', () => {
    it('parsuje LISTMONK_LIST_IDS', () => {
      const cfg = parseConfig({ ...config, LISTMONK_LIST_IDS: '2, 4' });
      expect(cfg?.listIds).toEqual([2, 4]);
    });

    it('fallback do [1] gdy brak list IDs', () => {
      const cfg = parseConfig(config);
      expect(cfg?.listIds).toEqual([1]);
    });
  });

  describe('lookupSubscribersByEmails', () => {
    it('mapuje subskrybentów po emailu', async () => {
      mockFetchResponse({
        data: {
          results: [
            {
              id: 10,
              email: 'jan@example.com',
              name: 'Jan',
              status: 'enabled',
              lists: [{ id: 1, name: 'Newsletter', subscription_status: 'confirmed' }],
            },
          ],
        },
      });

      const map = await lookupSubscribersByEmails(config, [
        'jan@example.com',
        'missing@example.com',
      ]);

      expect(map.get('jan@example.com')).toEqual({
        id: 10,
        email: 'jan@example.com',
        name: 'Jan',
        status: 'enabled',
        lists: [{ id: 1, name: 'Newsletter', subscriptionStatus: 'confirmed' }],
      });
      expect(map.has('missing@example.com')).toBe(false);
    });
  });

  describe('fetchAllSubscribers', () => {
    it('pobiera wszystkich subskrybentów', async () => {
      mockFetchResponse({
        data: {
          results: [{ id: 1, email: 'a@b.com', name: 'A', status: 'enabled', lists: [] }],
        },
      });

      const subs = await fetchAllSubscribers(config);
      expect(subs).toHaveLength(1);
      expect(subs[0].email).toBe('a@b.com');
    });
  });

  const rawCampaign = {
    id: 7,
    uuid: 'camp-uuid',
    name: 'Spring',
    subject: 'Hello',
    from_email: 'news@example.com',
    status: 'draft',
    type: 'regular',
    content_type: 'html',
    body: '<p>Hi</p>',
    lists: [{ id: 1, name: 'Newsletter' }],
    template_id: 2,
    tags: ['spring'],
    send_at: null,
    started_at: null,
    to_send: 100,
    sent: 0,
    views: 0,
    clicks: 0,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  };

  describe('fetchCampaigns', () => {
    it('mapuje kampanie z paginacją', async () => {
      mockFetchResponse({ data: { results: [rawCampaign], total: 1 } });
      const out = await fetchCampaigns(config, 1, 20);
      expect(out.total).toBe(1);
      expect(out.results[0]).toMatchObject({
        id: 7,
        name: 'Spring',
        fromEmail: 'news@example.com',
        contentType: 'html',
        templateId: 2,
      });
      const [url] = (fetch as jest.Mock).mock.calls[0] as [string];
      expect(url).toContain('/api/campaigns?page=1&per_page=20');
    });

    it('rzuca gdy brak konfiguracji', async () => {
      await expect(fetchCampaigns({})).rejects.toThrow('Configure Listmonk');
    });

    it('rzuca gdy API zwraca błąd', async () => {
      mockFetchResponse({ error: 'nope' }, false, 503);
      await expect(fetchCampaigns(config)).rejects.toThrow('503');
    });
  });

  describe('fetchCampaign', () => {
    it('mapuje szczegóły kampanii', async () => {
      mockFetchResponse({ data: rawCampaign });
      const camp = await fetchCampaign(config, 7);
      expect(camp.id).toBe(7);
      expect(camp.subject).toBe('Hello');
    });
  });

  describe('createCampaign', () => {
    it('POST-uje body w snake_case z headers', async () => {
      mockFetchResponse({ data: rawCampaign });
      await createCampaign(config, {
        name: 'Spring',
        subject: 'Hello',
        lists: [1],
        type: 'regular',
        contentType: 'html',
        body: '<p>Hi</p>',
        fromEmail: 'news@example.com',
        headers: [{ 'Reply-To': 'crm@example.com' }],
      });
      const [, init] = (fetch as jest.Mock).mock.calls[0] as [string, RequestInit];
      expect(init.method).toBe('POST');
      const body = JSON.parse(init.body as string);
      expect(body.content_type).toBe('html');
      expect(body.from_email).toBe('news@example.com');
      expect(body.headers).toEqual([{ 'Reply-To': 'crm@example.com' }]);
    });

    it('rzuca gdy brak konfiguracji', async () => {
      await expect(
        createCampaign(
          {},
          {
            name: 'x',
            subject: 'y',
            lists: [1],
            type: 'regular',
            contentType: 'plain',
            body: 'z',
          },
        ),
      ).rejects.toThrow('Configure Listmonk');
    });
  });

  describe('updateCampaign', () => {
    it('PUT-uje body kampanii', async () => {
      mockFetchResponse({ data: { ...rawCampaign, name: 'Updated' } });
      const camp = await updateCampaign(config, 7, {
        name: 'Updated',
        subject: 'Hello',
        lists: [1],
        type: 'regular',
        contentType: 'html',
        body: '<p>Hi</p>',
      });
      expect(camp.name).toBe('Updated');
      const [url, init] = (fetch as jest.Mock).mock.calls[0] as [string, RequestInit];
      expect(url).toContain('/api/campaigns/7');
      expect(init.method).toBe('PUT');
    });
  });

  describe('updateCampaignStatus', () => {
    it('PUT status', async () => {
      mockFetchResponse({ data: { ...rawCampaign, status: 'running' } });
      const camp = await updateCampaignStatus(config, 7, 'running');
      expect(camp.status).toBe('running');
      const [url, init] = (fetch as jest.Mock).mock.calls[0] as [string, RequestInit];
      expect(url).toContain('/api/campaigns/7/status');
      expect(init.method).toBe('PUT');
    });
  });

  describe('deleteCampaign', () => {
    it('DELETE kampanii', async () => {
      mockFetchResponse({}, true, 200);
      await expect(deleteCampaign(config, 7)).resolves.toBeUndefined();
      const [url, init] = (fetch as jest.Mock).mock.calls[0] as [string, RequestInit];
      expect(url).toContain('/api/campaigns/7');
      expect(init.method).toBe('DELETE');
    });

    it('rzuca gdy upstream fail', async () => {
      mockFetchResponse({}, false, 400);
      await expect(deleteCampaign(config, 7)).rejects.toThrow('400');
    });
  });

  describe('fetchCampaignAnalytics', () => {
    it('mapuje punkty analytics', async () => {
      mockFetchResponse({
        data: [{ campaign_id: 7, count: 3, timestamp: '2026-01-02T00:00:00Z' }],
      });
      const items = await fetchCampaignAnalytics(config, 7, 'views', '2026-01-01', '2026-01-31');
      expect(items).toEqual([{ campaignId: 7, count: 3, timestamp: '2026-01-02T00:00:00Z' }]);
    });
  });

  describe('fetchTemplates', () => {
    it('mapuje szablony kampanii', async () => {
      mockFetchResponse({
        data: [
          {
            id: 1,
            name: 'Default',
            type: 'campaign',
            is_default: true,
            created_at: '2026-01-01T00:00:00Z',
            updated_at: '2026-01-01T00:00:00Z',
          },
          {
            id: 2,
            name: 'Tx',
            type: 'tx',
            is_default: false,
            created_at: '2026-01-01T00:00:00Z',
            updated_at: '2026-01-01T00:00:00Z',
          },
        ],
      });
      const templates = await fetchTemplates(config);
      expect(templates).toHaveLength(1);
      expect(templates[0]).toEqual({
        id: 1,
        name: 'Default',
        type: 'campaign',
        isDefault: true,
        body: undefined,
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
      });
    });
  });

  describe('composeTemplatePreview', () => {
    it('injects content into the Listmonk placeholder', () => {
      const html = composeTemplatePreview(
        '<html><body><header>H</header>{{ template "content" . }}<footer>F</footer></body></html>',
        '<h1>Hi</h1>',
      );
      expect(html).toContain('<h1>Hi</h1>');
      expect(html).toContain('<header>H</header>');
      expect(html).not.toContain('template "content"');
    });

    it('strips TrackLink for html body', () => {
      expect(campaignBodyToHtml('<a href="https://x.test/r@TrackLink">Go</a>', 'html')).toBe(
        '<a href="https://x.test/r">Go</a>',
      );
    });
  });

  describe('previewCampaignEmail', () => {
    it('uses local template compose when campaignId is missing', async () => {
      mockFetchResponse({
        data: {
          id: 1,
          name: 'Finsly',
          type: 'campaign',
          body: '<div class="wrap">{{ template "content" . }}</div>',
        },
      });
      const out = await previewCampaignEmail(config, {
        templateId: 1,
        contentType: 'html',
        body: '<h1>Finsly</h1>',
      });
      expect(out.source).toBe('local');
      expect(out.html).toContain('<h1>Finsly</h1>');
      expect(out.html).toContain('class="wrap"');
    });
  });
});
