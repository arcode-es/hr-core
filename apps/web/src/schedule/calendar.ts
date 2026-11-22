import type { AbsenceDto, HolidayDto, TeamCalendar } from '@hr/shared';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { addDays, isoDate } from '../lib/dates';
import { useSession, useWorkspace } from '../stores/session';

/** Festivos y ausencias (aprobadas y pendientes) de [from, to), para el cuadrante y la agenda. */
export function useCalendar(from: Date, to: Date) {
  const workspaceId = useSession((s) => s.workspaceId);
  const org = useWorkspace().kind === 'organization';
  const first = isoDate(from);
  const last = isoDate(addDays(to, -1));
  return useQuery({
    queryKey: ['absences', 'calendar', workspaceId, first, last],
    queryFn: () => api<TeamCalendar>(`/absences/calendar?from=${first}&to=${last}`),
    enabled: org,
  });
}

/** Festivo de ese día para toda la empresa o, si se indica, para esa ubicación. */
export const holidayOn = (cal: TeamCalendar | undefined, date: string, locationId?: string | null): HolidayDto | undefined =>
  cal?.holidays.find((h) => h.date === date && (!h.location || h.location.id === locationId));

export const absenceOn = (cal: TeamCalendar | undefined, userId: string, date: string): AbsenceDto | undefined =>
  cal?.absences.find((a) => a.user.id === userId && a.startDate <= date && a.endDate >= date);
