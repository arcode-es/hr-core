import { Controller, ForbiddenException, Get, NotFoundException, Param, Query, Res } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import type { Response } from 'express';
import { Public } from '../common/context';
import { LocalStorage } from './local.storage';
import { Storage } from './storage';

/** Sirve los enlaces firmados del almacén local. Con S3, los enlaces apuntan a S3 y esto no se usa. */
@Public()
@SkipThrottle()
@Controller('files')
export class FilesController {
  constructor(private readonly storage: Storage) {}

  @Get('*key')
  async file(
    @Param('key') key: string | string[],
    @Query('exp') exp: string,
    @Query('sig') sig: string,
    @Res() res: Response,
  ): Promise<void> {
    if (!(this.storage instanceof LocalStorage)) throw new NotFoundException();
    const path = Array.isArray(key) ? key.join('/') : key;
    // La firma solo cubre claves emitidas por el servidor: una ruta manipulada no la supera.
    if (!this.storage.verify(path, Number(exp), sig ?? '')) throw new ForbiddenException({ code: 'SESSION_EXPIRED' });
    try {
      const body = await this.storage.get(path);
      res
        .set({
          'Content-Type': await this.storage.contentType(path),
          'Cache-Control': 'private, max-age=300',
          // La web vive en otro origen y carga las fotos con <img>.
          'Cross-Origin-Resource-Policy': 'cross-origin',
          'X-Content-Type-Options': 'nosniff',
        })
        .send(body);
    } catch {
      throw new NotFoundException({ code: 'NOT_FOUND' });
    }
  }
}
