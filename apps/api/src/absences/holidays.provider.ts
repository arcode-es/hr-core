import { Injectable } from '@nestjs/common';

export interface OfficialHoliday {
  date: string;
  name: string;
  scope: 'NATIONAL' | 'REGIONAL';
}

/** Fuente de los festivos oficiales de un año. Sustituible en los tests. */
export abstract class HolidaysProvider {
  abstract fetch(year: number, region: string): Promise<OfficialHoliday[]>;
}

interface NagerHoliday {
  date: string;
  localName: string;
  name: string;
  global: boolean;
  counties: string[] | null;
}

/**
 * Festivos de España desde Nager.Date (servicio público y gratuito): los nacionales
 * y los de la comunidad indicada. Los locales no los publica: se añaden a mano.
 */
@Injectable()
export class NagerHolidaysProvider extends HolidaysProvider {
  async fetch(year: number, region: string): Promise<OfficialHoliday[]> {
    const res = await fetch(`https://date.nager.at/api/v3/PublicHolidays/${year}/ES`, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) throw new Error(`Nager.Date respondió ${res.status}`);
    const list = (await res.json()) as NagerHoliday[];
    return list.flatMap((h): OfficialHoliday[] => {
      if (h.global) return [{ date: h.date, name: h.localName || h.name, scope: 'NATIONAL' }];
      if (region && h.counties?.includes(region)) return [{ date: h.date, name: h.localName || h.name, scope: 'REGIONAL' }];
      return [];
    });
  }
}
