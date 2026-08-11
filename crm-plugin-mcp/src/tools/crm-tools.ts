import type { McpServer } from '@modelcontextprotocol/server';
import { HttpException, HttpStatus } from '@nestjs/common';
import { z } from 'zod';
import type {
  ContactsServiceLike,
  LeadsServiceLike,
  PipelineStagesServiceLike,
} from '../../../../packages/plugin-host/src';

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

/** Host CRM services injected via @khirby/plugin-host tokens (ADR-0016, ADR-0028). */
export type McpCrmServices = {
  contacts: ContactsServiceLike;
  leads: LeadsServiceLike;
  stages: PipelineStagesServiceLike;
};

const leadPrioritySchema = z.enum(['low', 'medium', 'high']);

/**
 * CRM contacts + leads MCP tools (ADR-0013 read; ADR-0028 create/update).
 * Hard deletes stay in the CRM UI — same policy as boards (ADR-0027).
 */
export function registerCrmTools(server: McpServer, svc: McpCrmServices): void {
  server.registerTool(
    'list_contacts',
    {
      description: 'List contacts with optional email/name search. Paginated.',
      inputSchema: z.object({
        page: z.number().int().min(1).optional().describe('Page number (default 1)'),
        pageSize: z
          .number()
          .int()
          .min(1)
          .max(MAX_PAGE_SIZE)
          .optional()
          .describe(`Page size (default 20, max ${MAX_PAGE_SIZE})`),
        search: z.string().optional().describe('Filter by email or name (case-insensitive)'),
      }),
    },
    async ({ page, pageSize, search }) => {
      const result = await svc.contacts.findAll({
        page: page ?? 1,
        pageSize: pageSize ?? 20,
        search,
      });
      return jsonResult(result);
    },
  );

  server.registerTool(
    'get_contact',
    {
      description: 'Get a contact by ID, including form submissions.',
      inputSchema: z.object({
        id: z.string().uuid().describe('Contact UUID'),
      }),
    },
    async ({ id }) => {
      try {
        const contact = await svc.contacts.findById(id);
        if (!contact) return notFound('contact', id);
        return jsonResult(contact);
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    'create_contact',
    {
      description: 'Create a contact. Email must be unique.',
      inputSchema: z.object({
        email: z.string().email().describe('Contact email (unique)'),
        name: z.string().optional().describe('Display name'),
        phone: z.string().optional().describe('Phone number'),
        metadata: z.record(z.string(), z.unknown()).optional().describe('Arbitrary JSON metadata'),
      }),
    },
    async (dto) => {
      try {
        return jsonResult(await svc.contacts.create(dto));
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    'update_contact',
    {
      description: 'Update a contact by ID. Pass only fields to change.',
      inputSchema: z.object({
        id: z.string().uuid().describe('Contact UUID'),
        email: z.string().email().optional().describe('New email (must stay unique)'),
        name: z.string().optional().describe('Display name'),
        phone: z.string().nullable().optional().describe('Phone number; null clears'),
        metadata: z.record(z.string(), z.unknown()).optional().describe('Replaces metadata object'),
      }),
    },
    async ({ id, ...dto }) => {
      try {
        return jsonResult(await svc.contacts.update(id, dto));
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    'get_leads_board',
    {
      description: 'Get the leads kanban board (stages with leads). Optionally filter by owner.',
      inputSchema: z.object({
        ownerId: z.string().uuid().optional().describe('Filter leads by owner user UUID'),
      }),
    },
    async ({ ownerId }) => {
      const board = await svc.leads.getBoard(ownerId);
      return jsonResult(board);
    },
  );

  server.registerTool(
    'get_lead',
    {
      description: 'Get a lead by ID, including contact, submission, and comments.',
      inputSchema: z.object({
        id: z.string().uuid().describe('Lead UUID'),
      }),
    },
    async ({ id }) => {
      try {
        const lead = await svc.leads.findById(id);
        if (!lead) return notFound('lead', id);
        return jsonResult(lead);
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    'create_lead',
    {
      description:
        'Create a manual lead (upserts contact by email). Optional stageId defaults to first pipeline stage; ownerId from list_lead_assignees.',
      inputSchema: z.object({
        email: z.string().email().describe('Contact email (creates/upserts contact)'),
        name: z.string().optional().describe('Contact name'),
        title: z.string().optional().describe('Lead title (defaults to name or email)'),
        value: z.string().optional().describe('Deal value as string'),
        priority: leadPrioritySchema.optional().describe('Priority (default medium)'),
        stageId: z.string().uuid().optional().describe('Pipeline stage UUID'),
        ownerId: z.string().uuid().optional().describe('Owner user UUID'),
      }),
    },
    async (dto) => {
      try {
        return jsonResult(await svc.leads.createManual(dto));
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    'update_lead',
    {
      description:
        'Update a lead (title, value, priority, stage, owner). Changing stageId moves the card on the board.',
      inputSchema: z.object({
        id: z.string().uuid().describe('Lead UUID'),
        title: z.string().optional(),
        value: z.string().nullable().optional().describe('Deal value; null clears'),
        priority: leadPrioritySchema.optional(),
        stageId: z.string().uuid().optional().describe('Move to this pipeline stage'),
        ownerId: z
          .string()
          .uuid()
          .nullable()
          .optional()
          .describe('Owner user UUID; null unassigns'),
      }),
    },
    async ({ id, ...dto }) => {
      try {
        return jsonResult(await svc.leads.update(id, dto));
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    'list_pipeline_stages',
    {
      description: 'List pipeline stages in board order.',
      inputSchema: z.object({}),
    },
    async () => {
      await svc.stages.ensureDefaults();
      const stages = await svc.stages.findAll();
      return jsonResult(stages);
    },
  );

  server.registerTool(
    'list_lead_assignees',
    {
      description: 'List users that can be assigned as lead owners.',
      inputSchema: z.object({}),
    },
    async () => {
      const assignees = await svc.leads.getAssignees();
      return jsonResult(assignees);
    },
  );
}
