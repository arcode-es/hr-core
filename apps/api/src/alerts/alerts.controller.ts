import { Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import type { AlertDto } from '@hr/shared';
import { type AuthUser, CurrentUser, CurrentWorkspace, Roles, type WorkspaceContext } from '../common/context';
import { AlertsService } from './alerts.service';

@Controller('alerts')
export class AlertsController {
  constructor(private readonly alerts: AlertsService) {}

  /** Alertas de la empresa: las abiertas o, con `status=all`, también las resueltas. */
  @Get()
  @Roles('ADMIN', 'MANAGER', 'INSPECTOR')
  list(@CurrentUser() user: AuthUser, @CurrentWorkspace() ws: WorkspaceContext, @Query('status') status?: string): Promise<AlertDto[]> {
    return this.alerts.list(user.id, ws, status === 'all' ? 'all' : 'open');
  }

  @Post(':id/resolve')
  @Roles('ADMIN', 'MANAGER')
  @HttpCode(200)
  resolve(@CurrentUser() user: AuthUser, @CurrentWorkspace() ws: WorkspaceContext, @Param('id', ParseUUIDPipe) id: string): Promise<AlertDto> {
    return this.alerts.resolve(user.id, ws, id);
  }
}
