import { Body, Controller, Get, HttpCode, Post, Res } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { type DeleteAccountInput, deleteAccountSchema, type GeoNoticeDto } from '@hr/shared';
import type { Response } from 'express';
import { AuthUser, CurrentUser, CurrentWorkspace, WorkspaceContext, AllowReadOnly } from '../common/context';
import { strictLimit } from '../common/throttle';
import { ZodPipe } from '../common/zod.pipe';
import { PrivacyService } from './privacy.service';

@Controller()
export class PrivacyController {
  constructor(private readonly privacy: PrivacyService) {}

  @Get('time/geo-notice')
  geoNotice(@CurrentWorkspace() ws: WorkspaceContext): Promise<GeoNoticeDto> {
    return this.privacy.geoNotice(ws);
  }

  @Post('time/geo-notice')
  @HttpCode(204)
  acceptGeoNotice(@CurrentWorkspace() ws: WorkspaceContext): Promise<void> {
    return this.privacy.acceptGeoNotice(ws);
  }

  @Get('me/export')
  @Throttle({ default: { limit: strictLimit(5), ttl: 60_000 } })
  async export(@CurrentUser() user: AuthUser, @Res() res: Response): Promise<void> {
    const { zip, name } = await this.privacy.export(user.id);
    res.set({ 'Content-Type': 'application/zip', 'Content-Disposition': `attachment; filename="${name}.zip"`, 'Cache-Control': 'no-store' });
    res.send(zip);
  }

  @AllowReadOnly()
  @Post('me/delete')
  @HttpCode(204)
  @Throttle({ default: { limit: strictLimit(5), ttl: 60_000 } })
  deleteAccount(@CurrentUser() user: AuthUser, @Body(new ZodPipe(deleteAccountSchema)) dto: DeleteAccountInput): Promise<void> {
    return this.privacy.deleteAccount(user.id, dto.password);
  }
}
