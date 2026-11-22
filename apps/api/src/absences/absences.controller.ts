import { BadRequestException, Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Query, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  type AbsenceDto,
  absenceRangeSchema,
  type AbsenceReviewInput,
  absenceReviewSchema,
  absenceSchema,
  type HolidayDto,
  type HolidayInput,
  holidayImportSchema,
  holidaySchema,
  MAX_DOCUMENT_BYTES,
  type TeamCalendar,
  type VacationBalance,
  yearQuerySchema,
} from '@hr/shared';
import type { z } from 'zod';
import { AuthUser, CurrentUser, CurrentWorkspace, Roles, WorkspaceContext } from '../common/context';
import { ZodPipe } from '../common/zod.pipe';
import { AbsencesService } from './absences.service';
import { HolidaysService } from './holidays.service';

const orgId = (ws: WorkspaceContext): string => {
  if (ws.kind !== 'organization') throw new BadRequestException({ code: 'FORBIDDEN_WORKSPACE' });
  return ws.organizationId;
};

@Controller()
export class AbsencesController {
  constructor(
    private readonly absences: AbsencesService,
    private readonly holidays: HolidaysService,
  ) {}

  // ── Festivos ───────────────────────────────────────────────────────────

  @Get('holidays')
  listHolidays(@CurrentWorkspace() ws: WorkspaceContext, @Query(new ZodPipe(yearQuerySchema)) q: z.infer<typeof yearQuerySchema>): Promise<HolidayDto[]> {
    return this.holidays.list(orgId(ws), `${q.year}-01-01`, `${q.year}-12-31`);
  }

  @Post('holidays')
  @Roles('ADMIN')
  createHoliday(@CurrentWorkspace() ws: WorkspaceContext, @Body(new ZodPipe(holidaySchema)) dto: HolidayInput): Promise<HolidayDto> {
    return this.holidays.create(orgId(ws), dto);
  }

  @Post('holidays/import')
  @Roles('ADMIN')
  importHolidays(@CurrentWorkspace() ws: WorkspaceContext, @Body(new ZodPipe(holidayImportSchema)) dto: z.infer<typeof holidayImportSchema>): Promise<{ imported: number; skipped: number }> {
    return this.holidays.import(orgId(ws), dto.year);
  }

  @Delete('holidays/:id')
  @Roles('ADMIN')
  @HttpCode(204)
  removeHoliday(@CurrentWorkspace() ws: WorkspaceContext, @Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.holidays.remove(orgId(ws), id);
  }

  // ── Ausencias ──────────────────────────────────────────────────────────

  @Get('absences')
  mine(@CurrentUser() user: AuthUser, @CurrentWorkspace() ws: WorkspaceContext, @Query(new ZodPipe(absenceRangeSchema)) q: z.infer<typeof absenceRangeSchema>): Promise<AbsenceDto[]> {
    return this.absences.mine(user.id, ws, q.from, q.to);
  }

  @Get('absences/calendar')
  calendar(@CurrentUser() user: AuthUser, @CurrentWorkspace() ws: WorkspaceContext, @Query(new ZodPipe(absenceRangeSchema)) q: z.infer<typeof absenceRangeSchema>): Promise<TeamCalendar> {
    return this.absences.calendar(user.id, ws, q.from, q.to);
  }

  @Get('absences/pending')
  pending(@CurrentUser() user: AuthUser, @CurrentWorkspace() ws: WorkspaceContext): Promise<AbsenceDto[]> {
    return this.absences.pending(user.id, ws);
  }

  @Get('absences/balance')
  balance(
    @CurrentUser() user: AuthUser,
    @CurrentWorkspace() ws: WorkspaceContext,
    @Query('year') year: string | undefined,
    @Query('userId') userId: string | undefined,
  ): Promise<VacationBalance> {
    const y = Number(year ?? new Date().getFullYear());
    if (!Number.isInteger(y) || y < 2000 || y > 2100) throw new BadRequestException({ code: 'VALIDATION' });
    return this.absences.balance(user.id, ws, y, userId || undefined);
  }

  /** Multipart: `data` (JSON) y, opcionalmente, `attachment` (PDF o imagen del justificante). */
  @Post('absences')
  @UseInterceptors(FileInterceptor('attachment', { limits: { fileSize: MAX_DOCUMENT_BYTES, files: 1 } }))
  create(
    @CurrentUser() user: AuthUser,
    @CurrentWorkspace() ws: WorkspaceContext,
    @Body('data') data: string,
    @UploadedFile() attachment?: Express.Multer.File,
  ): Promise<AbsenceDto> {
    let json: unknown;
    try {
      json = JSON.parse(data);
    } catch {
      throw new BadRequestException({ code: 'VALIDATION' });
    }
    const parsed = absenceSchema.safeParse(json);
    if (!parsed.success) throw new BadRequestException({ code: 'VALIDATION', issues: parsed.error.issues });
    return this.absences.create(user.id, ws, parsed.data, attachment && { buffer: attachment.buffer });
  }

  @Post('absences/:id/review')
  @HttpCode(200)
  review(
    @CurrentUser() user: AuthUser,
    @CurrentWorkspace() ws: WorkspaceContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(absenceReviewSchema)) dto: AbsenceReviewInput,
  ): Promise<AbsenceDto> {
    return this.absences.review(user.id, ws, id, dto);
  }

  @Post('absences/:id/cancel')
  @HttpCode(200)
  cancel(@CurrentUser() user: AuthUser, @CurrentWorkspace() ws: WorkspaceContext, @Param('id', ParseUUIDPipe) id: string): Promise<AbsenceDto> {
    return this.absences.cancel(user.id, ws, id);
  }

  @Get('absences/:id/attachment')
  attachment(@CurrentUser() user: AuthUser, @CurrentWorkspace() ws: WorkspaceContext, @Param('id', ParseUUIDPipe) id: string): Promise<{ url: string }> {
    return this.absences.attachmentUrl(user.id, ws, id);
  }
}
