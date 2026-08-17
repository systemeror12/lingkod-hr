import { createHash, randomUUID } from 'node:crypto';
import { getConfig } from '@lingkod-hr/config';
import { expect, it } from 'vitest';
import { S3DocumentStorage } from './documents.storage';

const enabled = process.env.DATABASE_E2E === 'true';

it.skipIf(!enabled)(
  'verifies private object storage and signed retrieval against local S3',
  async () => {
    const storage = new S3DocumentStorage(getConfig());
    const body = Buffer.from('External Evidence storage tracer bullet');
    const contentHash = createHash('sha256').update(body).digest('hex');
    const key = `tests/${randomUUID()}`;

    try {
      await storage.putObject({ key, body, contentType: 'text/plain', contentHash });
      const signedUrl = await storage.signedReadUrl(key, 60);
      const response = await fetch(signedUrl);
      expect(response.status).toBe(200);
      expect(Buffer.from(await response.arrayBuffer())).toEqual(body);
    } finally {
      await storage.deleteObject(key);
    }
  },
);
