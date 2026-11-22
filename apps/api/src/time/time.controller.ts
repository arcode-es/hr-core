import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseEnumPipe,
  ParseUUIDPipe,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  AuditEntryDto,
  ClockStatus,
  clockSchema,
  GeofenceMatch,
  hoursQuerySchema,
  PersonRef,
  PositionQuery,
  positionQuerySchema,
  UserHours,
  ManualWorkdayInput,
  manualWorkdaySchema,
  rangeQuerySchema,
  ReviewInput,
  ReviewItem,
  SentHandoverNoteDto,
  reviewSchema,
  TeamDayRow,
  WorkdayDto,
  workdaysQuerySchema,
} from '@hr/shared';
import type { z } from 'zod';
import { AuthUser, CurrentUser, CurrentWorkspace, Meta, RequestMeta, Roles, WorkspaceContext } from '../common/context';
import { MAX_PHOTO_BYTES } from '../common/images';
import { ZodPipe } from '../common/zod.pipe';
import { CorrectionsService } from './corrections.service';
import { HoursService } from './hours.service';
import { TimeService } from './time.service';


@Controller('time')
export class TimeController {
  constructor(
    private readonly time: TimeService,
    private readonly corrections: CorrectionsService,
    private readonly hoursService: HoursService,
  ) {}

  @Get('status')
  status(@CurrentUser() user: AuthUser, @CurrentWorkspace() ws: WorkspaceContext): Promise<ClockStatus> {
    return this.time.status(user.id, ws);
  }

  /**
   * Evento de fichaje. multipart/form-data con `data` (JSON del evento) y,
   * opcionalmente, `photo`: así evento y evidencia llegan en una sola petición.
   */
  @Post('clock')
  @HttpCode(200)
  @UseInterceptors(FileInterceptor('photo', { limits: { fileSize: MAX_PHOTO_BYTES, files: 1 } }))
  clock(
    @CurrentUser() user: AuthUser,
    @CurrentWorkspace() ws: WorkspaceContext,
    @Body('data') data: string,
    @UploadedFile() photo?: Express.Multer.File,
  ): Promise<ClockStatus> {
    let json: unknown;
    try {
      json = JSON.parse(data);
    } catch {
      throw new BadRequestException({ code: 'VALIDATION' });
    }
    const dto = new ZodPipe(clockSchema).transform(json);
    return this.time.clock(user.id, ws, dto, photo && { buffer: photo.buffer, mimetype: photo.mimetype });
  }

  /** A quién se le puede dejar una nota de relevo. */
  @Get('colleagues')
  colleagues(@CurrentUser() user: AuthUser, @CurrentWorkspace() ws: WorkspaceContext): Promise<PersonRef[]> {
    return this.time.colleagues(user.id, ws);
  }

  /** Notas de relevo que ha dejado esta persona, con su entrega. */
  @Get('notes/sent')
  sentNotes(@CurrentUser() user: AuthUser, @CurrentWorkspace() ws: WorkspaceContext): Promise<SentHandoverNoteDto[]> {
    return this.time.sentNotes(user.id, ws);
  }

  /** Marca como leída una nota de relevo recibida. */
  @Post('notes/:id/read')
  @HttpCode(200)
  readNote(@CurrentUser() user: AuthUser, @CurrentWorkspace() ws: WorkspaceContext, @Param('id', ParseUUIDPipe) id: string): Promise<ClockStatus> {
    return this.time.readNote(user.id, ws, id);
  }

  /** Geocerca que se aplicaría ahora mismo al fichar (la del turno asignado, o la más cercana). */
  @Get('geofence')
  async geofence(
    @CurrentUser() user: AuthUser,
    @CurrentWorkspace() ws: WorkspaceContext,
    @Query(new ZodPipe(positionQuerySchema)) pos: PositionQuery,
  ): Promise<{ match: GeofenceMatch | null }> {
    return { match: (await this.time.geofence(user.id, ws, pos)) ?? null };
  }

  /** Bolsas de horas del periodo: propias o, para quien supervisa, de todo el equipo. */
  @Get('hours')
  hours(
    @CurrentUser() user: AuthUser,
    @CurrentWorkspace() ws: WorkspaceContext,
    @Query(new ZodPipe(hoursQuerySchema)) q: z.infer<typeof hoursQuerySchema>,
  ): Promise<UserHours[]> {
    return this.hoursService.summary(user.id, ws, new Date(q.from), new Date(q.to), q.scope === 'team');
  }

  @Get('workdays')
  workdays(
    @CurrentUser() user: AuthUser,
    @CurrentWorkspace() ws: WorkspaceContext,
    @Query(new ZodPipe(workdaysQuerySchema)) q: z.infer<typeof workdaysQuerySchema>,
  ): Promise<WorkdayDto[]> {
    return this.time.workdays(user.id, ws, q.days);
  }

  @Get('entries/:id/photo/:which')
  photo(
    @CurrentUser() user: AuthUser,
    @CurrentWorkspace() ws: WorkspaceContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('which', new ParseEnumPipe(['start', 'end'])) which: 'start' | 'end',
  ): Promise<{ url: string }> {
    return this.time.photoUrl(user.id, ws, id, which);
  }

  // ── Fichaje manual y correcciones ──────────────────────────────────────

  @Post('manual')
  manual(
    @CurrentUser() user: AuthUser,
    @CurrentWorkspace() ws: WorkspaceContext,
    @Body(new ZodPipe(manualWorkdaySchema)) dto: ManualWorkdayInput,
    @Meta() meta: RequestMeta,
  ): Promise<WorkdayDto> {
    return this.corrections.submit(user.id, ws, dto, meta);
  }

  @Post('workdays/:id/correct')
  correct(
    @CurrentUser() user: AuthUser,
    @CurrentWorkspace() ws: WorkspaceContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(manualWorkdaySchema)) dto: ManualWorkdayInput,
    @Meta() meta: RequestMeta,
  ): Promise<WorkdayDto> {
    return this.corrections.submitCorrection(user.id, ws, id, dto, meta);
  }

  @Get('workdays/:id/audit')
  audit(
    @CurrentUser() user: AuthUser,
    @CurrentWorkspace() ws: WorkspaceContext,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<AuditEntryDto[]> {
    return this.corrections.auditTrail(user.id, ws, id);
  }

  // ── Supervisión ────────────────────────────────────────────────────────

  @Get('review')
  @Roles('ADMIN', 'MANAGER')
  pending(@CurrentUser() user: AuthUser, @CurrentWorkspace() ws: WorkspaceContext): Promise<ReviewItem[]> {
    return this.corrections.pending(user.id, ws);
  }

  @Post('review/:workdayId')
  @Roles('ADMIN', 'MANAGER')
  @HttpCode(204)
  review(
    @CurrentUser() user: AuthUser,
    @CurrentWorkspace() ws: WorkspaceContext,
    @Param('workdayId', ParseUUIDPipe) workdayId: string,
    @Body(new ZodPipe(reviewSchema)) dto: ReviewInput,
    @Meta() meta: RequestMeta,
  ): Promise<void> {
    return this.corrections.review(user.id, ws, workdayId, dto, meta);
  }

  @Get('team')
  @Roles('ADMIN', 'MANAGER', 'INSPECTOR')
  team(
    @CurrentUser() user: AuthUser,
    @CurrentWorkspace() ws: WorkspaceContext,
    @Query(new ZodPipe(rangeQuerySchema)) q: z.infer<typeof rangeQuerySchema>,
  ): Promise<TeamDayRow[]> {
    return this.corrections.teamDay(user.id, ws, new Date(q.from), new Date(q.to));
  }
}
