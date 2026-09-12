import { Injectable, Logger } from '@nestjs/common';
import type {
  KnowledgeContextLike,
  KnowledgeFetchOpts,
  KnowledgeMcpToolDef,
  KnowledgeToolsLike,
} from '@khirby/plugin-host';
import { PokeloSettingsService } from './pokelo-settings.service';
import {
  callMcpTool,
  extractProjectIdArg,
  listMcpTools,
  parseProjectList,
  parseSearchMatches,
} from './pokelo-mcp.client';

const SNIPPET_LIMIT_TOTAL = 8;
const SNIPPET_LIMIT_PER_PROJECT = 3;
const SNIPPET_MAX_CHARS = 800;
const TOOL_RESULT_MAX = 12_000;
const TOOLS_CACHE_TTL_MS = 5 * 60_000;

/** Account-level create would bypass Settings binding (ADR-0050). */
const BLOCKED_MCP_TOOLS = new Set(['create_project']);

@Injectable()
export class PokeloContextService implements KnowledgeContextLike, KnowledgeToolsLike {
  private readonly logger = new Logger(PokeloContextService.name);
  private toolsCache: { at: number; tools: KnowledgeMcpToolDef[] } | null = null;

  constructor(private readonly settings: PokeloSettingsService) {}

  async fetchContext(query: string, opts?: KnowledgeFetchOpts): Promise<string> {
    try {
      if (!(await this.settings.isPluginEnabled())) {
        return '';
      }

      const creds = await this.settings.getCredentials();
      if (!creds?.token || creds.projectIds.length === 0) {
        return '';
      }

      const trimmed = query.trim();
      if (!trimmed) {
        return '';
      }

      const requested = opts?.projectIds?.filter(Boolean) ?? [];
      const targetIds =
        requested.length > 0
          ? requested.filter((id) => creds.projectIds.includes(id))
          : creds.projectIds;

      if (targetIds.length === 0) {
        return '';
      }

      const nameById = await this.resolveNames(creds.baseUrl, creds.token, targetIds);

      const perProjectLimit =
        targetIds.length === 1 ? SNIPPET_LIMIT_TOTAL : SNIPPET_LIMIT_PER_PROJECT;

      const settled = await Promise.all(
        targetIds.map(async (projectId) => {
          try {
            const text = await callMcpTool(creds.baseUrl, creds.token, 'search_documents', {
              projectId,
              query: trimmed.slice(0, 4000),
              limit: perProjectLimit,
            });
            const matches = parseSearchMatches(text)
              .slice(0, perProjectLimit)
              .map((m) => m.slice(0, SNIPPET_MAX_CHARS).trim())
              .filter(Boolean);
            return { projectId, name: nameById.get(projectId) ?? projectId, matches };
          } catch (err) {
            this.logger.warn(`Pokelo search failed for ${projectId}: ${(err as Error).message}`);
            return {
              projectId,
              name: nameById.get(projectId) ?? projectId,
              matches: [] as string[],
            };
          }
        }),
      );

      const labeled: string[] = [];
      for (const block of settled) {
        for (const m of block.matches) {
          labeled.push(`[${block.name}] ${m}`);
          if (labeled.length >= SNIPPET_LIMIT_TOTAL) break;
        }
        if (labeled.length >= SNIPPET_LIMIT_TOTAL) break;
      }

      if (labeled.length === 0) {
        return '';
      }

      return [
        '--- Kontekst z Pokelo ---',
        ...labeled.map((s, i) => `[${i + 1}] ${s}`),
        '--- Koniec kontekstu Pokelo ---',
      ].join('\n\n');
    } catch (err) {
      this.logger.warn(`Pokelo fetchContext failed: ${(err as Error).message}`);
      return '';
    }
  }

