import { NotFoundException } from '@nestjs/common';
import { registerBoardTools } from './board-tools';

describe('registerBoardTools', () => {
  const projects = {
    findAll: jest.fn(),
    findById: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  };
  const modules = {
    findByProject: jest.fn(),
    findById: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  };
  const tasks = {
    findByProject: jest.fn(),
    findByModule: jest.fn(),
    findById: jest.fn(),
    findByIdentifier: jest.fn(),
    getAssignees: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    updateStatus: jest.fn(),
    addComment: jest.fn(),
    delete: jest.fn(),
  };
  const statuses = {
    findByProject: jest.fn(),
    findByModule: jest.fn(),
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
    registerBoardTools(server as never, {
      projects: projects as never,
      modules: modules as never,
      tasks: tasks as never,
      statuses: statuses as never,
    });
  });

  it('registers board tools without hard-delete', () => {
    expect(handlers.has('list_board_projects')).toBe(true);
    expect(handlers.has('create_board_project')).toBe(true);
    expect(handlers.has('create_board_task')).toBe(true);
    expect(handlers.has('move_board_task')).toBe(true);
    expect(handlers.has('get_module_board')).toBe(true);
    expect(handlers.has('delete_board_project')).toBe(false);
    expect(handlers.has('delete_board_module')).toBe(false);
    expect(handlers.has('delete_board_task')).toBe(false);
  });

  it('create_board_task passes actorUserId as userId', async () => {
    const moduleId = '00000000-0000-4000-8000-000000000001';
    const actorUserId = '00000000-0000-4000-8000-000000000002';
    tasks.create.mockResolvedValue({ id: 't1', title: 'Hi' });

    const result = (await handlers.get('create_board_task')!({
      moduleId,
      title: 'Hi',
      actorUserId,
    })) as { content: { text: string }[] };

    expect(tasks.create).toHaveBeenCalledWith(
      expect.objectContaining({ moduleId, title: 'Hi' }),
      actorUserId,
    );
    expect(JSON.parse(result.content[0]!.text)).toEqual({ id: 't1', title: 'Hi' });
  });

  it('get_board_task resolves identifier when not a UUID', async () => {
    tasks.findByIdentifier.mockResolvedValue({ id: 't1', identifier: 'FIN-01' });
    const result = (await handlers.get('get_board_task')!({ id: 'FIN-01' })) as {
      content: { text: string }[];
    };
    expect(tasks.findByIdentifier).toHaveBeenCalledWith('FIN-01');
    expect(tasks.findById).not.toHaveBeenCalled();
    expect(JSON.parse(result.content[0]!.text)).toMatchObject({ identifier: 'FIN-01' });
  });

  it('get_board_task returns isError when missing', async () => {
    const id = '00000000-0000-4000-8000-000000000099';
    tasks.findById.mockRejectedValue(new NotFoundException('missing'));
    const result = (await handlers.get('get_board_task')!({ id })) as {
      isError?: boolean;
      content: { text: string }[];
    };
    expect(result.isError).toBe(true);
    expect(JSON.parse(result.content[0]!.text)).toMatchObject({
      error: 'not_found',
      entity: 'boardTask',
      id,
    });
  });

  it('move_board_task passes actorUserId through', async () => {
    const id = '00000000-0000-4000-8000-000000000010';
    const statusId = '00000000-0000-4000-8000-000000000011';
    const actorUserId = '00000000-0000-4000-8000-000000000002';
    tasks.updateStatus.mockResolvedValue({ id, statusId });
    const result = (await handlers.get('move_board_task')!({
      id,
      statusId,
      position: 0,
      actorUserId,
    })) as { content: { text: string }[] };
    expect(tasks.updateStatus).toHaveBeenCalledWith(id, statusId, 0, actorUserId);
    expect(JSON.parse(result.content[0]!.text)).toMatchObject({ id, statusId });
  });
});
