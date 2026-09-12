import type { KnowledgeMcpToolDef } from '@khirby/plugin-host';

export type McpToolResult = {
  result?: {
    content?: Array<{ type?: string; text?: string }>;
    isError?: boolean;
    tools?: Array<{
      name?: string;
      description?: string;
      inputSchema?: Record<string, unknown>;
    }>;
  };
  error?: { message?: string };
};

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
      items?: Array<{ id?: string; projectId?: string; name?: string }>;
    };
    if (Array.isArray(parsed.items)) {
      return parsed.items
        .map((p) => {
          const id =
            (typeof p.projectId === 'string' && p.projectId.trim()) ||
            (typeof p.id === 'string' && p.id.trim()) ||
            '';
          const name = typeof p.name === 'string' ? p.name.trim() : '';
          return { id, name };
        })
        .filter((p) => p.id && p.name);
    }
  } catch {
    // ignore
  }
  return [];
}

export function parseMcpToolList(envelope: McpToolResult): KnowledgeMcpToolDef[] {
  const tools = envelope.result?.tools;
  if (!Array.isArray(tools)) return [];
  return tools
    .map((t) => {
      const name = typeof t.name === 'string' ? t.name.trim() : '';
      if (!name) return null;
      const description = typeof t.description === 'string' ? t.description : name;
      const inputSchema =
        t.inputSchema && typeof t.inputSchema === 'object' && !Array.isArray(t.inputSchema)
          ? t.inputSchema
          : { type: 'object', properties: {} };
      return { name, description, inputSchema };
    })
    .filter((t): t is KnowledgeMcpToolDef => t !== null);
}

/** Extract projectId from MCP tool args (common field names). */
export function extractProjectIdArg(args: Record<string, unknown>): string | null {
  for (const key of ['projectId', 'project_id', 'project']) {
    const raw = args[key];
    if (typeof raw === 'string' && raw.trim()) return raw.trim();
  }
  return null;
}

/**
 * Shared Pokelo MCP HTTP transport (tools/list + tools/call).
 * Used by fetchContext enrichment and Ask Khirby tool proxy (ADR-0050).
 */
export async function mcpJsonRpc(
  baseUrl: string,
  token: string,
  method: 'tools/list' | 'tools/call',
  params?: Record<string, unknown>,
): Promise<McpToolResult> {
  const url = `${baseUrl.replace(/\/$/, '')}/mcp`;
  const body: Record<string, unknown> = {
    jsonrpc: '2.0',
    id: 1,
    method,
  };
  if (params !== undefined) {
    body.params = params;
  }

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => 'unknown error');
    throw new Error(`Pokelo MCP ${response.status}: ${errText.slice(0, 200)}`);
  }

  const contentType = response.headers.get('content-type') ?? '';
  const raw = await response.text();
  return contentType.includes('text/event-stream')
    ? parseSseJsonRpc(raw)
    : (JSON.parse(raw) as McpToolResult);
}

export async function callMcpTool(
  baseUrl: string,
  token: string,
  name: string,
  args: Record<string, unknown>,
): Promise<string> {
  const envelope = await mcpJsonRpc(baseUrl, token, 'tools/call', {
    name,
    arguments: args,
  });

  if (envelope.error) {
    throw new Error(envelope.error.message ?? 'Pokelo MCP tool error');
  }
  if (envelope.result?.isError) {
    const msg = envelope.result.content?.[0]?.text?.trim() || 'Pokelo MCP tool error';
    throw new Error(msg);
  }

  return envelope.result?.content?.[0]?.text ?? '';
}

export async function listMcpTools(
  baseUrl: string,
  token: string,
): Promise<KnowledgeMcpToolDef[]> {
  const envelope = await mcpJsonRpc(baseUrl, token, 'tools/list', {});
  if (envelope.error) {
    throw new Error(envelope.error.message ?? 'Pokelo MCP tools/list error');
  }
  return parseMcpToolList(envelope);
}
