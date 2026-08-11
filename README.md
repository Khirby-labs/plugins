# Khirby plugins

First-party Khirby CRM plugins. Consumed by the CRM monorepo as a **local checkout** under `plugins/` (gitignored there) or, later, as published `@khirby/plugin-*` packages.

## Packages

| Directory | npm name |
| --------- | -------- |
| `crm-plugin-webhook` | `@khirby/plugin-webhook` |
| `crm-plugin-discord` | `@khirby/plugin-discord` |
| `crm-plugin-listmonk` | `@khirby/plugin-listmonk` |
| `crm-plugin-mcp` | `@khirby/plugin-mcp` |
| `crm-plugin-ai-compose` | `@khirby/plugin-ai-compose` |
| `crm-plugin-pokelo` | `@khirby/plugin-pokelo` |

## Peer dependencies

Plugins peer on published host packages from npm:

- `@khirby/plugin-sdk` `^1.0.0`
- `@khirby/plugin-host` `^1.0.0` (Nest plugins only)

When checked out into the CRM monorepo, pnpm links these to the workspace packages that satisfy the range.

## Use with the CRM monorepo

```bash
# from the CRM repo root
./scripts/checkout-plugins.sh
# or: git clone git@github.com:Khirby-labs/plugins.git plugins
pnpm install
pnpm sync:plugins
```

CI clones this repository into `plugins/` before `pnpm install` / Docker build.

## Authoring

See the CRM repo `docs/PLUGINS.md` and `@khirby/plugin-sdk` / `@khirby/plugin-host` on npm.

## License

[MIT](./LICENSE) © Khirby Labs
