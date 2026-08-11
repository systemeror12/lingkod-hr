import { Module } from '@nestjs/common';
import { AgencyController } from './agency.controller';
import { AuthController } from './auth.controller';
import { AuthGuard } from './auth.guard';
import { AuthService } from './auth.service';
import { PermissionGuard } from './permission.guard';

@Module({
  controllers: [AuthController, AgencyController],
  providers: [AuthService, AuthGuard, PermissionGuard],
  exports: [AuthGuard, AuthService, PermissionGuard],
})
export class AuthModule {}
