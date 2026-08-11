import type { McpServer } from '@modelcontextprotocol/server';
import { HttpException, HttpStatus } from '@nestjs/common';
import { z } from 'zod';

const MAX_PAGE_SIZE = 50;

function jsonResult(data: unknown) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }],
  };
}

function notFound(entity: string, id: string) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify({ error: 'not_found', entity, id }) }],
    isError: true as const,
  };
}

function errorResult(err: unknown) {
  if (err instanceof HttpException) {
    const status = err.getStatus();
    const body = err.getResponse();
    const message =
      typeof body === 'string'
        ? body
        : typeof body === 'object' && body !== null && 'message' in body
          ? String((body as { message: unknown }).message)
          : err.message;
    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify({
            error: status === HttpStatus.NOT_FOUND ? 'not_found' : 'request_failed',
            status,
            message,
          }),
        },
      ],
      isError: true as const,
    };
  }
  throw err;
}

/** Host mail services injected via @khirby/plugin-host tokens (ADR-0019). */
export type McpMailServices = {
  threads: {
    listThreads: (opts: {
      contactId?: string;
      leadId?: string;
      page?: number;
      pageSize?: number;
    }) => Promise<unknown>;
    getThread: (id: string) => Promise<unknown>;
  };
  send: {
    createThread: (input: {
      contactId?: string;
      leadId?: string;
      toAddress?: string;
      subject: string;
      bodyText: string;
      sentByUserId: string;
    }) => Promise<unknown>;
    reply: (input: {
      threadId: string;
      bodyText: string;
      sentByUserId: string;
    }) => Promise<unknown>;
  };
};

/** Register email thread tools (read + attributed outbound send/reply). */
export function registerMailTools(server: McpServer, svc: McpMailServices): void {
  server.registerTool(
    'list_email_threads',
    {
      description:
        'List email threads (CRM mailbox), newest first. Optionally filter by contact or lead. Paginated.',
      inputSchema: z.object({
        contactId: z.string().uuid().optional().describe('Filter by contact UUID'),
        leadId: z.string().uuid().optional().describe('Filter by lead UUID'),
        page: z.number().int().min(1).optional().describe('Page number (default 1)'),
        pageSize: z
          .number()
          .int()
          .min(1)
          .max(MAX_PAGE_SIZE)
          .optional()
          .describe(`Page size (default 20, max ${MAX_PAGE_SIZE})`),
      }),
    },
    async ({ contactId, leadId, page, pageSize }) => {
      const result = await svc.threads.listThreads({
        contactId,
        leadId,
        page: page ?? 1,
        pageSize: pageSize ?? 20,
      });
      return jsonResult(result);
    },
  );

  server.registerTool(
    'get_email_thread',
    {
      description:
        'Get an email thread by ID with all messages (plain-text bodies). Includes inbound and outbound mail.',
      inputSchema: z.object({
        id: z.string().uuid().describe('Email thread UUID'),
      }),
    },
    async ({ id }) => {
      try {
        const thread = await svc.threads.getThread(id);
        return jsonResult(thread);
      } catch (err) {
        if (err instanceof HttpException && err.getStatus() === HttpStatus.NOT_FOUND) {
          return notFound('emailThread', id);
        }
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    'send_email',
    {
      description:
        'Send a new outbound email via the firm mailbox and create a CRM thread. Requires sentByUserId (use list_lead_assignees). Provide contactId and/or leadId, or toAddress.',
      inputSchema: z.object({
        sentByUserId: z
          .string()
          .uuid()
          .describe('CRM user UUID attributed as sender (from list_lead_assignees)'),
        subject: z.string().min(1).describe('Email subject'),
        bodyText: z.string().min(1).describe('Plain-text body'),
        contactId: z.string().uuid().optional().describe('Contact UUID (uses contact email)'),
        leadId: z.string().uuid().optional().describe('Lead UUID (resolves contact if needed)'),
        toAddress: z
          .string()
          .email()
          .optional()
          .describe('Recipient email when contactId is not provided'),
      }),
    },
    async ({ sentByUserId, subject, bodyText, contactId, leadId, toAddress }) => {
      try {
        const result = await svc.send.createThread({
          sentByUserId,
          subject,
          bodyText,
          contactId,
          leadId,
          toAddress,
        });
        return jsonResult(result);
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    'reply_email',
    {
      description:
        'Reply to an existing email thread via the firm mailbox. Requires sentByUserId (use list_lead_assignees).',
      inputSchema: z.object({
        threadId: z.string().uuid().describe('Email thread UUID'),
        bodyText: z.string().min(1).describe('Plain-text reply body'),
        sentByUserId: z
          .string()
          .uuid()
          .describe('CRM user UUID attributed as sender (from list_lead_assignees)'),
      }),
    },
    async ({ threadId, bodyText, sentByUserId }) => {
      try {
        const result = await svc.send.reply({ threadId, bodyText, sentByUserId });
        return jsonResult(result);
      } catch (err) {
        return errorResult(err);
      }
    },
  );
}
