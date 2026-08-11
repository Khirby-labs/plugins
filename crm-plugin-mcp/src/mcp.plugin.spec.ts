import { McpPlugin } from './mcp.plugin';

describe('McpPlugin', () => {
  const plugin = new McpPlugin();

  it('has stable identity metadata', () => {
    expect(plugin.name).toBe('crm_mcp');
    expect(plugin.displayNameKey).toBe('plugins.mcp.displayName');
    expect(plugin.getNestModule()).toBeDefined();
  });

  it('does not register a sidebar frontend route (settings embed in Plugins list)', () => {
    expect('getFrontendRoutes' in plugin).toBe(false);
  });

  it('runs migrations via onMigrate', async () => {
    const unsafe = jest.fn().mockResolvedValue(undefined);
    await plugin.onMigrate({ unsafe });
    expect(unsafe).toHaveBeenCalled();
    expect(String(unsafe.mock.calls[0][0])).toContain('mcp_access_tokens');
  });
});
