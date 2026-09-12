import type { McpServer } from '@modelcontextprotocol/server';
import { HttpException } from '@nestjs/common';
import { z } from 'zod';
import type { InstancePluginsLike } from '@khirby/plugin-host';

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

const directoryField = z
  .string()
  .describe('Volume folder, crm_* name, or SPA slug (hello-world-stats). Not the /plugins/ URL');

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
        'Authoring spec for instance plugins (https://khirby.com/docs/plugins/create plus volume rules). Call before scaffold and follow it.',
      inputSchema: z.object({}),
    },
    async () => {
      if (!deps.instance) return unavailable();
      return jsonResult({ contract: deps.instance.pluginContract() });
    },
  );

  server.registerTool(
    'list_installed_plugins',
    {
      description:
        'List plugins loaded in this process with volume directory (null if image/native) and SPA pages. Use directory for list/read/write/install — never the SPA path.',
      inputSchema: z.object({}),
    },
    async () => {
      if (!deps.instance) return unavailable();
      const instance = deps.instance;
      const names = instance.loadedNames();
      return jsonResult({
        plugins: names.map((name) => ({
          name,
          directory: instance.instanceDirectory(name),
          pages: instance.frontendPages(name),
        })),
      });
    },
  );

  server.registerTool(
    'scaffold_plugin',
    {
      description:
        'Write the published-plugin-shaped ESM skeleton under plugins/<directory>/ (createPlugin + src/nest-module.ts; getNestModule uses loadVolumeNestModule). Optional install hot-loads it into this CRM process.',
      inputSchema: z.object({
        directory: z.string().describe('One-segment folder under plugins/ (e.g. crm-plugin-demo)'),
        name: z.string().describe('Plugin crm_* name'),
        displayName: z.string().optional(),
        nest: z.boolean().optional().describe('Include a gated Nest controller (default true)'),
        install: z.boolean().optional().describe('Hot-load after scaffold (default false)'),
      }),
    },
    async ({ directory, name, displayName, nest, install }) => {
      if (!deps.instance) return unavailable();
      try {
        const scaffolded = deps.instance.scaffold({
          directory,
          name,
          displayName,
          nest: nest === false ? false : true,
        });
        if (!install) return jsonResult(scaffolded);
        const result = await deps.instance.installFromDirectory(directory);
        return jsonResult({
          ...scaffolded,
          installed: result,
          pages: deps.instance.frontendPages(result.name),
        });
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    'write_instance_plugin_file',
    {
      description:
        'Write one relative file inside plugins/<directory>/ (scaffold fill). Caps: 24 files, 100KB. Reloads the live GET handler in this CRM process (no Marketplace).',
      inputSchema: z.object({
        directory: directoryField,
        path: z.string().describe('Relative file path, e.g. src/index.ts'),
        content: z.string().describe('Full file contents'),
      }),
    },
    async ({ directory, path, content }) => {
      if (!deps.instance) return unavailable();
      try {
        const written = deps.instance.writeFile(directory, path, content);
        const reloaded = await deps.instance.reloadFromDirectory(directory);
        return jsonResult({ ...written, reload: reloaded.status });
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
        directory: directoryField,
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
        directory: directoryField,
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
        directory: directoryField,
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
        'Validate, append the instance manifest, and hot-load (or reload) the plugin into this CRM process — no Marketplace, no Vue ./web.',
      inputSchema: z.object({
        directory: directoryField,
        packageName: z.string().optional().describe('package.json name; defaults to directory'),
      }),
    },
    async ({ directory, packageName }) => {
      if (!deps.instance) return unavailable();
      try {
        const result = await deps.instance.installFromDirectory(directory, packageName);
        return jsonResult({
          ok: true,
          name: result.name,
          status: result.status,
          pages: deps.instance.frontendPages(result.name),
        });
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    'remove_instance_plugin',
    {
      description:
        'Delete plugins/<dir>/, manifest entry, and DB row (API restart clears in-memory code)',
      inputSchema: z.object({
        directory: directoryField,
      }),
    },
    async ({ directory }) => {
      if (!deps.instance) return unavailable();
      try {
        const removed = await deps.instance.removeInstance(directory);
        return jsonResult({ ok: true, name: removed.name });
      } catch (err) {
        return errorResult(err);
      }
    },
  );
}
