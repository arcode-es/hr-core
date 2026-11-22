import type { INestApplication } from '@nestjs/common';
import { Test, type TestingModuleBuilder } from '@nestjs/testing';
import request from 'supertest';

/**
 * Arranca la API con un entorno concreto (p. ej. DEPLOY_MODE=demo). ConfigModule lee
 * el entorno al cargar AppModule, así que este se carga aquí, después de fijarlo; el
 * test no debe importarlo antes. Jest da a cada archivo de pruebas su propio process.env.
 */
export async function bootApp(
  env: Record<string, string>,
  customize: (b: TestingModuleBuilder) => TestingModuleBuilder = (b) => b,
): Promise<{ app: INestApplication; http: ReturnType<typeof request> }> {
  Object.assign(process.env, env);
  const { AppModule } = require('../app.module') as typeof import('../app.module');
  const { setupApp } = require('../setup') as typeof import('../setup');
  const compiled = await customize(Test.createTestingModule({ imports: [AppModule] })).compile();
  const app = compiled.createNestApplication({ rawBody: true });
  setupApp(app);
  await app.init();
  return { app, http: request(app.getHttpServer()) };
}

export const cookieOf = (res: request.Response): string => (res.get('Set-Cookie') ?? [])[0]!.split(';')[0]!;
export const bearer = (token: string): { Authorization: string } => ({ Authorization: `Bearer ${token}` });
