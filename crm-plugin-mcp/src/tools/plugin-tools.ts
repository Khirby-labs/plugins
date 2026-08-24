import type { McpServer } from '@modelcontextprotocol/server';
import { HttpException } from '@nestjs/common';
import { z } from 'zod';
import type { InstancePluginsLike } from '../../../../packages/plugin-host/src';

function jsonResult(data: unknown) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }],
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
    const params =
      typeof body === 'object' && body !== null && 'params' in body
        ? (body as { params?: Record<string, unknown> }).params
        : undefined;
    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify({
            error: params?.reason ?? 'request_failed',
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

function codedError(error: string, message: string) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify({ error, message }) }],
    isError: true as const,
  };
}

function unavailable() {
  return codedError('unavailable', 'Instance plugin host is not wired');
}

export type PluginToolDeps = {
  instance?: InstancePluginsLike | null;
};

/**
 * Thin MCP transport over INSTANCE_PLUGINS (ADR-0038). File ops and templates
 * live on the host so in-app chat can share them — do not reimplement here.
 */
export function registerPluginTools(server: McpServer, deps: PluginToolDeps): void {
  server.registerTool(
    'describe_plugin_contract',
    {
      description:
        'Return the live CrmPlugin contract for instance self-build: events, host imports, volume hot-load, and the Vue ./web ban.',
      inputSchema: z.object({}),
    },
    async () => {
      if (!deps.instance) return unavailable();
      return jsonResult({ contract: deps.instance.pluginContract() });
    },
  );

  server.registerTool(
    'scaffold_plugin',
    {
      description:
        'Write a npm-shaped plugin skeleton under plugins/<directory>/. Does not hot-load.',
      inputSchema: z.object({
        directory: z.string().describe('Single path segment under plugins/ (e.g. crm-plugin-demo)'),
        name: z.string().describe('Plugin crm_* name'),
        displayName: z.string().optional(),
        nest: z.boolean().optional().describe('Include a gated Nest ping controller'),
      }),
    },
    async ({ directory, name, displayName, nest }) => {
      if (!deps.instance) return unavailable();
      try {
        return jsonResult(deps.instance.scaffold({ directory, name, displayName, nest }));
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    'write_instance_plugin_file',
    {
      description:
        'Write one relative file inside plugins/<directory>/ (scaffold fill). Caps: 24 files, 100KB.',
      inputSchema: z.object({
        directory: z.string().describe('Single path segment under plugins/ (e.g. crm-plugin-demo)'),
        path: z.string().describe('Relative file path, e.g. src/index.ts'),
        content: z.string().describe('Full file contents'),
      }),
    },
    async ({ directory, path, content }) => {
      if (!deps.instance) return unavailable();
      try {
        return jsonResult(deps.instance.writeFile(directory, path, content));
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    'read_instance_plugin_file',
    {
      description: 'Read one relative file from plugins/<directory>/.',
      inputSchema: z.object({
        directory: z.string().describe('Single path segment under plugins/ (e.g. crm-plugin-demo)'),
        path: z.string().describe('Relative file path, e.g. src/index.ts'),
      }),
    },
    async ({ directory, path }) => {
      if (!deps.instance) return unavailable();
      try {
        return jsonResult(deps.instance.readFile(directory, path));
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    'list_instance_plugin_files',
    {
      description: 'List relative files in plugins/<directory>/.',
      inputSchema: z.object({
        directory: z.string().describe('Single path segment under plugins/ (e.g. crm-plugin-demo)'),
      }),
    },
    async ({ directory }) => {
      if (!deps.instance) return unavailable();
      try {
        return jsonResult(deps.instance.listFiles(directory));
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    'validate_plugin',
    {
      description: 'Load createPlugin() from plugins/<directory>/ without activating it.',
      inputSchema: z.object({
        directory: z.string().describe('Single path segment under plugins/ (e.g. crm-plugin-demo)'),
      }),
    },
    async ({ directory }) => {
      if (!deps.instance) return unavailable();
      try {
        const result = deps.instance.validate(deps.instance.packageDir(directory));
        return jsonResult({ ok: true, name: result.name });
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    'install_instance_plugin',
    {
      description:
        'Validate, append the instance manifest, and hot-load the plugin into this process (no Vue ./web).',
      inputSchema: z.object({
        directory: z.string().describe('Single path segment under plugins/ (e.g. crm-plugin-demo)'),
        packageName: z.string().optional().describe('package.json name; defaults to directory'),
      }),
    },
    async ({ directory, packageName }) => {
      if (!deps.instance) return unavailable();
      try {
        const abs = deps.instance.packageDir(directory);
        const checked = deps.instance.validate(abs);
        deps.instance.appendManifest(packageName ?? directory, directory);
        const loaded = await deps.instance.hotLoad(abs);
        return jsonResult({ ok: true, name: loaded.name, validated: checked.name });
      } catch (err) {
        return errorResult(err);
      }
    },
  );
}