  async listTools(): Promise<KnowledgeMcpToolDef[]> {
    if (!(await this.settings.isPluginEnabled())) {
      return [];
    }
    const creds = await this.settings.getCredentials();
    if (!creds?.token || creds.projectIds.length === 0) {
      return [];
    }

    const now = Date.now();
    if (this.toolsCache && now - this.toolsCache.at < TOOLS_CACHE_TTL_MS) {
      return this.toolsCache.tools;
    }

    const tools = (await listMcpTools(creds.baseUrl, creds.token)).filter(
      (t) => !BLOCKED_MCP_TOOLS.has(t.name),
    );
    this.toolsCache = { at: now, tools };
    return tools;
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<string> {
    if (!(await this.settings.isPluginEnabled())) {
      throw new Error('Pokelo plugin is disabled');
    }
    if (BLOCKED_MCP_TOOLS.has(name)) {
      throw new Error(
        `${name} is not available from Ask Khirby — bind projects in Settings → Integrations → Pokelo`,
      );
    }

    const creds = await this.settings.getCredentials();
    if (!creds?.token) {
      throw new Error('Pokelo token is not configured');
    }
    if (creds.projectIds.length === 0) {
      throw new Error(
        'No Pokelo projects bound — select projects in Settings → Integrations → Pokelo',
      );
    }

    const projectId = extractProjectIdArg(args);
    if (projectId && !creds.projectIds.includes(projectId)) {
      throw new Error(`Project ${projectId} is not in the operator-bound Pokelo set`);
    }

    if (name === 'list_projects') {
      const text = await callMcpTool(creds.baseUrl, creds.token, 'list_projects', {
        ...args,
        limit: typeof args.limit === 'number' ? args.limit : 100,
      });
      const all = parseProjectList(text);
      const bound = new Set(creds.projectIds);
      const filtered = all.filter((p) => bound.has(p.id));
      const seen = new Set(filtered.map((p) => p.id));
      for (const id of creds.projectIds) {
        if (!seen.has(id)) filtered.push({ id, name: id });
      }
      const payload = JSON.stringify({
        items: filtered.map((p) => ({ projectId: p.id, name: p.name })),
        total: filtered.length,
      });
      return truncateToolResult(payload);
    }

    if (!projectId) {
      throw new Error(
        `projectId is required and must be one of the bound Pokelo projects (${creds.projectIds.join(', ')})`,
      );
    }

    const text = await callMcpTool(creds.baseUrl, creds.token, name, args);
    return truncateToolResult(text);
  }

  async listProjects(): Promise<Array<{ id: string; name: string }>> {
    const creds = await this.settings.getCredentials();
    if (!creds?.token) {
      return [];
    }

    const text = await callMcpTool(creds.baseUrl, creds.token, 'list_projects', {
      limit: 100,
    });

    return parseProjectList(text);
  }

  async listBoundProjects(): Promise<Array<{ id: string; name: string }>> {
    const creds = await this.settings.getCredentials();
    if (!creds?.token || creds.projectIds.length === 0) {
      return [];
    }
    const all = await this.listProjects().catch(() => [] as Array<{ id: string; name: string }>);
    const byId = new Map(all.map((p) => [p.id, p.name]));
    return creds.projectIds.map((id) => ({ id, name: byId.get(id) ?? id }));
  }

  private async resolveNames(
    baseUrl: string,
    token: string,
    projectIds: string[],
  ): Promise<Map<string, string>> {
    const map = new Map<string, string>();
    try {
      const text = await callMcpTool(baseUrl, token, 'list_projects', { limit: 100 });
      for (const p of parseProjectList(text)) {
        map.set(p.id, p.name);
      }
    } catch {
      // names are cosmetic for snippet labels
    }
    for (const id of projectIds) {
      if (!map.has(id)) map.set(id, id);
    }
    return map;
  }
}

function truncateToolResult(text: string): string {
  const trimmed = text.trim();
  if (trimmed.length <= TOOL_RESULT_MAX) return trimmed;
  return `${trimmed.slice(0, TOOL_RESULT_MAX)}…`;
}

// Re-export parsers for existing specs
export {
  parseSseJsonRpc,
  parseSearchMatches,
  parseProjectList,
} from './pokelo-mcp.client';
