import { Module } from '@nestjs/common';
import { AgencyController } from './agency.controller';
import { AgencyMemberListService } from './agency-member-list.service';
import { AuthController } from './auth.controller';
import { AuthGuard } from './auth.guard';
import { AuthService } from './auth.service';
import { PermissionGuard } from './permission.guard';
import { ReauthenticationGuard } from './reauthentication.guard';
import { getConfig } from '@lingkod-hr/config';
import { createMailDelivery, INVITATION_MAIL_DELIVERY } from '../invitations/mail';

@Module({
  controllers: [AuthController, AgencyController],
  providers: [
    AgencyMemberListService,
    AuthService,
    AuthGuard,
    PermissionGuard,
    ReauthenticationGuard,
    {
      provide: INVITATION_MAIL_DELIVERY,
      useFactory: () => createMailDelivery(getConfig()),
    },
  ],
  exports: [AuthGuard, AuthService, PermissionGuard, ReauthenticationGuard],
})
export class AuthModule {}
