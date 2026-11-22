import { Body, Controller, HttpCode, Post, Req, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Throttle } from '@nestjs/throttler';
import {
  AuthResponse,
  checkResetSchema,
  ForgotPasswordInput,
  forgotPasswordSchema,
  LoginInput,
  loginSchema,
  RegisterInput,
  registerSchema,
  ResetPasswordInput,
  resetPasswordSchema,
  verifyEmailSchema,
} from '@hr/shared';
import type { z } from 'zod';
import type { Request, Response } from 'express';
import { Meta, Public, RequestMeta } from '../common/context';
import { ZodPipe } from '../common/zod.pipe';
import type { Env } from '../config/env';
import { Deployment } from '../deployment/deployment';
import { AuthService, IssuedTokens } from './auth.service';

const COOKIE = 'hr_rt';
/** Intentos por minuto en registro e inicio de sesión. */
const authLimit = (): number => Number(process.env.AUTH_RATE_LIMIT_PER_MINUTE ?? 10);

/**
 * El token de renovación viaja solo en una cookie httpOnly limitada a /auth;
 * el de acceso se devuelve en el cuerpo y el cliente lo guarda en memoria.
 */
@Public()
@Controller('auth')
export class AuthController {
  private readonly secure: boolean;
  /** Incluye la carpeta donde se publica la app (p. ej. /HR-core/api/v1/auth). */
  private readonly cookiePath: string;

  constructor(
    private readonly auth: AuthService,
    deployment: Deployment,
    config: ConfigService<Env, true>,
  ) {
    this.secure = config.get('NODE_ENV', { infer: true }) === 'production';
    this.cookiePath = deployment.cookiePath;
  }

  @Post('register')
  @Throttle({ default: { limit: authLimit, ttl: 60_000 } })
  async register(
    @Body(new ZodPipe(registerSchema)) dto: RegisterInput,
    @Meta() meta: RequestMeta,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthResponse> {
    return this.respond(res, await this.auth.register(dto, meta));
  }

  @Post('login')
  @HttpCode(200)
  @Throttle({ default: { limit: authLimit, ttl: 60_000 } })
  async login(
    @Body(new ZodPipe(loginSchema)) dto: LoginInput,
    @Meta() meta: RequestMeta,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthResponse> {
    return this.respond(res, await this.auth.login(dto, meta));
  }

  @Post('refresh')
  @HttpCode(200)
  async refresh(
    @Req() req: Request,
    @Meta() meta: RequestMeta,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthResponse> {
    return this.respond(res, await this.auth.refresh(req.cookies?.[COOKIE] as string | undefined, meta));
  }

  @Post('forgot-password')
  @HttpCode(204)
  @Throttle({ default: { limit: authLimit, ttl: 60_000 } })
  forgot(@Body(new ZodPipe(forgotPasswordSchema)) dto: ForgotPasswordInput, @Meta() meta: RequestMeta): Promise<void> {
    return this.auth.forgotPassword(dto.email, meta);
  }

  /** POST y no GET: así el token no queda en los logs de acceso del servidor. */
  @Post('reset-password/check')
  @HttpCode(200)
  @Throttle({ default: { limit: authLimit, ttl: 60_000 } })
  checkReset(@Body(new ZodPipe(checkResetSchema)) dto: z.infer<typeof checkResetSchema>): Promise<{ valid: boolean }> {
    return this.auth.checkReset(dto.token);
  }

  @Post('reset-password')
  @HttpCode(204)
  @Throttle({ default: { limit: authLimit, ttl: 60_000 } })
  async reset(@Body(new ZodPipe(resetPasswordSchema)) dto: ResetPasswordInput, @Res({ passthrough: true }) res: Response): Promise<void> {
    await this.auth.resetPassword(dto);
    res.clearCookie(COOKIE, { path: this.cookiePath });
  }

  /** Confirmar el correo con el enlace recibido. No exige sesión: el enlace se puede abrir en otro dispositivo. */
  @Post('verify-email')
  @HttpCode(204)
  @Throttle({ default: { limit: authLimit, ttl: 60_000 } })
  verifyEmail(@Body(new ZodPipe(verifyEmailSchema)) dto: z.infer<typeof verifyEmailSchema>): Promise<void> {
    return this.auth.verifyEmail(dto.token);
  }

  @Post('logout')
  @HttpCode(204)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<void> {
    await this.auth.logout(req.cookies?.[COOKIE] as string | undefined);
    res.clearCookie(COOKIE, { path: this.cookiePath });
  }

  private respond(res: Response, t: IssuedTokens): AuthResponse {
    res.cookie(COOKIE, t.refreshToken, {
      httpOnly: true,
      secure: this.secure,
      sameSite: 'lax',
      path: this.cookiePath,
      expires: t.refreshExpiresAt,
    });
    return { accessToken: t.accessToken, expiresIn: t.expiresIn };
  }
}
