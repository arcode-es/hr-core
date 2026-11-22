import { BadRequestException, Body, Controller, Delete, Get, Headers, HttpCode, Param, ParseUUIDPipe, Post, Put, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import {
  type ClockStatus,
  type KioskDeviceDto,
  type KioskIdentifyInput,
  type KioskIdentity,
  type KioskInfo,
  type KioskInput,
  type KioskPairingDto,
  kioskClockSchema,
  kioskIdentifySchema,
  kioskPairSchema,
  kioskPinSchema,
  kioskSchema,
} from '@hr/shared';
import type { Response } from 'express';
import { CurrentWorkspace, Public, Roles, type WorkspaceContext } from '../common/context';
import { MAX_PHOTO_BYTES } from '../common/images';
import { qrCard } from '../common/qr';
import { strictLimit } from '../common/throttle';
import { ZodPipe } from '../common/zod.pipe';
import { KioskService } from './kiosk.service';

/** Prefijo de las tarjetas personales: la tablet sabe que no es un QR de ubicación. */
export const CARD_PREFIX = 'hrcore-card:';

@Controller()
export class KioskController {
  constructor(private readonly kiosks: KioskService) {}

  // ── Administración ─────────────────────────────────────────────────────

  @Get('kiosks')
  @Roles('ADMIN')
  list(@CurrentWorkspace() ws: WorkspaceContext): Promise<KioskDeviceDto[]> {
    return this.kiosks.list(ws);
  }

  @Post('kiosks')
  @Roles('ADMIN')
  create(@CurrentWorkspace() ws: WorkspaceContext, @Body(new ZodPipe(kioskSchema)) dto: KioskInput): Promise<KioskPairingDto> {
    return this.kiosks.create(ws, dto);
  }

  @Post('kiosks/:id/pairing')
  @Roles('ADMIN')
  @HttpCode(200)
  pairing(@CurrentWorkspace() ws: WorkspaceContext, @Param('id', ParseUUIDPipe) id: string): Promise<KioskPairingDto> {
    return this.kiosks.pairing(ws, id);
  }

  @Delete('kiosks/:id')
  @Roles('ADMIN')
  @HttpCode(204)
  revoke(@CurrentWorkspace() ws: WorkspaceContext, @Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.kiosks.revoke(ws, id);
  }

  @Delete('members/:id/kiosk-pin')
  @Roles('ADMIN')
  @HttpCode(204)
  clearPin(@CurrentWorkspace() ws: WorkspaceContext, @Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.kiosks.clearPin(ws, id);
  }

  /** Tarjeta personal con QR para identificarse en el quiosco (luego pide el PIN). */
  @Get('members/:id/kiosk-card.pdf')
  @Roles('ADMIN')
  async card(@CurrentWorkspace() ws: WorkspaceContext, @Param('id', ParseUUIDPipe) id: string, @Res() res: Response): Promise<void> {
    const c = await this.kiosks.card(ws, id);
    const pdf = await qrCard({ name: c.name, organization: c.organization, qrText: `${CARD_PREFIX}${c.code}` });
    res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="tarjeta-${id.slice(0, 8)}.pdf"`, 'Cache-Control': 'no-store' });
    res.send(pdf);
  }

  // ── Mi PIN ─────────────────────────────────────────────────────────────

  @Get('me/kiosk-pin')
  hasPin(@CurrentWorkspace() ws: WorkspaceContext): Promise<{ set: boolean }> {
    return this.kiosks.hasPin(ws);
  }

  @Put('me/kiosk-pin')
  @Roles('ADMIN', 'MANAGER', 'EMPLOYEE')
  @HttpCode(204)
  @Throttle({ default: { limit: strictLimit(10), ttl: 60_000 } })
  setPin(@CurrentWorkspace() ws: WorkspaceContext, @Body(new ZodPipe(kioskPinSchema)) dto: { pin: string }): Promise<void> {
    return this.kiosks.setPin(ws, dto.pin);
  }

  // ── La tablet (sin sesión: se identifica con su propio token) ──────────

  @Public()
  @Post('kiosk/pair')
  @HttpCode(200)
  @Throttle({ default: { limit: strictLimit(10), ttl: 60_000 } })
  pair(@Body(new ZodPipe(kioskPairSchema)) dto: { code: string }): Promise<{ token: string; info: KioskInfo }> {
    return this.kiosks.pair(dto.code);
  }

  @Public()
  @Get('kiosk/info')
  async info(@Headers('x-kiosk-token') token?: string): Promise<KioskInfo> {
    const kiosk = await this.kiosks.device(token);
    return this.kiosks.info(kiosk.id);
  }

  @Public()
  @Post('kiosk/identify')
  @HttpCode(200)
  @Throttle({ default: { limit: strictLimit(30), ttl: 60_000 } })
  async identify(@Headers('x-kiosk-token') token: string | undefined, @Body(new ZodPipe(kioskIdentifySchema)) dto: KioskIdentifyInput): Promise<KioskIdentity> {
    const kiosk = await this.kiosks.device(token);
    return this.kiosks.identify(kiosk, dto);
  }

  /** Igual que /time/clock: multipart con `data` (JSON) y la foto opcional. */
  @Public()
  @Post('kiosk/clock')
  @HttpCode(200)
  @UseInterceptors(FileInterceptor('photo', { limits: { fileSize: MAX_PHOTO_BYTES, files: 1 } }))
  async clock(@Headers('x-kiosk-token') token: string | undefined, @Body('data') data: string, @UploadedFile() photo?: Express.Multer.File): Promise<ClockStatus & { fullName: string }> {
    const kiosk = await this.kiosks.device(token);
    let json: unknown;
    try {
      json = JSON.parse(data);
    } catch {
      throw new BadRequestException({ code: 'VALIDATION' });
    }
    const dto = new ZodPipe(kioskClockSchema).transform(json);
    return this.kiosks.clock(kiosk, dto, photo && { buffer: photo.buffer, mimetype: photo.mimetype });
  }
}
