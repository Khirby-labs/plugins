import { Module } from '@nestjs/common';
import { McpTokenService } from './mcp-token.service';
import { McpTokenController } from './mcp-token.controller';
import { McpHttpService } from './mcp-http.service';

/** Host DI comes from global PluginBridgeModule (ADR-0016). */
@Module({
  controllers: [McpTokenController],
  providers: [McpTokenService, McpHttpService],
})
export class McpNestModule {}
