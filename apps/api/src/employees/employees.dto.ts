import type {
  EmployeeDetail,
  EmployeeMembershipSummary,
  EmployeeSummary,
} from './employees.service';

export class EmployeeDto {
  readonly id: string;
  readonly employeeNumber: string;
  readonly legalName: string;
  readonly birthDate: string;
  readonly sex: string;
  readonly civilStatus: string;
  readonly contactEmail: string;
  readonly serviceStatus: string;
  readonly membershipId: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;

  constructor(employee: EmployeeSummary) {
    this.id = employee.id;
    this.employeeNumber = employee.employeeNumber;
    this.legalName = employee.legalName;
    this.birthDate = employee.birthDate;
    this.sex = employee.sex;
    this.civilStatus = employee.civilStatus;
    this.contactEmail = employee.contactEmail;
    this.serviceStatus = employee.serviceStatus;
    this.membershipId = employee.membershipId;
    this.createdAt = employee.createdAt;
    this.updatedAt = employee.updatedAt;
  }
}

export class EmployeeListResponseDto {
  readonly employees: EmployeeDto[];

  constructor(employees: EmployeeSummary[]) {
    this.employees = employees.map((employee) => new EmployeeDto(employee));
  }
}

export class EmployeeMembershipDto {
  readonly id: string;
  readonly displayName: string;
  readonly email: string | null;

  constructor(membership: EmployeeMembershipSummary) {
    this.id = membership.id;
    this.displayName = membership.displayName;
    this.email = membership.email;
  }
}

export class EmployeeDetailDto extends EmployeeDto {
  readonly rowVersion: number;
  readonly linkableMemberships: EmployeeMembershipDto[];

  constructor(detail: EmployeeDetail) {
    super(detail);
    this.rowVersion = detail.rowVersion;
    this.linkableMemberships = detail.linkableMemberships.map(
      (membership) => new EmployeeMembershipDto(membership),
    );
  }
}
