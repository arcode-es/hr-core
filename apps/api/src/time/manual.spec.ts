import { InvalidRangeError, planSegments } from './manual';

const at = (hhmm: string, day = 10): string => `2026-11-${day}T${hhmm}:00.000Z`;
const NOW = new Date('2026-11-12T00:00:00Z');
const shape = (s: ReturnType<typeof planSegments>) =>
  s.map((x) => `${x.entryType}${x.breakKind ? `/${x.breakKind}` : ''} ${x.startTime.toISOString().slice(11, 16)}-${x.endTime.toISOString().slice(11, 16)}`);

describe('planSegments', () => {
  it('sin pausas es un único tramo de trabajo', () => {
    expect(shape(planSegments({ start: at('08:00'), end: at('16:00'), breaks: [] }, NOW))).toEqual(['WORK 08:00-16:00']);
  });

  it('intercala pausas y desplazamientos, aunque lleguen desordenados', () => {
    const s = planSegments(
      {
        start: at('08:00'),
        end: at('17:00'),
        breaks: [
          { kind: 'TRAVEL', start: at('15:00'), end: at('15:30') },
          { kind: 'MEAL', start: at('13:00'), end: at('14:00') },
        ],
      },
      NOW,
    );
    expect(shape(s)).toEqual(['WORK 08:00-13:00', 'BREAK/MEAL 13:00-14:00', 'WORK 14:00-15:00', 'TRAVEL 15:00-15:30', 'WORK 15:30-17:00']);
    for (let i = 1; i < s.length; i++) expect(s[i]!.startTime).toEqual(s[i - 1]!.endTime);
  });

  it('una pausa al principio o al final no deja tramos vacíos', () => {
    expect(shape(planSegments({ start: at('08:00'), end: at('12:00'), breaks: [{ kind: 'REST', start: at('08:00'), end: at('08:15') }] }, NOW))).toEqual([
      'BREAK/REST 08:00-08:15',
      'WORK 08:15-12:00',
    ]);
    expect(shape(planSegments({ start: at('08:00'), end: at('12:00'), breaks: [{ kind: 'REST', start: at('11:45'), end: at('12:00') }] }, NOW))).toEqual([
      'WORK 08:00-11:45',
      'BREAK/REST 11:45-12:00',
    ]);
  });

  it('admite turnos que cruzan la medianoche', () => {
    expect(planSegments({ start: at('22:00'), end: at('06:00', 11), breaks: [] }, NOW)).toHaveLength(1);
  });

  it.each([
    ['fin anterior al inicio', { start: at('16:00'), end: at('08:00'), breaks: [] }],
    ['más de 24 horas', { start: at('08:00', 9), end: at('09:00', 10), breaks: [] }],
    ['en el futuro', { start: at('08:00', 12), end: at('16:00', 12), breaks: [] }],
    ['pausa fuera de la jornada', { start: at('08:00'), end: at('16:00'), breaks: [{ kind: 'MEAL' as const, start: at('15:30'), end: at('16:30') }] }],
    [
      'pausas solapadas',
      {
        start: at('08:00'),
        end: at('16:00'),
        breaks: [
          { kind: 'MEAL' as const, start: at('13:00'), end: at('14:00') },
          { kind: 'REST' as const, start: at('13:30'), end: at('14:30') },
        ],
      },
    ],
    ['pausa de duración cero', { start: at('08:00'), end: at('16:00'), breaks: [{ kind: 'REST' as const, start: at('10:00'), end: at('10:00') }] }],
  ])('rechaza %s', (_, input) => {
    expect(() => planSegments(input, NOW)).toThrow(InvalidRangeError);
  });
});
