import type { McpServer } from '@modelcontextprotocol/server';
import { HttpException, HttpStatus } from '@nestjs/common';
import { z } from 'zod';
import type {
  BoardModulesServiceLike,
  BoardProjectsServiceLike,
  BoardStatusesServiceLike,
  BoardTasksServiceLike,
} from '../../../../packages/plugin-host/src';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const IDENTIFIER_PREFIX_RE = /^([A-Za-z0-9]{1,10}-\d+)/i;

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

async function resolveTask(tasks: BoardTasksServiceLike, idOrKey: string) {
  if (UUID_RE.test(idOrKey)) return tasks.findById(idOrKey);
  const match = idOrKey.trim().match(IDENTIFIER_PREFIX_RE);
  const identifier = (match?.[1] ?? idOrKey).toUpperCase();
  return tasks.findByIdentifier(identifier);
}

export type McpBoardServices = {
  projects: BoardProjectsServiceLike;
  modules: BoardModulesServiceLike;
  tasks: BoardTasksServiceLike;
  statuses: BoardStatusesServiceLike;
};

const prioritySchema = z.enum(['low', 'medium', 'high', 'urgent']);

/**
 * Work-board MCP tools (ADR-0027). Distinct from sales `get_leads_board`.
 * Mutations that create/update tasks require `actorUserId` (MCP bearer has no user).
 * Hard deletes are intentionally omitted — agents cancel via `move_board_task` to
 * Canceled; permanent delete stays in the CRM UI with human confirmation.
 */
