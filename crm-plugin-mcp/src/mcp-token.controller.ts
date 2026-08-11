import { Controller, Get, Post, Delete, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { SessionGuard } from '../../../packages/plugin-host/src';
import { PermissionGuard } from '../../../packages/plugin-host/src';
import { RequirePermission } from '../../../packages/plugin-host/src';
import { McpTokenService } from './mcp-token.service';

@ApiTags('plugins-mcp')
@ApiBearerAuth()
@Controller('plugins/mcp/token')
@UseGuards(SessionGuard, PermissionGuard)
@RequirePermission('integrations', 'manage')
export class McpTokenController {
  constructor(private readonly tokens: McpTokenService) {}

  @Get()
  @ApiOperation({ summary: 'MCP access token status (never returns the secret)' })
  getStatus() {
    return this.tokens.getStatus();
  }

  @Post('rotate')
  @ApiOperation({ summary: 'Generate or rotate the MCP access token (plaintext returned once)' })
  rotate() {
    return this.tokens.rotate();
  }

  @Delete()
  @ApiOperation({ summary: 'Revoke the MCP access token' })
  async revoke() {
    await this.tokens.revoke();
    return { ok: true };
  }
}
