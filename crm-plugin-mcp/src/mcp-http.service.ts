import { Injectable, Inject, Logger, OnModuleInit } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { createMcpHandler, McpServer } from '@modelcontextprotocol/server';
import { toNodeHandler } from '@modelcontextprotocol/node';
import {
  PLUGIN_REGISTRY,
  CONTACTS_SERVICE,
  LEADS_SERVICE,
  PIPELINE_STAGES_SERVICE,
  MAIL_THREAD_SERVICE,
  MAIL_SEND_SERVICE,
  BOARD_PROJECTS_SERVICE,
  BOARD_MODULES_SERVICE,
  BOARD_TASKS_SERVICE,
  BOARD_STATUSES_SERVICE,
  type PluginRegistryLike,
} from '../../../packages/plugin-host/src';
import { MCP_PLUGIN_NAME, McpTokenService, parseBearerToken } from './mcp-token.service';
import { registerCrmTools } from './tools/crm-tools';
import { registerMailTools } from './tools/mail-tools';
import { registerBoardTools } from './tools/board-tools';

const MCP_PATH = '/api/mcp';
const THROTTLE_WINDOW_MS = 60_000;
const THROTTLE_MAX = 120;

@Injectable()
export class McpHttpService implements OnModuleInit {
  private readonly logger = new Logger(McpHttpService.name);
  private mounted = false;
  /** Simple per-IP sliding window for the raw Fastify route (bypasses Nest ThrottlerGuard). */
  private readonly hits = new Map<string, number[]>();

  constructor(
    private readonly httpAdapterHost: HttpAdapterHost,
    @Inject(PLUGIN_REGISTRY) private readonly registry: PluginRegistryLike,
    private readonly tokens: McpTokenService,
    @Inject(CONTACTS_SERVICE) private readonly contacts: any,
    @Inject(LEADS_SERVICE) private readonly leads: any,
    @Inject(PIPELINE_STAGES_SERVICE) private readonly stages: any,
    @Inject(MAIL_THREAD_SERVICE) private readonly mailThreads: any,
    @Inject(MAIL_SEND_SERVICE) private readonly mailSend: any,
    @Inject(BOARD_PROJECTS_SERVICE) private readonly boardProjects: any,
    @Inject(BOARD_MODULES_SERVICE) private readonly boardModules: any,
    @Inject(BOARD_TASKS_SERVICE) private readonly boardTasks: any,
    @Inject(BOARD_STATUSES_SERVICE) private readonly boardStatuses: any,
  ) {}

  onModuleInit(): void {
    if (this.mounted) return;
    const adapter = this.httpAdapterHost.httpAdapter;
    if (!adapter) {
      this.logger.warn('No HTTP adapter — MCP endpoint not mounted');
      return;
    }

    const fastify = adapter.getInstance() as {
      all: (
        path: string,
        handler: (request: FastifyLikeRequest, reply: FastifyLikeReply) => Promise<void> | void,
      ) => void;
    };

    // `auto`: JSON for simple tool results; SSE only when the protocol needs a
    // stream. Explicit `json` works for our tools but the MCP SDK prints a
    // console.warn on every boot about dropped mid-call notifications.
    const mcpHandler = createMcpHandler(
      () => {
        const server = new McpServer({ name: 'bearly-crm', version: '1.0.0' });
        registerCrmTools(server, {
          contacts: this.contacts,
          leads: this.leads,
          stages: this.stages,
        });
        registerMailTools(server, {
          threads: this.mailThreads,
          send: this.mailSend,
        });
        registerBoardTools(server, {
          projects: this.boardProjects,
          modules: this.boardModules,
          tasks: this.boardTasks,
          statuses: this.boardStatuses,
        });
        return server;
      },
      { responseMode: 'auto' },
    );

    const nodeHandler = toNodeHandler(mcpHandler);

    fastify.all(MCP_PATH, async (request, reply) => {
      const ip =
        (typeof (request as { ip?: string }).ip === 'string'
          ? (request as { ip?: string }).ip
          : undefined) ?? 'unknown';
      if (!this.allowRequest(ip)) {
        reply.code(429).header('Content-Type', 'application/json').send({
          error: 'rate_limited',
          message: 'Too many MCP requests',
        });
        return;
      }

      const plugin = await this.registry.findByName(MCP_PLUGIN_NAME);
      if (!plugin?.enabled) {
        reply.code(503).header('Content-Type', 'application/json').send({
          error: 'service_unavailable',
          message: 'MCP plugin is disabled',
        });
        return;
      }

      const hasToken = await this.tokens.hasConfiguredToken();
      if (!hasToken) {
        reply.code(503).header('Content-Type', 'application/json').send({
          error: 'service_unavailable',
          message: 'MCP access token is not configured',
        });
        return;
      }

      const authHeader =
        typeof request.headers.authorization === 'string'
          ? request.headers.authorization
          : undefined;
      const bearer = parseBearerToken(authHeader);
      if (!bearer || !(await this.tokens.verify(bearer))) {
        reply
          .code(401)
          .header('WWW-Authenticate', 'Bearer')
          .header('Content-Type', 'application/json')
          .send({ error: 'invalid_token', message: 'Missing or invalid access token' });
        return;
      }

      // Hijack Nest/Fastify reply so toNodeHandler owns the Node response.
      reply.hijack();
      const rawReq = Object.assign(request.raw, {
        auth: { token: bearer, clientId: 'mcp-agent', scopes: [] as string[] },
      });
      await Promise.resolve(
        nodeHandler(
          rawReq as Parameters<typeof nodeHandler>[0],
          reply.raw as Parameters<typeof nodeHandler>[1],
          request.body,
        ),
      );
    });

    this.mounted = true;
    this.logger.log(`MCP Streamable HTTP mounted at ${MCP_PATH}`);
  }

  private allowRequest(ip: string): boolean {
    const now = Date.now();
    const windowStart = now - THROTTLE_WINDOW_MS;
    const prev = this.hits.get(ip)?.filter((t) => t > windowStart) ?? [];
    if (prev.length >= THROTTLE_MAX) {
      this.hits.set(ip, prev);
      return false;
    }
    prev.push(now);
    this.hits.set(ip, prev);
    return true;
  }
}

type FastifyLikeRequest = {
  headers: Record<string, string | string[] | undefined>;
  body: unknown;
  raw: object;
};

type FastifyLikeReply = {
  code: (status: number) => FastifyLikeReply;
  header: (name: string, value: string) => FastifyLikeReply;
  send: (body: unknown) => void;
  hijack: () => void;
  raw: object;
};