export function registerBoardTools(server: McpServer, svc: McpBoardServices): void {
  // ── Projects ──────────────────────────────────────────────────────────────

  server.registerTool(
    'list_board_projects',
    {
      description: 'List work-board projects (Boards module, not sales pipeline).',
      inputSchema: z.object({}),
    },
    async () => jsonResult(await svc.projects.findAll()),
  );

  server.registerTool(
    'get_board_project',
    {
      description: 'Get a work-board project by UUID.',
      inputSchema: z.object({
        id: z.string().uuid().describe('Project UUID'),
      }),
    },
    async ({ id }) => {
      try {
        return jsonResult(await svc.projects.findById(id));
      } catch (err) {
        if (err instanceof HttpException && err.getStatus() === HttpStatus.NOT_FOUND) {
          return notFound('boardProject', id);
        }
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    'create_board_project',
    {
      description:
        'Create a work-board project (seeds default module + statuses). Requires actorUserId.',
      inputSchema: z.object({
        name: z.string().min(1).max(200).describe('Project name'),
        description: z.string().optional(),
        color: z.string().optional().describe('Hex color'),
        key: z
          .string()
          .min(2)
          .max(10)
          .optional()
          .describe('Short key for task IDs (e.g. FIN). Derived from name when omitted.'),
        actorUserId: z.string().uuid().describe('CRM user UUID attributing the create'),
      }),
    },
    async ({ actorUserId, ...dto }) => {
      try {
        return jsonResult(await svc.projects.create(dto, actorUserId));
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    'update_board_project',
    {
      description: 'Update a work-board project.',
      inputSchema: z.object({
        id: z.string().uuid(),
        name: z.string().min(1).max(200).optional(),
        description: z.string().nullable().optional(),
        color: z.string().optional(),
        key: z.string().min(2).max(10).optional(),
      }),
    },
    async ({ id, ...dto }) => {
      try {
        return jsonResult(await svc.projects.update(id, dto));
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  // ── Modules ───────────────────────────────────────────────────────────────

  server.registerTool(
    'list_board_modules',
    {
      description: 'List modules (kanban boards) in a project.',
      inputSchema: z.object({
        projectId: z.string().uuid(),
      }),
    },
    async ({ projectId }) => jsonResult(await svc.modules.findByProject(projectId)),
  );

  server.registerTool(
    'get_module_board',
    {
      description: 'Get a module board: statuses + top-level tasks for kanban.',
      inputSchema: z.object({
        moduleId: z.string().uuid(),
      }),
    },
    async ({ moduleId }) => {
      try {
        return jsonResult(await svc.tasks.findByModule(moduleId));
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    'create_board_module',
    {
      description: 'Create a module (kanban board) in a project.',
      inputSchema: z.object({
        projectId: z.string().uuid(),
        name: z.string().min(1).max(200),
        description: z.string().optional(),
        position: z.number().int().min(0).optional(),
      }),
    },
    async (dto) => {
      try {
        return jsonResult(await svc.modules.create(dto));
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    'update_board_module',
    {
      description: 'Update a board module name/description.',
      inputSchema: z.object({
        id: z.string().uuid(),
        name: z.string().min(1).max(200).optional(),
        description: z.string().nullable().optional(),
      }),
    },
    async ({ id, ...dto }) => {
      try {
        return jsonResult(await svc.modules.update(id, dto));
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  // ── Statuses / assignees ──────────────────────────────────────────────────

  server.registerTool(
    'list_board_statuses',
    {
      description:
        'List statuses for a project or module board. Pass projectId or moduleId (module inherits project statuses when empty).',
      inputSchema: z.object({
        projectId: z.string().uuid().optional().describe('Project UUID'),
        moduleId: z.string().uuid().optional().describe('Module UUID (preferred when known)'),
      }),
    },
    async ({ projectId, moduleId }) => {
      try {
        if (!projectId && !moduleId) {
          return {
            content: [
              {
                type: 'text' as const,
                text: JSON.stringify({
                  error: 'request_failed',
                  message: 'projectId or moduleId required',
                }),
              },
            ],
            isError: true as const,
          };
        }
        if (moduleId) return jsonResult(await svc.statuses.findByModule(moduleId));
        return jsonResult(await svc.statuses.findByProject(projectId!));
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    'list_board_assignees',
    {
      description:
        'List CRM users that can be assigned to board tasks (also usable as actorUserId).',
      inputSchema: z.object({}),
    },
    async () => jsonResult(await svc.tasks.getAssignees()),
  );

  // ── Tasks ─────────────────────────────────────────────────────────────────

  server.registerTool(
    'list_board_tasks',
    {
      description: 'List tasks in a project with optional filters.',
      inputSchema: z.object({
        projectId: z.string().uuid(),
        moduleId: z.string().uuid().optional(),
        assigneeId: z.string().uuid().optional(),
        statusId: z.string().uuid().optional(),
        priority: prioritySchema.optional(),
        tagId: z.string().uuid().optional(),
      }),
    },
    async ({ projectId, ...filters }) =>
      jsonResult(await svc.tasks.findByProject(projectId, filters)),
  );

  server.registerTool(
    'get_board_task',
    {
      description:
        'Get a board task by UUID, identifier (FIN-01), or friendly ref (FIN-01-title-slug).',
      inputSchema: z.object({
        id: z.string().min(1).describe('Task UUID, KEY-NN, or KEY-NN-title-slug'),
      }),
    },
    async ({ id }) => {
      try {
        return jsonResult(await resolveTask(svc.tasks, id));
      } catch (err) {
        if (err instanceof HttpException && err.getStatus() === HttpStatus.NOT_FOUND) {
          return notFound('boardTask', id);
        }
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    'create_board_task',
    {
      description: 'Create a task on a module board. Requires actorUserId.',
      inputSchema: z.object({
        moduleId: z.string().uuid(),
        title: z.string().min(1).max(500),
        description: z.string().optional().describe('Markdown body'),
        priority: prioritySchema.optional(),
        statusId: z.string().uuid().optional(),
        parentTaskId: z.string().uuid().optional(),
        dueDate: z.string().nullable().optional().describe('ISO date/datetime or null'),
        leadId: z.string().uuid().nullable().optional(),
        assigneeIds: z.array(z.string().uuid()).optional(),
        tagIds: z.array(z.string().uuid()).optional(),
        actorUserId: z.string().uuid().describe('CRM user UUID attributing the create'),
      }),
    },
    async ({ actorUserId, ...dto }) => {
      try {
        return jsonResult(await svc.tasks.create(dto, actorUserId));
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    'update_board_task',
    {
      description: 'Update a board task fields. Requires actorUserId.',
      inputSchema: z.object({
        id: z.string().uuid(),
        title: z.string().min(1).max(500).optional(),
        description: z.string().nullable().optional(),
        priority: prioritySchema.optional(),
        statusId: z.string().uuid().nullable().optional(),
        dueDate: z.string().nullable().optional().describe('ISO date/datetime or null'),
        leadId: z.string().uuid().nullable().optional(),
        moduleId: z.string().uuid().optional(),
        assigneeIds: z.array(z.string().uuid()).optional(),
        tagIds: z.array(z.string().uuid()).optional(),
        actorUserId: z.string().uuid(),
      }),
    },
    async ({ id, actorUserId, ...dto }) => {
      try {
        return jsonResult(await svc.tasks.update(id, dto, actorUserId));
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    'move_board_task',
    {
      description:
        'Move a task to a status column and position on the kanban. Requires actorUserId. To retire a task, move it to the Canceled status (7-day purge); hard delete is not available via MCP — use the CRM UI.',
      inputSchema: z.object({
        id: z.string().uuid(),
        statusId: z.string().uuid(),
        position: z.number().int().min(0),
        actorUserId: z.string().uuid(),
      }),
    },
    async ({ id, statusId, position, actorUserId }) => {
      try {
        return jsonResult(await svc.tasks.updateStatus(id, statusId, position, actorUserId));
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    'add_board_task_comment',
    {
      description: 'Add a markdown comment on a board task. Requires actorUserId.',
      inputSchema: z.object({
        id: z.string().uuid(),
        body: z.string().min(1).max(5000),
        actorUserId: z.string().uuid(),
      }),
    },
    async ({ id, body, actorUserId }) => {
      try {
        return jsonResult(await svc.tasks.addComment(id, body, actorUserId));
      } catch (err) {
        return errorResult(err);
      }
    },
  );
}
