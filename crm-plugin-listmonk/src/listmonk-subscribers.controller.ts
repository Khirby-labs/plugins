import { Controller, Post, Body, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { IsArray, IsString, ArrayMaxSize, ArrayMinSize } from 'class-validator';
import { SessionGuard } from '../../../packages/plugin-host/src';
import { PermissionGuard } from '../../../packages/plugin-host/src';
import { RequirePermission } from '../../../packages/plugin-host/src';
import { ListmonkSubscribersService } from './listmonk-subscribers.service';

class LookupSubscribersDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @IsString({ each: true })
  emails: string[];
}

@ApiTags('listmonk')
@Controller('plugins/listmonk/subscribers')
@UseGuards(SessionGuard, PermissionGuard)
@RequirePermission('contacts', 'manage')
export class ListmonkSubscribersController {
  constructor(private readonly svc: ListmonkSubscribersService) {}

  @Post('lookup')
  @ApiOperation({ summary: 'Lookup Listmonk subscriber status for contact emails' })
  @ApiResponse({ status: 200 })
  lookup(@Body() dto: LookupSubscribersDto) {
    return this.svc.lookupByEmails(dto.emails);
  }

  @Post('sync')
  @ApiOperation({ summary: 'Import Listmonk subscribers as CRM contacts' })
  @ApiResponse({ status: 200 })
  sync() {
    return this.svc.syncToContacts();
  }
}
