import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Response } from 'express';
import { qrPoster } from '../common/qr';
import type { Env } from '../config/env';
import {
  GeofenceMatch,
  LocationDto,
  LocationInput,
  locationSchema,
  PositionQuery,
  positionQuerySchema,
  UpdateLocationInput,
  updateLocationSchema,
} from '@hr/shared';
import { AuthUser, CurrentUser, CurrentWorkspace, WorkspaceContext } from '../common/context';
import { ZodPipe } from '../common/zod.pipe';
import { LocationsService } from './locations.service';

@Controller('locations')
export class LocationsController {
  private readonly appUrl: string;

  constructor(
    private readonly locations: LocationsService,
    config: ConfigService<Env, true>,
  ) {
    this.appUrl = config.get('APP_PUBLIC_URL', { infer: true }).replace(/\/+$/, '');
  }

  /** Cambia el código QR de la ubicación (por ejemplo, si el cartel se ha copiado). */
  @Post(':id/qr')
  regenerateQr(@CurrentUser() user: AuthUser, @CurrentWorkspace() ws: WorkspaceContext, @Param('id', ParseUUIDPipe) id: string): Promise<{ code: string }> {
    return this.locations.regenerateQr(user.id, ws, id);
  }

  /** Cartel A4 para imprimir: al escanearlo con el móvil se abre la app para fichar en esa ubicación. */
  @Get(':id/qr.pdf')
  async qrPdf(@CurrentUser() user: AuthUser, @CurrentWorkspace() ws: WorkspaceContext, @Param('id', ParseUUIDPipe) id: string, @Res() res: Response): Promise<void> {
    const info = await this.locations.qrInfo(user.id, ws, id);
    const url = `${this.appUrl}/clock?l=${id}&k=${info.code}`;
    const pdf = await qrPoster({
      title: `Ficha aquí: ${info.name}`,
      subtitle: [info.organization, info.address].filter(Boolean).join(' · '),
      lines: ['Escanea el código con la cámara del móvil', 'o en HR-Core › Fichar › Escanear QR.', 'Cuenta como presencia en esta ubicación aunque no haya GPS.'],
      qrText: url,
      footer: 'Si el cartel se copia o se mueve, genera un código nuevo desde Ubicaciones: el anterior deja de valer.',
    });
    res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="qr-${id.slice(0, 8)}.pdf"`, 'Cache-Control': 'no-store' });
    res.send(pdf);
  }

  @Get()
  list(@CurrentUser() user: AuthUser, @CurrentWorkspace() ws: WorkspaceContext): Promise<LocationDto[]> {
    return this.locations.list(user.id, ws);
  }

  /** ¿En qué ubicación estoy? Las más cercanas, con «dentro/fuera» y a cuántos metros. */
  @Get('near')
  near(
    @CurrentUser() user: AuthUser,
    @CurrentWorkspace() ws: WorkspaceContext,
    @Query(new ZodPipe(positionQuerySchema)) pos: PositionQuery,
  ): Promise<GeofenceMatch[]> {
    return this.locations.near(user.id, ws, pos);
  }

  @Post()
  create(
    @CurrentUser() user: AuthUser,
    @CurrentWorkspace() ws: WorkspaceContext,
    @Body(new ZodPipe(locationSchema)) dto: LocationInput,
  ): Promise<LocationDto> {
    return this.locations.create(user.id, ws, dto);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: AuthUser,
    @CurrentWorkspace() ws: WorkspaceContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(updateLocationSchema)) dto: UpdateLocationInput,
  ): Promise<LocationDto> {
    return this.locations.update(user.id, ws, id, dto);
  }
}
