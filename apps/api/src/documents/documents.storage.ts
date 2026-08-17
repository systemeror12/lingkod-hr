import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { AppConfig } from '@lingkod-hr/config';

export interface DocumentStorage {
  putObject(input: {
    key: string;
    body: Buffer;
    contentType: string;
    contentHash: string;
  }): Promise<void>;
  deleteObject(key: string): Promise<void>;
  signedReadUrl(key: string, expiresInSeconds: number): Promise<string>;
}

export class S3DocumentStorage implements DocumentStorage {
  private readonly client: S3Client;

  constructor(
    private readonly config: Pick<
      AppConfig,
      'S3_ENDPOINT' | 'S3_REGION' | 'S3_BUCKET' | 'S3_ACCESS_KEY_ID' | 'S3_SECRET_ACCESS_KEY'
    >,
  ) {
    this.client = new S3Client({
      endpoint: config.S3_ENDPOINT,
      region: config.S3_REGION,
      forcePathStyle: true,
      credentials: {
        accessKeyId: config.S3_ACCESS_KEY_ID,
        secretAccessKey: config.S3_SECRET_ACCESS_KEY,
      },
    });
  }

  async putObject(input: {
    key: string;
    body: Buffer;
    contentType: string;
    contentHash: string;
  }): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.config.S3_BUCKET,
        Key: input.key,
        Body: input.body,
        ContentLength: input.body.byteLength,
        ContentType: input.contentType,
        Metadata: { 'content-sha256': input.contentHash },
      }),
    );

    const head = await this.client.send(
      new HeadObjectCommand({ Bucket: this.config.S3_BUCKET, Key: input.key }),
    );
    if (
      head.ContentLength !== input.body.byteLength ||
      head.Metadata?.['content-sha256'] !== input.contentHash
    ) {
      throw new Error('Stored object verification failed.');
    }
  }

  async deleteObject(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.config.S3_BUCKET, Key: key }));
  }

  signedReadUrl(key: string, expiresInSeconds: number): Promise<string> {
    return getSignedUrl(
      this.client,
      new GetObjectCommand({ Bucket: this.config.S3_BUCKET, Key: key }),
      { expiresIn: expiresInSeconds },
    );
  }
}
