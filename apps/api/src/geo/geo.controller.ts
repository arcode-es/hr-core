import { Controller, Get, Query } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { geoReverseQuerySchema, geoSearchQuerySchema, type GeoPlace } from '@hr/shared';
import type { z } from 'zod';
import { ZodPipe } from '../common/zod.pipe';
import { GeoService } from './geo.service';

@Controller('geo')
@Throttle({ default: { limit: 40, ttl: 60_000 } })
export class GeoController {
  constructor(private readonly geo: GeoService) {}

  @Get('reverse')
  async reverse(
    @Query(new ZodPipe(geoReverseQuerySchema)) q: z.infer<typeof geoReverseQuerySchema>,
  ): Promise<{ address: string | null }> {
    return { address: await this.geo.reverse(q.lat, q.lng, q.lang) };
  }

  @Get('search')
  search(@Query(new ZodPipe(geoSearchQuerySchema)) q: z.infer<typeof geoSearchQuerySchema>): Promise<GeoPlace[]> {
    return this.geo.search(q.q, q.lang);
  }
}
