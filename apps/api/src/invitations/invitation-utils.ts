import { Prisma } from '@prisma/client';

export function selectInvitationRoles<T extends { agencyId: string | null; code: string }>(
  roles: readonly T[],
  roleCodes: readonly string[],
  agencyId: string,
): T[] {
  const selected = new Map<string, T>();
  for (const role of roles) {
    const code = role.code.toLowerCase();
    if (!selected.has(code) || role.agencyId === agencyId) selected.set(code, role);
  }
  return roleCodes.flatMap((code) => (selected.has(code) ? [selected.get(code)!] : []));
}

export function prismaBytes(value: Buffer): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(new ArrayBuffer(value.byteLength));
  bytes.set(value);
  return bytes;
}

export function safeJson(value: unknown): Prisma.InputJsonValue | typeof Prisma.JsonNull {
  if (value === null) return Prisma.JsonNull;
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}
