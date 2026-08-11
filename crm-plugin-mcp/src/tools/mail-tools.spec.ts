import { NotFoundException, BadRequestException } from '@nestjs/common';
import { registerMailTools } from './mail-tools';

describe('registerMailTools', () => {
  const threads = {
    listThreads: jest.fn(),
    getThread: jest.fn(),
  };
  const send = {
    createThread: jest.fn(),
    reply: jest.fn(),
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
    registerMailTools(server as never, {
      threads: threads as never,
      send: send as never,
    });
  });

  it('registers the four mail tools', () => {
    expect([...handlers.keys()].sort()).toEqual([
      'get_email_thread',
      'list_email_threads',
      'reply_email',
      'send_email',
    ]);
  });

  it('list_email_threads delegates to MailThreadService.listThreads', async () => {
    threads.listThreads.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20 });
    const contactId = '00000000-0000-4000-8000-000000000001';
    const result = (await handlers.get('list_email_threads')!({
      contactId,
      page: 2,
      pageSize: 10,
    })) as { content: { text: string }[] };

    expect(threads.listThreads).toHaveBeenCalledWith({
      contactId,
      leadId: undefined,
      page: 2,
      pageSize: 10,
    });
    expect(JSON.parse(result.content[0].text)).toEqual({
      items: [],
      total: 0,
      page: 1,
      pageSize: 20,
    });
  });

  it('get_email_thread returns isError when missing', async () => {
    const id = '00000000-0000-4000-8000-000000000002';
    threads.getThread.mockRejectedValue(new NotFoundException('missing'));
    const result = (await handlers.get('get_email_thread')!({ id })) as {
      isError?: boolean;
      content: { text: string }[];
    };
    expect(result.isError).toBe(true);
    expect(JSON.parse(result.content[0].text)).toMatchObject({
      error: 'not_found',
      entity: 'emailThread',
      id,
    });
  });

  it('get_email_thread returns the thread payload', async () => {
    const id = '00000000-0000-4000-8000-000000000003';
    threads.getThread.mockResolvedValue({
      id,
      subject: 'Hello',
      messages: [{ direction: 'inbound', bodyText: 'hi' }],
    });
    const result = (await handlers.get('get_email_thread')!({ id })) as {
      content: { text: string }[];
    };
    expect(JSON.parse(result.content[0].text)).toEqual({
      id,
      subject: 'Hello',
      messages: [{ direction: 'inbound', bodyText: 'hi' }],
    });
  });

  it('send_email and reply_email delegate with sentByUserId', async () => {
    const userId = '00000000-0000-4000-8000-000000000010';
    const threadId = '00000000-0000-4000-8000-000000000011';
    send.createThread.mockResolvedValue({ threadId, messageId: 'm1' });
    send.reply.mockResolvedValue({ messageId: 'm2' });

    await handlers.get('send_email')!({
      sentByUserId: userId,
      subject: 'Subj',
      bodyText: 'Body',
      contactId: '00000000-0000-4000-8000-000000000012',
    });
    expect(send.createThread).toHaveBeenCalledWith({
      sentByUserId: userId,
      subject: 'Subj',
      bodyText: 'Body',
      contactId: '00000000-0000-4000-8000-000000000012',
      leadId: undefined,
      toAddress: undefined,
    });

    await handlers.get('reply_email')!({
      threadId,
      bodyText: 'Thanks',
      sentByUserId: userId,
    });
    expect(send.reply).toHaveBeenCalledWith({
      threadId,
      bodyText: 'Thanks',
      sentByUserId: userId,
    });
  });

  it('send_email maps HttpException to isError', async () => {
    send.createThread.mockRejectedValue(new BadRequestException('Mailbox is not configured'));
    const result = (await handlers.get('send_email')!({
      sentByUserId: '00000000-0000-4000-8000-000000000010',
      subject: 'Subj',
      bodyText: 'Body',
      toAddress: 'a@b.c',
    })) as { isError?: boolean; content: { text: string }[] };

    expect(result.isError).toBe(true);
    expect(JSON.parse(result.content[0].text)).toMatchObject({
      error: 'request_failed',
      status: 400,
    });
  });
});
