import { ListmonkCampaignsService } from './listmonk-campaigns.service';
import * as client from './listmonk-client';

jest.mock('./listmonk-client', () => {
  const actual = jest.requireActual('./listmonk-client');
  return {
    ...actual,
    parseConfig: jest.fn(),
    fetchCampaigns: jest.fn(),
    fetchCampaign: jest.fn(),
    createCampaign: jest.fn(),
    updateCampaign: jest.fn(),
    updateCampaignStatus: jest.fn(),
    deleteCampaign: jest.fn(),
    fetchCampaignAnalytics: jest.fn(),
    fetchTemplates: jest.fn(),
  };
});

function makeChain(returnValue: unknown = []) {
  const chain: Record<string, unknown> = {
    select: () => chain,
    from: () => chain,
    where: () => chain,
    limit: () => Promise.resolve(returnValue),
    values: () => chain,
    set: () => chain,
    returning: () => Promise.resolve(returnValue),
    then: undefined,
  };
  chain.insert = () => chain;
  chain.update = () => chain;
  chain.delete = () => chain;
  return chain;
}

const sampleCampaign = {
  id: 7,
  uuid: 'u',
  name: 'Spring',
  subject: 'Hello',
  fromEmail: 'news@example.com',
  status: 'draft' as const,
  type: 'regular' as const,
  contentType: 'html' as const,
  body: '<p>Hi</p>',
  lists: [{ id: 1, name: 'Newsletter' }],
  templateId: 2,
  tags: [],
  sendAt: null,
  startedAt: null,
  toSend: 10,
  sent: 0,
  views: 0,
  clicks: 0,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};

describe('ListmonkCampaignsService', () => {
  const registry = {
    findByName: jest.fn().mockResolvedValue({
      enabled: true,
      config: {
        LISTMONK_URL: 'https://mail.example.com',
        LISTMONK_USER: 'admin',
        LISTMONK_PASSWORD: 'secret',
      },
    }),
  };

  let db: ReturnType<typeof makeDb>;
  let svc: ListmonkCampaignsService;

  function makeDb() {
    const chain = makeChain([]);
    return {
      select: jest.fn(() => chain),
      insert: jest.fn(() => chain),
      update: jest.fn(() => chain),
      delete: jest.fn(() => chain),
      execute: jest.fn().mockResolvedValue([]),
      _chain: chain,
    };
  }

  beforeEach(() => {
    jest.clearAllMocks();
    (client.parseConfig as jest.Mock).mockReturnValue({
      url: 'https://mail.example.com',
      authHeader: 'Basic x',
      listIds: [1],
      subscribeOn: 'both',
    });
    db = makeDb();
    svc = new ListmonkCampaignsService(registry as any, db as any);
  });

  it('getCampaigns enriches with local reply metadata', async () => {
    (client.fetchCampaigns as jest.Mock).mockResolvedValue({
      results: [sampleCampaign],
      total: 1,
    });
    db.select.mockImplementation(() =>
      makeChain([
        {
          replyToAddress: 'crm@example.com',
          repliesCount: 3,
        },
      ]),
    );

    const out = await svc.getCampaigns();
    expect(out.total).toBe(1);
    expect(out.results[0].replyToAddress).toBe('crm@example.com');
    expect(out.results[0].repliesCount).toBe(3);
  });

  it('createCampaign with mailbox Reply-To', async () => {
    db.execute.mockResolvedValue([{ from_address: 'crm@example.com' }]);
    (client.createCampaign as jest.Mock).mockResolvedValue(sampleCampaign);
    db.insert.mockImplementation(() => makeChain());

    const created = await svc.createCampaign({
      name: 'Spring',
      subject: 'Hello',
      lists: [1],
      type: 'regular',
      contentType: 'html',
      body: '<p>Hi</p>',
      useMailboxReplyTo: true,
    });

    expect(client.createCampaign).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        fromEmail: 'crm@example.com',
        headers: expect.arrayContaining([
          expect.objectContaining({ 'Reply-To': 'crm@example.com' }),
          expect.objectContaining({ 'X-CRM-Campaign-Id': expect.any(String) }),
        ]),
      }),
    );
    expect(created.replyToAddress).toBe('crm@example.com');
    expect(db.insert).toHaveBeenCalled();
  });

  it('createCampaign sendImmediately sets running', async () => {
    (client.createCampaign as jest.Mock).mockResolvedValue(sampleCampaign);
    (client.updateCampaignStatus as jest.Mock).mockResolvedValue({
      ...sampleCampaign,
      status: 'running',
    });
    db.insert.mockImplementation(() => makeChain());

    await svc.createCampaign({
      name: 'Spring',
      subject: 'Hello',
      lists: [1],
      type: 'regular',
      contentType: 'plain',
      body: 'Hi',
      sendImmediately: true,
    });

    expect(client.updateCampaignStatus).toHaveBeenCalledWith(expect.any(Object), 7, 'running');
  });

  it('updateStatus updates Listmonk and local row', async () => {
    (client.updateCampaignStatus as jest.Mock).mockResolvedValue({
      ...sampleCampaign,
      status: 'paused',
    });
    db.update.mockImplementation(() => makeChain());
    db.select.mockImplementation(() => makeChain([{ replyToAddress: null, repliesCount: 0 }]));

    const out = await svc.updateStatus(7, 'paused');
    expect(out.status).toBe('paused');
    expect(db.update).toHaveBeenCalled();
  });

  it('deleteCampaign removes local row', async () => {
    (client.deleteCampaign as jest.Mock).mockResolvedValue(undefined);
    db.delete.mockImplementation(() => makeChain());
    await svc.deleteCampaign(7);
    expect(client.deleteCampaign).toHaveBeenCalled();
    expect(db.delete).toHaveBeenCalled();
  });

  it('updateCampaign moves scheduled to draft then PUT and re-schedules', async () => {
    (client.fetchCampaign as jest.Mock).mockResolvedValue({
      ...sampleCampaign,
      status: 'scheduled',
    });
    (client.updateCampaignStatus as jest.Mock)
      .mockResolvedValueOnce({ ...sampleCampaign, status: 'draft' })
      .mockResolvedValueOnce({ ...sampleCampaign, status: 'scheduled', name: 'Updated' });
    (client.updateCampaign as jest.Mock).mockResolvedValue({
      ...sampleCampaign,
      name: 'Updated',
      status: 'draft',
    });
    db.select.mockImplementation(() =>
      makeChain([{ id: 'crm-1', replyToAddress: null, repliesCount: 0 }]),
    );
    db.update.mockImplementation(() => makeChain());

    const out = await svc.updateCampaign(7, {
      name: 'Updated',
      subject: 'Hello',
      lists: [1],
      type: 'regular',
      contentType: 'html',
      body: '<p>Hi</p>',
      sendAt: '2026-09-01T09:00:00.000Z',
    });

    expect(client.updateCampaignStatus).toHaveBeenCalledWith(expect.any(Object), 7, 'draft');
    expect(client.updateCampaign).toHaveBeenCalled();
    expect(client.updateCampaignStatus).toHaveBeenCalledWith(expect.any(Object), 7, 'scheduled');
    expect(out.name).toBe('Updated');
  });
});
