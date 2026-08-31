import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { EmployeesController } from './employees.controller';
import { EMPLOYEE_AUDIT_WRITER, employeeAuditWriter, EmployeesService } from './employees.service';

@Module({
  imports: [AuthModule],
  controllers: [EmployeesController],
  providers: [EmployeesService, { provide: EMPLOYEE_AUDIT_WRITER, useValue: employeeAuditWriter }],
  exports: [EmployeesService],
})
export class EmployeesModule {}
