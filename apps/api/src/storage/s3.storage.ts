import { DeleteObjectsCommand, GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env';
import { assertSafeKey, Storage } from './storage';

/** Compatible con MinIO, AWS S3 y Cloudflare R2. */
@Injectable()
export class S3Storage extends Storage {
  private readonly client: S3Client;
  /** Cliente con el endpoint que ve el navegador: la firma incluye el host. */
  private readonly signer: S3Client;
  private readonly bucket: string;
  private readonly ttl: number;

  constructor(config: ConfigService<Env, true>) {
    super();
    const base = {
      region: config.get('S3_REGION', { infer: true }),
      forcePathStyle: config.get('S3_FORCE_PATH_STYLE', { infer: true }),
      credentials: {
        accessKeyId: config.get('S3_ACCESS_KEY', { infer: true }),
        secretAccessKey: config.get('S3_SECRET_KEY', { infer: true }),
      },
    };
    const endpoint = config.get('S3_ENDPOINT', { infer: true });
    this.client = new S3Client({ ...base, endpoint });
    this.signer = new S3Client({ ...base, endpoint: config.get('S3_PUBLIC_ENDPOINT', { infer: true }) ?? endpoint });
    this.bucket = config.get('S3_BUCKET', { infer: true });
    this.ttl = config.get('S3_PRESIGN_TTL_SECONDS', { infer: true });
  }

  async put(key: string, body: Buffer, contentType: string): Promise<void> {
    assertSafeKey(key);
    await this.client.send(new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: body, ContentType: contentType }));
  }

  async get(key: string): Promise<Buffer> {
    assertSafeKey(key);
    const res = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    return Buffer.from(await res.Body!.transformToByteArray());
  }

  signedUrl(key: string, ttlSeconds = this.ttl): Promise<string> {
    assertSafeKey(key);
    return getSignedUrl(this.signer, new GetObjectCommand({ Bucket: this.bucket, Key: key }), { expiresIn: ttlSeconds });
  }

  async delete(keys: string[]): Promise<void> {
    // DeleteObjects admite hasta 1000 claves por petición.
    for (let i = 0; i < keys.length; i += 1000) {
      const batch = keys.slice(i, i + 1000);
      batch.forEach(assertSafeKey);
      await this.client.send(new DeleteObjectsCommand({ Bucket: this.bucket, Delete: { Objects: batch.map((Key) => ({ Key })), Quiet: true } }));
    }
  }
}
