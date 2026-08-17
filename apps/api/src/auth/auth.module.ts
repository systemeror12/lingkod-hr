import { Module } from '@nestjs/common';
import { AgencyController } from './agency.controller';
import { AuthController } from './auth.controller';
import { AuthGuard } from './auth.guard';
import { AuthService } from './auth.service';
import { PermissionGuard } from './permission.guard';
import { getConfig } from '@lingkod-hr/config';
import { createMailDelivery, INVITATION_MAIL_DELIVERY } from '../invitations/mail';

@Module({
  controllers: [AuthController, AgencyController],
  providers: [
    AuthService,
    AuthGuard,
    PermissionGuard,
    {
      provide: INVITATION_MAIL_DELIVERY,
      useFactory: () => createMailDelivery(getConfig()),
    },
  ],
  exports: [AuthGuard, AuthService, PermissionGuard],
})
export class AuthModule {}
