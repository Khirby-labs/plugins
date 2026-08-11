import { Controller, Get, Put, Param, Body, ParseIntPipe, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { IsOptional, IsUUID, ValidateIf } from 'class-validator';
import {
  SessionGuard,
  PermissionGuard,
  RequirePermission,
} from '../../../packages/plugin-host/src';
import { ListmonkListsService } from './listmonk-lists.service';

class SetListFormDto {
  /** null / omit clears the mapping. */
  @IsOptional()
  @ValidateIf((_, v) => v != null && v !== '')
  @IsUUID()
  formId?: string | null;
}

@ApiTags('listmonk')
@Controller('plugins/listmonk/lists')
@UseGuards(SessionGuard, PermissionGuard)
@RequirePermission('newsletter', 'manage')
export class ListmonkListsController {
  constructor(private readonly svc: ListmonkListsService) {}

  @Get()
  @ApiOperation({ summary: 'Listmonk mailing lists (live) with optional CRM form mapping' })
  @ApiResponse({ status: 200 })
  getLists() {
    return this.svc.getLists();
  }

  @Get('form-options')
  @ApiOperation({ summary: 'CRM forms available to assign to a Listmonk list' })
  getFormOptions() {
    return this.svc.getFormOptions();
  }

  @Put(':id/form')
  @ApiOperation({ summary: 'Assign or clear the CRM form for a Listmonk list' })
  setListForm(@Param('id', ParseIntPipe) id: number, @Body() dto: SetListFormDto) {
    return this.svc.setListForm(id, dto.formId ?? null);
  }
}
