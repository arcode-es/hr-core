import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import type { Env } from '../config/env';
import { assertSafeKey, Storage } from './storage';

/**
 * Almacén en disco para instalaciones sin S3 y para pruebas. Mantiene la misma
 * garantía que S3: los archivos solo se leen con un enlace firmado que caduca
 * (ver FilesController).
 */
@Injectable()
export class LocalStorage extends Storage {
  private readonly root: string;
  private readonly secret: string;
  private readonly publicUrl: string;
  private readonly ttl: number;

  constructor(config: ConfigService<Env, true>) {
    super();
    this.root = resolve(config.get('STORAGE_LOCAL_DIR', { infer: true }));
    this.secret = config.get('JWT_ACCESS_SECRET', { infer: true });
    this.publicUrl = config.get('API_PUBLIC_URL', { infer: true }).replace(/\/$/, '');
    this.ttl = config.get('S3_PRESIGN_TTL_SECONDS', { infer: true });
  }

  private path(key: string): string {
    assertSafeKey(key);
    return resolve(this.root, key);
  }

  private sign(key: string, exp: number): string {
    return createHmac('sha256', this.secret).update(`file:${key}:${exp}`).digest('base64url');
  }

  async put(key: string, body: Buffer, contentType: string): Promise<void> {
    const file = this.path(key);
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, body);
    await writeFile(`${file}.type`, contentType);
  }

  async delete(keys: string[]): Promise<void> {
    for (const key of keys) {
      await rm(this.path(key), { force: true });
      await rm(`${this.path(key)}.type`, { force: true });
    }
  }

  get(key: string): Promise<Buffer> {
    return readFile(this.path(key));
  }

  async contentType(key: string): Promise<string> {
    return (await readFile(`${this.path(key)}.type`, 'utf8').catch(() => 'application/octet-stream')).trim();
  }

  signedUrl(key: string, ttlSeconds = this.ttl): Promise<string> {
    assertSafeKey(key);
    const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
    return Promise.resolve(`${this.publicUrl}/api/v1/files/${key}?exp=${exp}&sig=${this.sign(key, exp)}`);
  }

  /** Comprueba firma y caducidad de un enlace emitido por signedUrl. */
  verify(key: string, exp: number, sig: string): boolean {
    if (!Number.isFinite(exp) || exp < Date.now() / 1000) return false;
    const expected = Buffer.from(this.sign(key, exp));
    const given = Buffer.from(sig);
    return expected.length === given.length && timingSafeEqual(expected, given);
  }
}
