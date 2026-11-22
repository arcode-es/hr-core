import { CreateBucketCommand, S3Client } from '@aws-sdk/client-s3';
import type { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env';
import { S3Storage } from './s3.storage';
import { assertSafeKey } from './storage';

describe('assertSafeKey', () => {
  it('acepta claves generadas por el servidor', () => {
    expect(() => assertSafeKey('time/9b2f/2026/11/abc-start.jpg')).not.toThrow();
  });
  it.each(['../etc/passwd', 'a/../../b', '/abs', 'a//b', 'con espacio', ''])('rechaza %p', (key) => {
    expect(() => assertSafeKey(key)).toThrow();
  });
});

// Se ejecuta solo si hay un S3 de pruebas (MinIO o un emulador):
//   S3_TEST_ENDPOINT=http://localhost:9000 pnpm test
const endpoint = process.env.S3_TEST_ENDPOINT;
(endpoint ? describe : describe.skip)('S3Storage', () => {
  const values: Record<string, unknown> = {
    S3_ENDPOINT: endpoint,
    S3_PUBLIC_ENDPOINT: endpoint,
    S3_REGION: 'us-east-1',
    S3_FORCE_PATH_STYLE: true,
    S3_ACCESS_KEY: process.env.S3_ACCESS_KEY ?? 'test',
    S3_SECRET_KEY: process.env.S3_SECRET_KEY ?? 'test',
    S3_BUCKET: `hr-test-${Date.now()}`,
    S3_PRESIGN_TTL_SECONDS: 60,
  };
  const config = { get: (k: string) => values[k] } as unknown as ConfigService<Env, true>;
  const storage = new S3Storage(config);

  beforeAll(async () => {
    const client = new S3Client({
      endpoint,
      region: 'us-east-1',
      forcePathStyle: true,
      credentials: { accessKeyId: values.S3_ACCESS_KEY as string, secretAccessKey: values.S3_SECRET_KEY as string },
    });
    await client.send(new CreateBucketCommand({ Bucket: values.S3_BUCKET as string }));
  });

  it('guarda, lee y firma un enlace que descarga el mismo contenido', async () => {
    const body = Buffer.from('contenido de prueba');
    await storage.put('time/u1/2026/11/x-start.jpg', body, 'image/jpeg');
    expect((await storage.get('time/u1/2026/11/x-start.jpg')).equals(body)).toBe(true);

    const url = await storage.signedUrl('time/u1/2026/11/x-start.jpg');
    expect(url).toContain('X-Amz-Signature=');
    const res = await fetch(url);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/jpeg');
    expect(Buffer.from(await res.arrayBuffer()).equals(body)).toBe(true);
  });

  it('sin firma no se puede leer', async () => {
    const res = await fetch(`${endpoint}/${values.S3_BUCKET as string}/time/u1/2026/11/x-start.jpg`);
    expect(res.status).toBe(403);
  });
});
