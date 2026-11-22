import { totals } from './durations';

const at = (hhmm: string): Date => new Date(`2026-11-10T${hhmm}:00Z`);

describe('totals', () => {
  it('separa trabajo, pausas y desplazamiento', () => {
    expect(
      totals(
        [
          { entryType: 'WORK', startTime: at('08:00'), endTime: at('12:00') },
          { entryType: 'BREAK', startTime: at('12:00'), endTime: at('12:30') },
          { entryType: 'TRAVEL', startTime: at('12:30'), endTime: at('13:00') },
          { entryType: 'WORK', startTime: at('13:00'), endTime: at('17:00') },
        ],
        at('18:00'),
      ),
    ).toEqual({ workedSeconds: 8 * 3600, breakSeconds: 1800, travelSeconds: 1800 });
  });

  it('el tramo abierto cuenta hasta ahora', () => {
    expect(totals([{ entryType: 'WORK', startTime: at('08:00'), endTime: null }], at('09:15')).workedSeconds).toBe(4500);
  });

  it('nunca da tiempo negativo si el reloj va por detrás', () => {
    expect(totals([{ entryType: 'WORK', startTime: at('08:00'), endTime: null }], at('07:59')).workedSeconds).toBe(0);
  });
});
