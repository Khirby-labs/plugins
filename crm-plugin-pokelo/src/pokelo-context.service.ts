import { Injectable, Logger } from '@nestjs/common';
import type { PokeloContextServiceLike, PokeloFetchOpts } from '../../../packages/plugin-host/src';
import { PokeloSettingsService } from './pokelo-settings.service';

const SNIPPET_LIMIT_TOTAL = 8;
const SNIPPET_LIMIT_PER_PROJECT = 3;
const SNIPPET_MAX_CHARS = 800;

type McpToolResult = {
  result?: {
    content?: Array<{ type?: string; text?: string }>;
  };
  error?: { message?: string };
};

@Injectable()
export class PokeloContextService implements PokeloContextServiceLike {
  private readonly logger = new Logger(PokeloContextService.name);

  constructor(private readonly settings: PokeloSettingsService) {}

  async fetchContext(query: string, opts?: PokeloFetchOpts): Promise<string> {
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
            const text = await this.callMcpTool(creds.baseUrl, creds.token, 'search_documents', {
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

  async listProjects(): Promise<Array<{ id: string; name: string }>> {
    const creds = await this.settings.getCredentials();
    if (!creds?.token) {
      return [];
    }

    const text = await this.callMcpTool(creds.baseUrl, creds.token, 'list_projects', {
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
      const text = await this.callMcpTool(baseUrl, token, 'list_projects', { limit: 100 });
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

  private async callMcpTool(
    baseUrl: string,
    token: string,
    name: string,
    args: Record<string, unknown>,
  ): Promise<string> {
    const url = `${baseUrl.replace(/\/$/, '')}/mcp`;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name, arguments: args },
      }),
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => 'unknown error');
      throw new Error(`Pokelo MCP ${response.status}: ${errText.slice(0, 200)}`);
    }

    const contentType = response.headers.get('content-type') ?? '';
    const raw = await response.text();
    const envelope = contentType.includes('text/event-stream')
      ? parseSseJsonRpc(raw)
      : (JSON.parse(raw) as McpToolResult);

    if (envelope.error) {
      throw new Error(envelope.error.message ?? 'Pokelo MCP tool error');
    }

    return envelope.result?.content?.[0]?.text ?? '';
  }
}

/** Parse last JSON-RPC payload from an SSE body (`data: {...}` lines). */
export function parseSseJsonRpc(raw: string): McpToolResult {
  const dataLines: string[] = [];
  for (const line of raw.split(/\r?\n/)) {
    if (line.startsWith('data:')) {
      dataLines.push(line.slice(5).trim());
    }
  }
  if (dataLines.length === 0) {
    return JSON.parse(raw) as McpToolResult;
  }
  for (let i = dataLines.length - 1; i >= 0; i--) {
    if (dataLines[i] && dataLines[i] !== '[DONE]') {
      return JSON.parse(dataLines[i]) as McpToolResult;
    }
  }
  throw new Error('Empty SSE response from Pokelo MCP');
}

export function parseSearchMatches(text: string): string[] {
  if (!text.trim()) return [];
  try {
    const parsed = JSON.parse(text) as {
      matches?: Array<{ content?: string }>;
      matchCount?: number;
    };
    if (Array.isArray(parsed.matches)) {
      return parsed.matches
        .map((m) => (typeof m.content === 'string' ? m.content : ''))
        .filter(Boolean);
    }
  } catch {
    // fall through
  }
  return [text];
}

export function parseProjectList(text: string): Array<{ id: string; name: string }> {
  if (!text.trim()) return [];
  try {
    const parsed = JSON.parse(text) as {
      items?: Array<{ id?: string; name?: string }>;
    };
    if (Array.isArray(parsed.items)) {
      return parsed.items
        .filter((p): p is { id: string; name: string } => !!p.id && !!p.name)
        .map((p) => ({ id: p.id, name: p.name }));
    }
  } catch {
    // ignore
  }
  return [];
}
