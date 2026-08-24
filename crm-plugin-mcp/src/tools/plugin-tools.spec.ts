import { BadRequestException } from '@nestjs/common';
import { registerPluginTools } from './plugin-tools';
import type { InstancePluginsLike } from '../../../../packages/plugin-host/src';

describe('registerPluginTools', () => {
  const handlers = new Map<string, (args: Record<string, unknown>) => Promise<unknown>>();
  const instance: jest.Mocked<InstancePluginsLike> = {
    instanceDir: jest.fn(),
    packageDir: jest.fn(),
    reservedNames: jest.fn(),
    loadedNames: jest.fn(),
    hotLoad: jest.fn(),
    validate: jest.fn(),
    appendManifest: jest.fn(),
    pluginContract: jest.fn(),
    scaffold: jest.fn(),
    writeFile: jest.fn(),
    readFile: jest.fn(),
    listFiles: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    handlers.clear();
    instance.instanceDir.mockReturnValue('/data/instance-plugins');
    instance.packageDir.mockImplementation((directory) => `/data/instance-plugins/${directory}`);
    instance.reservedNames.mockReturnValue(['crm_mcp', 'crm_hello']);
    instance.loadedNames.mockReturnValue(['crm_mcp']);
    instance.pluginContract.mockReturnValue(
      'contact.created INSTANCE_PLUGINS_DIR ./web web_not_hot_loadable',
    );
    const server = {
      registerTool: (
        name: string,
        _meta: unknown,
        handler: (args: Record<string, unknown>) => Promise<unknown>,
      ) => {
        handlers.set(name, handler);
      },
    };
    registerPluginTools(server as never, { instance });
  });

  it('registers the self-build tools', () => {
    expect([...handlers.keys()].sort()).toEqual([
      'describe_plugin_contract',
      'install_instance_plugin',
      'list_instance_plugin_files',
      'read_instance_plugin_file',
      'scaffold_plugin',
      'validate_plugin',
      'write_instance_plugin_file',
    ]);
  });

  it('describe_plugin_contract returns the host contract', async () => {
    const result = (await handlers.get('describe_plugin_contract')!({})) as {
      content: { text: string }[];
    };
    const text = JSON.parse(result.content[0]!.text).contract as string;
    expect(text).toContain('contact.created');
    expect(text).toContain('INSTANCE_PLUGINS_DIR');
    expect(text).toContain('./web');
    expect(instance.pluginContract).toHaveBeenCalled();
  });

  it('scaffold_plugin maps reserved_name from the host', async () => {
    instance.scaffold.mockImplementation(() => {
      throw new BadRequestException({
        statusCode: 400,
        code: 'BAD_REQUEST',
        message: 'Reserved plugin name: crm_mcp',
        params: { reason: 'reserved_name' },
      });
    });
    const reserved = (await handlers.get('scaffold_plugin')!({
      directory: 'ok',
      name: 'crm_mcp',
    })) as { isError?: boolean; content: { text: string }[] };
    expect(reserved.isError).toBe(true);
    expect(JSON.parse(reserved.content[0]!.text).error).toBe('reserved_name');
  });

  it('scaffold_plugin forwards to the host', async () => {
    instance.scaffold.mockReturnValue({
      directory: '/data/instance-plugins/my-demo',
      files: ['package.json', 'src/index.ts'],
    });
    const result = (await handlers.get('scaffold_plugin')!({
      directory: 'my-demo',
      name: 'crm_demo',
      nest: true,
    })) as { content: { text: string }[] };
    expect(instance.scaffold).toHaveBeenCalledWith({
      directory: 'my-demo',
      name: 'crm_demo',
      displayName: undefined,
      nest: true,
    });
    expect(JSON.parse(result.content[0]!.text).files).toEqual(
      expect.arrayContaining(['package.json', 'src/index.ts']),
    );
  });

  it('validate_plugin maps web_not_hot_loadable from the host', async () => {
    instance.validate.mockImplementation(() => {
      throw new BadRequestException({
        statusCode: 400,
        code: 'BAD_REQUEST',
        message: 'Vue ./web is not hot-loadable on an instance volume',
        params: { reason: 'web_not_hot_loadable' },
      });
    });
    const result = (await handlers.get('validate_plugin')!({ directory: 'webby' })) as {
      isError?: boolean;
      content: { text: string }[];
    };
    expect(instance.packageDir).toHaveBeenCalledWith('webby');
    expect(result.isError).toBe(true);
    expect(JSON.parse(result.content[0]!.text).error).toBe('web_not_hot_loadable');
  });

  it('install_instance_plugin appends the manifest then hot-loads', async () => {
    instance.validate.mockReturnValue({ name: 'crm_demo' });
    instance.hotLoad.mockResolvedValue({ name: 'crm_demo' });
    const result = (await handlers.get('install_instance_plugin')!({
      directory: 'my-demo',
    })) as { content: { text: string }[] };
    expect(instance.packageDir).toHaveBeenCalledWith('my-demo');
    expect(instance.appendManifest).toHaveBeenCalledWith('my-demo', 'my-demo');
    expect(instance.hotLoad).toHaveBeenCalledWith('/data/instance-plugins/my-demo');
    expect(JSON.parse(result.content[0]!.text)).toEqual({
      ok: true,
      name: 'crm_demo',
      validated: 'crm_demo',
    });
  });

  it('write_instance_plugin_file maps bad_path and round-trips through the host', async () => {
    instance.writeFile.mockImplementation((directory, path) => {
      if (path.includes('..')) {
        throw new BadRequestException({
          statusCode: 400,
          code: 'BAD_REQUEST',
          message: 'directory/path must be relative without ..',
          params: { reason: 'bad_path' },
        });
      }
      return { directory, path, bytes: 18 };
    });
    instance.listFiles.mockReturnValue({ directory: 'my-demo', files: ['src/index.ts'] });
    instance.readFile.mockReturnValue({
      directory: 'my-demo',
      path: 'src/index.ts',
      content: 'export const x = 1\n',
    });

    const trav = (await handlers.get('write_instance_plugin_file')!({
      directory: 'ok',
      path: '../x.ts',
      content: 'nope',
    })) as { isError?: boolean; content: { text: string }[] };
    expect(trav.isError).toBe(true);
    expect(JSON.parse(trav.content[0]!.text).error).toBe('bad_path');

    await handlers.get('write_instance_plugin_file')!({
      directory: 'my-demo',
      path: 'src/index.ts',
      content: 'export const x = 1\n',
    });
    const listed = (await handlers.get('list_instance_plugin_files')!({
      directory: 'my-demo',
    })) as { content: { text: string }[] };
    expect(JSON.parse(listed.content[0]!.text).files).toEqual(['src/index.ts']);
    const read = (await handlers.get('read_instance_plugin_file')!({
      directory: 'my-demo',
      path: 'src/index.ts',
    })) as { content: { text: string }[] };
    expect(JSON.parse(read.content[0]!.text).content).toBe('export const x = 1\n');
  });
});
