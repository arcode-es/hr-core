import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import {
  CopyShiftsInput,
  copyShiftsSchema,
  createShiftsSchema,
  rangeQuerySchema,
  ShiftDto,
  UpdateShiftInput,
  updateShiftSchema,
} from '@hr/shared';
import type { z } from 'zod';
import { AuthUser, CurrentUser, CurrentWorkspace, Roles, WorkspaceContext } from '../common/context';
import { ZodPipe } from '../common/zod.pipe';
import { ShiftsService } from './shifts.service';

type Range = z.infer<typeof rangeQuerySchema>;

@Controller('shifts')
export class ShiftsController {
  constructor(private readonly shifts: ShiftsService) {}

  @Get()
  list(@CurrentUser() user: AuthUser, @CurrentWorkspace() ws: WorkspaceContext, @Query(new ZodPipe(rangeQuerySchema)) q: Range): Promise<ShiftDto[]> {
    return this.shifts.list(user.id, ws, new Date(q.from), new Date(q.to));
  }

  @Post()
  create(
    @CurrentUser() user: AuthUser,
    @CurrentWorkspace() ws: WorkspaceContext,
    @Body(new ZodPipe(createShiftsSchema)) dto: z.infer<typeof createShiftsSchema>,
  ): Promise<ShiftDto[]> {
    return this.shifts.create(user.id, ws, dto.shifts);
  }

  @Post('copy')
  @HttpCode(200)
  copy(
    @CurrentUser() user: AuthUser,
    @CurrentWorkspace() ws: WorkspaceContext,
    @Body(new ZodPipe(copyShiftsSchema)) dto: CopyShiftsInput,
  ): Promise<{ copied: number; skipped: number }> {
    return this.shifts.copy(user.id, ws, dto);
  }

  @Post('publish')
  @Roles('ADMIN', 'MANAGER')
  @HttpCode(200)
  publish(@CurrentUser() user: AuthUser, @CurrentWorkspace() ws: WorkspaceContext, @Body(new ZodPipe(rangeQuerySchema)) dto: Range): Promise<{ published: number }> {
    return this.shifts.publish(user.id, ws, new Date(dto.from), new Date(dto.to));
  }

  @Patch(':id')
  update(
    @CurrentUser() user: AuthUser,
    @CurrentWorkspace() ws: WorkspaceContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(updateShiftSchema)) dto: UpdateShiftInput,
  ): Promise<ShiftDto> {
    return this.shifts.update(user.id, ws, id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@CurrentUser() user: AuthUser, @CurrentWorkspace() ws: WorkspaceContext, @Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.shifts.remove(user.id, ws, id);
  }
}
