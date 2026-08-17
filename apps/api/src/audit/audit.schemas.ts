import { z } from 'zod';

export const auditEventIdSchema = z.string().uuid();

export const auditEventListQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(50).default(25),
    cursor: z.string().trim().min(1).max(400).optional(),
  })
  .strict();

export const auditEventCursorSchema = z.object({
  id: z.string().uuid(),
  occurredAt: z.string().datetime({ offset: true }),
});
