# Khirby plugins

First-party Khirby CRM plugins. Consumed by the [Khirby CRM](https://github.com/Khirby-labs) monorepo as a **local checkout** under `plugins/` (gitignored there) or as published `@khirby/plugin-*` packages.

## Packages

| Directory | npm name |
| --------- | -------- |
| `crm-plugin-webhook` | `@khirby/plugin-webhook` |
| `crm-plugin-discord` | `@khirby/plugin-discord` |
| `crm-plugin-listmonk` | `@khirby/plugin-listmonk` |
| `crm-plugin-mcp` | `@khirby/plugin-mcp` |
| `crm-plugin-ai-compose` | `@khirby/plugin-ai-compose` |
| `crm-plugin-pokelo` | `@khirby/plugin-pokelo` |

Peers: `@khirby/plugin-sdk`, `@khirby/plugin-host` (published from the CRM monorepo).

## Use with the CRM monorepo

```bash
# from the CRM repo root
git clone git@github.com:Khirby-labs/plugins.git plugins
pnpm install
```

CI clones this repository into `plugins/` before `pnpm install` / Docker build.

## Authoring

See the CRM repo `docs/PLUGINS.md` and `@khirby/plugin-sdk` / `@khirby/plugin-host`.

## License

[MIT](./LICENSE) © Khirby Labs

## Development

These packages are meant to be checked out into the CRM monorepo's `plugins/`
directory (`workspace:*` peers resolve to `packages/plugin-sdk` / `plugin-host`
there). Standalone `pnpm install` in this repo alone is not supported until the
host packages are published to npm.
