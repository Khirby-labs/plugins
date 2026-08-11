import { Module } from '@nestjs/common';
import { ListmonkListsController } from './listmonk-lists.controller';
import { ListmonkListsService } from './listmonk-lists.service';
import { ListmonkSubscribersController } from './listmonk-subscribers.controller';
import { ListmonkSubscribersService } from './listmonk-subscribers.service';
import { ListmonkCampaignsController } from './listmonk-campaigns.controller';
import { ListmonkCampaignsService } from './listmonk-campaigns.service';

/** Host DI (Rbac, Contacts, PLUGIN_REGISTRY, DB) comes from global PluginBridgeModule (ADR-0016). */
@Module({
  controllers: [
    ListmonkListsController,
    ListmonkSubscribersController,
    ListmonkCampaignsController,
  ],
  providers: [ListmonkListsService, ListmonkSubscribersService, ListmonkCampaignsService],
  exports: [ListmonkSubscribersService, ListmonkCampaignsService],
})
export class ListmonkNestModule {}
