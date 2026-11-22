import { BagConfig, BagEntry, BagShift, computeBags, nightSeconds } from './bags';

const cfg: BagConfig = { timezone: 'Europe/Madrid', nightStart: '22:00', nightEnd: '06:00' };
// Noviembre: Madrid es UTC+1.
const local = (day: number, hhmm: string): Date => new Date(new Date(`2026-11-${String(day).padStart(2, '0')}T${hhmm}:00Z`).getTime() - 3600_000);
const work = (id: string, day: number, from: string, toDay: number, to: string, type: BagEntry['entryType'] = 'WORK'): BagEntry => ({
  workdayId: id,
  entryType: type,
  startTime: local(day, from),
  endTime: local(toDay, to),
});
const shift = (day: number, from: string, to: string, breakMinutes = 0, toDay = day): BagShift => ({
  date: `2026-11-${String(day).padStart(2, '0')}`,
  plannedStart: local(day, from),
  plannedEnd: local(toDay, to),
  breakMinutes,
});
const H = 3600;
const NOW = local(30, '12:00');

describe('nightSeconds', () => {
  it('jornada de día: nada nocturno', () => {
    expect(nightSeconds(local(10, '08:00'), local(10, '17:00'), cfg)).toBe(0);
  });
  it('turno de noche completo: de 22:00 a 06:00', () => {
    expect(nightSeconds(local(10, '21:00'), local(11, '07:00'), cfg)).toBe(8 * H);
  });
  it('madrugada: la noche que empezó la víspera', () => {
    expect(nightSeconds(local(10, '04:00'), local(10, '09:00'), cfg)).toBe(2 * H);
  });
  it('salir tarde: solo lo que pasa de las 22:00', () => {
    expect(nightSeconds(local(10, '14:00'), local(10, '23:30'), cfg)).toBe(1.5 * H);
  });
  it('la noche del cambio de hora de octubre dura una hora más', () => {
    // 24→25 de octubre de 2026: de 22:00 a 06:00 hay 9 horas reales.
    expect(nightSeconds(new Date('2026-10-24T20:00:00Z'), new Date('2026-10-25T05:00:00Z'), cfg)).toBe(9 * H);
  });
});

describe('computeBags', () => {
  it('lo trabajado hasta lo planificado es ordinario; el resto, extra', () => {
    const r = computeBags(
      [work('a', 10, '08:00', 10, '13:00'), work('a', 10, '13:00', 10, '14:00', 'BREAK'), work('a', 10, '14:00', 10, '18:30')],
      [shift(10, '08:00', '17:00', 60)],
      cfg,
      NOW,
    );
    expect(r.total).toMatchObject({
      plannedSeconds: 8 * H,
      workedSeconds: 9.5 * H,
      ordinarySeconds: 8 * H,
      overtimeSeconds: 1.5 * H,
      breakSeconds: H,
      nightSeconds: 0,
    });
  });

  it('trabajar menos de lo planificado no genera extra negativa', () => {
    const r = computeBags([work('a', 10, '08:00', 10, '12:00')], [shift(10, '08:00', '16:00')], cfg, NOW);
    expect(r.total).toMatchObject({ ordinarySeconds: 4 * H, overtimeSeconds: 0 });
  });

  it('un día trabajado sin turno, teniendo cuadrante, es todo extra', () => {
    const r = computeBags([work('a', 10, '08:00', 10, '16:00'), work('b', 14, '09:00', 14, '13:00')], [shift(10, '08:00', '16:00')], cfg, NOW);
    expect(r.days.map((d) => [d.date, d.ordinarySeconds / H, d.overtimeSeconds / H])).toEqual([
      ['2026-11-10', 8, 0],
      ['2026-11-14', 0, 4],
    ]);
  });

  it('sin ningún turno en el periodo todo es ordinario', () => {
    const r = computeBags([work('a', 10, '08:00', 10, '16:00')], [], cfg, NOW);
    expect(r.hasPlan).toBe(false);
    expect(r.total).toMatchObject({ ordinarySeconds: 8 * H, overtimeSeconds: 0 });
  });

  it('el turno de noche se imputa entero al día en que empieza, con sus horas nocturnas', () => {
    const r = computeBags([work('a', 10, '22:00', 11, '06:00')], [shift(10, '22:00', '06:00', 0, 11)], cfg, NOW);
    expect(r.days).toHaveLength(1);
    expect(r.days[0]).toMatchObject({ date: '2026-11-10', workedSeconds: 8 * H, nightSeconds: 8 * H, overtimeSeconds: 0 });
  });

  it('turno partido: dos turnos el mismo día suman lo planificado', () => {
    const r = computeBags(
      [work('a', 10, '09:00', 10, '13:00'), work('b', 10, '17:00', 10, '21:00')],
      [shift(10, '09:00', '13:00'), shift(10, '17:00', '20:00')],
      cfg,
      NOW,
    );
    expect(r.total).toMatchObject({ plannedSeconds: 7 * H, ordinarySeconds: 7 * H, overtimeSeconds: H });
  });

  it('el desplazamiento se cuenta aparte y la jornada abierta cuenta hasta ahora', () => {
    const open: BagEntry = { workdayId: 'c', entryType: 'WORK', startTime: local(30, '08:00'), endTime: null };
    const r = computeBags([work('a', 10, '08:00', 10, '09:00', 'TRAVEL'), open], [], cfg, NOW);
    expect(r.total).toMatchObject({ travelSeconds: H, workedSeconds: 4 * H });
  });
});
