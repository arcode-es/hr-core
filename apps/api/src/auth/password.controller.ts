import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Req } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ChangePasswordInput, changePasswordSchema, SessionDto } from '@hr/shared';
import type { Request } from 'express';
import { AuthUser, CurrentUser, AllowReadOnly } from '../common/context';
import { strictLimit } from '../common/throttle';
import { ZodPipe } from '../common/zod.pipe';
import { AuthService } from './auth.service';

const current = (req: Request): string | undefined => req.cookies?.hr_rt as string | undefined;

/**
 * Seguridad de la cuenta con sesión iniciada. Bajo /auth para recibir la cookie
 * de renovación: así se sabe cuál es la sesión de este dispositivo.
 */
@AllowReadOnly()
@Controller('auth')
export class PasswordController {
  constructor(private readonly auth: AuthService) {}

  @Post('password')
  @HttpCode(204)
  @Throttle({ default: { limit: strictLimit(5), ttl: 60_000 } })
  change(@CurrentUser() user: AuthUser, @Body(new ZodPipe(changePasswordSchema)) dto: ChangePasswordInput, @Req() req: Request): Promise<void> {
    return this.auth.changePassword(user.id, dto, current(req));
  }

  @Post('verify-email/resend')
  @HttpCode(204)
  @Throttle({ default: { limit: strictLimit(3), ttl: 60_000 } })
  resendVerification(@CurrentUser() user: AuthUser): Promise<void> {
    return this.auth.sendVerification(user.id);
  }

  @Get('sessions')
  sessions(@CurrentUser() user: AuthUser, @Req() req: Request): Promise<SessionDto[]> {
    return this.auth.sessions(user.id, current(req));
  }

  /** Cierra la sesión en todos los dispositivos menos este. */
  @Delete('sessions')
  @HttpCode(204)
  revokeOthers(@CurrentUser() user: AuthUser, @Req() req: Request): Promise<void> {
    return this.auth.revokeSessions(user.id, null, current(req));
  }

  @Delete('sessions/:id')
  @HttpCode(204)
  revoke(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Req() req: Request): Promise<void> {
    return this.auth.revokeSessions(user.id, id, current(req));
  }
}
