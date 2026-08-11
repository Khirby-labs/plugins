import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  ParseIntPipe,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import {
  IsString,
  IsNotEmpty,
  IsArray,
  ArrayMinSize,
  IsOptional,
  IsIn,
  IsInt,
  IsBoolean,
  IsISO8601,
} from 'class-validator';
import {
  SessionGuard,
  PermissionGuard,
  RequirePermission,
} from '../../../packages/plugin-host/src';
import { ListmonkCampaignsService } from './listmonk-campaigns.service';

class CreateCampaignDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsString()
  @IsNotEmpty()
  subject: string;

  @IsArray()
  @ArrayMinSize(1)
  @IsInt({ each: true })
  lists: number[];

  @IsOptional()
  @IsString()
  fromEmail?: string;

  @IsIn(['regular', 'optin'])
  type: 'regular' | 'optin';

  @IsIn(['richtext', 'html', 'markdown', 'plain'])
  contentType: 'richtext' | 'html' | 'markdown' | 'plain';

  @IsString()
  body: string;

  @IsOptional()
  @IsInt()
  templateId?: number;

  @IsOptional()
  @IsISO8601()
  sendAt?: string;

  @IsOptional()
  @IsBoolean()
  sendImmediately?: boolean;

  @IsOptional()
  @IsBoolean()
  useMailboxReplyTo?: boolean;
}

class UpdateStatusDto {
  @IsIn(['draft', 'scheduled', 'running', 'paused', 'cancelled'])
  status: 'draft' | 'scheduled' | 'running' | 'paused' | 'cancelled';
}

class PreviewCampaignDto {
  @IsInt()
  templateId: number;

  @IsIn(['richtext', 'html', 'markdown', 'plain'])
  contentType: 'richtext' | 'html' | 'markdown' | 'plain';

  @IsString()
  body: string;

  @IsOptional()
  @IsInt()
  campaignId?: number;
}

@ApiTags('listmonk')
@Controller('plugins/listmonk')
@UseGuards(SessionGuard, PermissionGuard)
@RequirePermission('newsletter', 'manage')
export class ListmonkCampaignsController {
  constructor(private readonly svc: ListmonkCampaignsService) {}

  @Get('campaigns')
  @ApiOperation({ summary: 'List Listmonk campaigns' })
  @ApiResponse({ status: 200 })
  getCampaigns(@Query('page') page?: string, @Query('perPage') perPage?: string) {
    return this.svc.getCampaigns(
      page ? parseInt(page, 10) : 1,
      perPage ? parseInt(perPage, 10) : 20,
    );
  }

  @Get('campaigns/:id')
  @ApiOperation({ summary: 'Get a Listmonk campaign' })
  getCampaign(@Param('id', ParseIntPipe) id: number) {
    return this.svc.getCampaign(id);
  }

  @Post('campaigns')
  @ApiOperation({ summary: 'Create a Listmonk campaign' })
  createCampaign(@Body() dto: CreateCampaignDto) {
    return this.svc.createCampaign(dto);
  }

  @Post('campaigns/preview')
  @ApiOperation({
    summary: 'Render full email HTML (template + body) for CRM preview',
  })
  previewCampaign(@Body() dto: PreviewCampaignDto) {
    return this.svc.previewCampaign(dto);
  }

  @Put('campaigns/:id')
  @ApiOperation({ summary: 'Update a draft/scheduled/paused campaign' })
  updateCampaign(@Param('id', ParseIntPipe) id: number, @Body() dto: CreateCampaignDto) {
    return this.svc.updateCampaign(id, dto);
  }

  @Put('campaigns/:id/status')
  @ApiOperation({ summary: 'Change campaign status' })
  updateStatus(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateStatusDto) {
    return this.svc.updateStatus(id, dto.status);
  }

  @Delete('campaigns/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a draft campaign' })
  @ApiResponse({ status: 204, description: 'Campaign deleted' })
  deleteCampaign(@Param('id', ParseIntPipe) id: number) {
    return this.svc.deleteCampaign(id);
  }

  @Get('campaigns/:id/stats')
  @ApiOperation({ summary: 'Campaign analytics from Listmonk' })
  getStats(
    @Param('id', ParseIntPipe) id: number,
    @Query('type') type: 'views' | 'clicks' | 'bounces' | 'links' = 'views',
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    const toDay = to ?? new Date().toISOString().slice(0, 10);
    const fromDay =
      from ?? new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const allowed = ['views', 'clicks', 'bounces', 'links'] as const;
    const safeType = allowed.includes(type) ? type : 'views';
    return this.svc.getCampaignStats(id, safeType, fromDay, toDay);
  }

  @Post('campaigns/:id/sync-stats')
  @ApiOperation({ summary: 'Refresh cached stats from Listmonk' })
  syncStats(@Param('id', ParseIntPipe) id: number) {
    return this.svc.syncStats(id);
  }

  @Get('templates')
  @ApiOperation({ summary: 'Listmonk templates (read-only)' })
  getTemplates() {
    return this.svc.getTemplates();
  }

  @Get('from-defaults')
  @ApiOperation({ summary: 'Default from email from firm mailbox' })
  getFromDefaults() {
    return this.svc.getFromDefaults();
  }
}
