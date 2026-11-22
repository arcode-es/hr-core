import { Controller, Get, HttpCode, ServiceUnavailableException } from '@nestjs/common';
import type { HealthStatus } from '@hr/shared';
import { Public } from '../common/context';
import { PrismaService } from '../prisma/prisma.service';

const VERSION = process.env.npm_package_version ?? '0.1.0';

@Public()
@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  /** Liveness: el proceso responde. */
  @Get('live')
  @HttpCode(200)
  live(): { status: 'ok' } {
    return { status: 'ok' };
  }

  /** Readiness: base de datos y PostGIS disponibles. Devuelve la hora oficial del servidor. */
  @Get()
  async ready(): Promise<HealthStatus> {
    let postgis: string | null = null;
    let up = false;
    try {
      const rows = await this.prisma.$queryRaw<{ v: string }[]>`SELECT postgis_lib_version() AS v`;
      postgis = rows[0]?.v ?? null;
      up = true;
    } catch {
      up = false;
    }
    const body: HealthStatus = {
      status: up ? 'ok' : 'degraded',
      version: VERSION,
      serverTime: new Date().toISOString(),
      database: { up, postgis },
    };
    if (!up) throw new ServiceUnavailableException(body);
    return body;
  }
}
