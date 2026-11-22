import { addDaysKeepingWallTime, fromWallTime, localDate, wallTime } from './tz';

const MADRID = 'Europe/Madrid';

describe('zona horaria', () => {
  it('convierte entre instante y hora local en invierno (UTC+1) y verano (UTC+2)', () => {
    expect(wallTime(new Date('2026-01-15T07:00:00Z'), MADRID)).toMatchObject({ hour: 8, day: 15 });
    expect(wallTime(new Date('2026-07-15T06:00:00Z'), MADRID)).toMatchObject({ hour: 8, day: 15 });
    expect(fromWallTime({ year: 2026, month: 1, day: 15, hour: 8, minute: 0 }, MADRID).toISOString()).toBe('2026-01-15T07:00:00.000Z');
    expect(fromWallTime({ year: 2026, month: 7, day: 15, hour: 8, minute: 0 }, MADRID).toISOString()).toBe('2026-07-15T06:00:00.000Z');
  });

  it('el día local no es el día UTC cerca de la medianoche', () => {
    expect(localDate(new Date('2026-07-14T22:30:00Z'), MADRID)).toBe('2026-07-15');
    expect(localDate(new Date('2026-07-14T21:30:00Z'), MADRID)).toBe('2026-07-14');
  });

  it('copiar un turno a la semana siguiente conserva las 08:00 aunque cambie la hora', () => {
    // El 25 de octubre de 2026 se atrasa el reloj en España.
    const before = new Date('2026-10-20T06:00:00Z'); // 08:00 en horario de verano
    const after = addDaysKeepingWallTime(before, 7, MADRID);
    expect(wallTime(after, MADRID)).toMatchObject({ day: 27, hour: 8, minute: 0 });
    expect(after.toISOString()).toBe('2026-10-27T07:00:00.000Z');
    // Y el 29 de marzo de 2026 se adelanta.
    expect(addDaysKeepingWallTime(new Date('2026-03-24T07:00:00Z'), 7, MADRID).toISOString()).toBe('2026-03-31T06:00:00.000Z');
  });

  it('admite desbordar el día para pasar de mes', () => {
    expect(fromWallTime({ year: 2026, month: 1, day: 32, hour: 6, minute: 0 }, MADRID).toISOString()).toBe('2026-02-01T05:00:00.000Z');
  });
});
