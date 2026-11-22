import { Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { parseClock, wallTime } from '../common/tz';
import type { Env } from '../config/env';
import { PrismaService } from '../prisma/prisma.service';

/** Cada cuántos minutos, o una vez al día a partir de una hora local ("HH:mm"). */
export type JobSchedule = { everyMinutes: number } | { dailyAt: string };

export interface Job {
  name: string;
  schedule: JobSchedule;
  run(now: Date): Promise<void>;
}

const pad = (n: number): string => String(n).padStart(2, '0');

/**
 * Programador interno. Cada minuto mira qué tareas tocan y las ejecuta.
 *
 * Para que cada tarea corra una sola vez por turno aunque haya varias instancias
 * de la API, antes de ejecutarla se «reserva» su turno insertando (job, slot) en
 * job_runs, que es único: solo una instancia lo consigue. Una tarea diaria que no
 * pudo correr a su hora (servidor parado) se ejecuta en cuanto vuelve.
 */
@Injectable()
export class JobsService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly log = new Logger('Tareas');
  private readonly jobs: Job[] = [];
  private readonly enabled: boolean;
  private readonly timezone: string;
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService<Env, true>,
  ) {
    this.enabled = config.get('JOBS_ENABLED', { infer: true });
    this.timezone = config.get('JOBS_TIMEZONE', { infer: true });
    this.register({
      name: 'limpiar-historial-de-tareas',
      schedule: { dailyAt: '04:30' },
      run: async (now) => {
        await this.prisma.jobRun.deleteMany({ where: { startedAt: { lt: new Date(now.getTime() - 30 * 86_400_000) } } });
      },
    });
  }

  register(job: Job): void {
    if (this.jobs.some((j) => j.name === job.name)) throw new Error(`Tarea duplicada: ${job.name}`);
    this.jobs.push(job);
  }

  onApplicationBootstrap(): void {
    if (!this.enabled) return;
    // Primera pasada poco después de arrancar; luego cada minuto.
    setTimeout(() => void this.tick(new Date()), 5_000).unref();
    this.timer = setInterval(() => void this.tick(new Date()), 60_000);
    this.timer.unref();
  }

  onApplicationShutdown(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** Turno de una tarea en este instante, o null si todavía no le toca. */
  slot(schedule: JobSchedule, now: Date): string | null {
    if ('everyMinutes' in schedule) return `i${schedule.everyMinutes}:${Math.floor(now.getTime() / (schedule.everyMinutes * 60_000))}`;
    const w = wallTime(now, this.timezone);
    const at = parseClock(schedule.dailyAt);
    if (w.hour * 60 + w.minute < at.hour * 60 + at.minute) return null;
    return `d:${w.year}-${pad(w.month)}-${pad(w.day)}`;
  }

  /** Ejecuta lo que toque (o, en los tests, solo las tareas indicadas). Público para los tests, que avanzan el reloj a mano. */
  async tick(now: Date, only?: string[]): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      for (const job of this.jobs) {
        if (only && !only.includes(job.name)) continue;
        const slot = this.slot(job.schedule, now);
        if (slot) await this.runOnce(job, slot, now);
      }
    } finally {
      this.running = false;
    }
  }

  private async runOnce(job: Job, slot: string, now: Date): Promise<void> {
    let runId: string;
    try {
      runId = (await this.prisma.jobRun.create({ data: { job: job.name, slot }, select: { id: true } })).id;
    } catch (e) {
      // Ya la ejecutó (o la está ejecutando) esta u otra instancia.
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') return;
      throw e;
    }
    try {
      await job.run(now);
      await this.prisma.jobRun.update({ where: { id: runId }, data: { finishedAt: new Date() } });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      this.log.error(`«${job.name}» ha fallado: ${message}`);
      await this.prisma.jobRun.update({ where: { id: runId }, data: { finishedAt: new Date(), error: message.slice(0, 2000) } }).catch(() => undefined);
    }
  }
}
