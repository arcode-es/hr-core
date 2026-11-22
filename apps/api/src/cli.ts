import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';

/*
 * Línea de comandos de administración del servidor.
 *
 *   node dist/cli.js create-organization --name "Construcciones Pérez S.L." --tax-id B12345678 \
 *        --admin-email jefa@construccionesperez.es --admin-name "Marta Pérez"
 *   node dist/cli.js reset-link --email jefa@construccionesperez.es     (recuperar el acceso sin correo)
 *   node dist/cli.js demo-reset
 *
 * En Docker: docker compose exec api node dist/cli.js <orden> ...
 */

function option(args: string[], name: string): string | undefined {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
}

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);
  // La línea de comandos no ejecuta las tareas programadas: de eso se encarga la API.
  process.env.JOBS_ENABLED = 'false';
  const { AppModule } = await import('./app.module');
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  try {
    if (command === 'create-organization') {
      const name = option(args, 'name');
      const adminEmail = option(args, 'admin-email');
      const adminName = option(args, 'admin-name');
      if (!name || !adminEmail || !adminName) throw new Error('Faltan --name, --admin-email o --admin-name');
      const { InstallService } = await import('./install/install.service');
      const r = await app.get(InstallService).createOrganization({ name, adminEmail, adminName, taxId: option(args, 'tax-id'), locale: option(args, 'locale') === 'en' ? 'en' : 'es' });
      console.log(`Empresa creada: ${r.organizationId}`);
      console.log(r.emailed ? `Enlace enviado a ${adminEmail}.` : 'No se ha enviado el correo: pásale este enlace.');
      console.log(`Enlace para elegir la contraseña (7 días): ${r.setupUrl}`);
    } else if (command === 'reset-link') {
      const email = option(args, 'email');
      if (!email) throw new Error('Falta --email');
      const { InstallService } = await import('./install/install.service');
      console.log(`Enlace para elegir contraseña nueva (24 horas): ${await app.get(InstallService).resetLink(email)}`);
    } else if (command === 'demo-reset') {
      const { DemoService } = await import('./demo/demo.service');
      await app.get(DemoService).reset(new Date());
      console.log('Demo restablecida.');
    } else {
      console.log('Órdenes: create-organization, reset-link, demo-reset');
      process.exitCode = 1;
    }
  } finally {
    await app.close();
  }
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
