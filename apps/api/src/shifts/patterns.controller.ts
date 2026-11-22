import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { type ApplyPatternInput, applyPatternSchema, type ApplyPatternResult, type ShiftPatternDto, type ShiftPatternInput, shiftPatternSchema } from '@hr/shared';
import { type AuthUser, CurrentUser, CurrentWorkspace, Roles, type WorkspaceContext } from '../common/context';
import { ZodPipe } from '../common/zod.pipe';
import { ShiftPatternsService } from './patterns.service';

@Controller('shift-patterns')
@Roles('ADMIN', 'MANAGER')
export class ShiftPatternsController {
  constructor(private readonly patterns: ShiftPatternsService) {}

  @Get()
  list(@CurrentWorkspace() ws: WorkspaceContext): Promise<ShiftPatternDto[]> {
    return this.patterns.list(ws);
  }

  @Post()
  create(@CurrentWorkspace() ws: WorkspaceContext, @Body(new ZodPipe(shiftPatternSchema)) dto: ShiftPatternInput): Promise<ShiftPatternDto> {
    return this.patterns.create(ws, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@CurrentWorkspace() ws: WorkspaceContext, @Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.patterns.remove(ws, id);
  }

  /** Crea los turnos del patrón como borradores: hay que publicarlos después, como cualquier otro. */
  @Post(':id/apply')
  @HttpCode(200)
  apply(
    @CurrentUser() user: AuthUser,
    @CurrentWorkspace() ws: WorkspaceContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(applyPatternSchema)) dto: ApplyPatternInput,
  ): Promise<ApplyPatternResult> {
    return this.patterns.apply(user.id, ws, id, dto);
  }
}
