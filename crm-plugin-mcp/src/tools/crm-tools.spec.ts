import { ConflictException } from '@nestjs/common';
import { registerCrmTools } from './crm-tools';

describe('registerCrmTools', () => {
  const contacts = {
    findAll: jest.fn(),
    findById: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  };
  const leads = {
    getBoard: jest.fn(),
    findById: jest.fn(),
    getAssignees: jest.fn(),
    createManual: jest.fn(),
    update: jest.fn(),
  };
  const stages = {
    ensureDefaults: jest.fn(),
    findAll: jest.fn(),
  };

  const handlers = new Map<string, (args: Record<string, unknown>) => Promise<unknown>>();

  beforeEach(() => {
    jest.clearAllMocks();
    handlers.clear();
    const server = {
      registerTool: (
        name: string,
        _meta: unknown,
        handler: (args: Record<string, unknown>) => Promise<unknown>,
      ) => {
        handlers.set(name, handler);
      },
    };
    registerCrmTools(server as never, {
      contacts: contacts as never,
      leads: leads as never,
      stages: stages as never,
    });
  });

  it('registers read + create/update tools without delete', () => {
    expect([...handlers.keys()].sort()).toEqual([
      'create_contact',
      'create_lead',
      'get_contact',
      'get_lead',
      'get_leads_board',
      'list_contacts',
      'list_lead_assignees',
      'list_pipeline_stages',
      'update_contact',
      'update_lead',
    ]);
    expect(handlers.has('delete_contact')).toBe(false);
    expect(handlers.has('delete_lead')).toBe(false);
  });

  it('list_contacts passes a query object to ContactsService.findAll', async () => {
    contacts.findAll.mockResolvedValue({ data: [], total: 0, page: 1, pageSize: 20 });
    const result = (await handlers.get('list_contacts')!({
      page: 2,
      pageSize: 10,
      search: 'a',
    })) as {
      content: { text: string }[];
    };
    expect(contacts.findAll).toHaveBeenCalledWith({ page: 2, pageSize: 10, search: 'a' });
    expect(JSON.parse(result.content[0]!.text)).toEqual({
      data: [],
      total: 0,
      page: 1,
      pageSize: 20,
    });
  });

  it('get_contact returns isError when missing', async () => {
    contacts.findById.mockResolvedValue(null);
    const result = (await handlers.get('get_contact')!({
      id: '00000000-0000-4000-8000-000000000001',
    })) as { isError?: boolean };
    expect(result.isError).toBe(true);
  });

  it('create_contact delegates and maps conflicts to isError', async () => {
    contacts.create.mockResolvedValue({ id: 'c1', email: 'a@b.c' });
    const ok = (await handlers.get('create_contact')!({
      email: 'a@b.c',
      name: 'Ada',
    })) as { content: { text: string }[] };
    expect(contacts.create).toHaveBeenCalledWith({ email: 'a@b.c', name: 'Ada' });
    expect(JSON.parse(ok.content[0]!.text)).toMatchObject({ email: 'a@b.c' });

    contacts.create.mockRejectedValue(new ConflictException('dup'));
    const err = (await handlers.get('create_contact')!({ email: 'a@b.c' })) as {
      isError?: boolean;
    };
    expect(err.isError).toBe(true);
  });

  it('create_lead and update_lead delegate', async () => {
    leads.createManual.mockResolvedValue({ id: 'l1', title: 'Deal' });
    await handlers.get('create_lead')!({ email: 'x@y.z', title: 'Deal', priority: 'high' });
    expect(leads.createManual).toHaveBeenCalledWith({
      email: 'x@y.z',
      title: 'Deal',
      priority: 'high',
    });

    const id = '00000000-0000-4000-8000-000000000010';
    leads.update.mockResolvedValue({ id, title: 'New' });
    await handlers.get('update_lead')!({ id, title: 'New', stageId: id });
    expect(leads.update).toHaveBeenCalledWith(id, { title: 'New', stageId: id });
  });

  it('get_leads_board and list_pipeline_stages and assignees delegate', async () => {
    leads.getBoard.mockResolvedValue({ columns: [] });
    stages.ensureDefaults.mockResolvedValue(undefined);
    stages.findAll.mockResolvedValue([{ id: 's1' }]);
    leads.getAssignees.mockResolvedValue([{ id: 'u1', email: 'a@b.c' }]);

    await handlers.get('get_leads_board')!({ ownerId: '00000000-0000-4000-8000-000000000002' });
    expect(leads.getBoard).toHaveBeenCalledWith('00000000-0000-4000-8000-000000000002');

    const stagesResult = (await handlers.get('list_pipeline_stages')!({})) as {
      content: { text: string }[];
    };
    expect(stages.ensureDefaults).toHaveBeenCalled();
    expect(JSON.parse(stagesResult.content[0]!.text)).toEqual([{ id: 's1' }]);

    await handlers.get('list_lead_assignees')!({});
    expect(leads.getAssignees).toHaveBeenCalled();
  });
});
