import type { MemberDto } from '@hr/shared';
import { useQuery } from '@tanstack/react-query';
import { Banknote, ChevronLeft, ChevronRight, ClipboardList, FileSpreadsheet, FileText, type LucideIcon, MapPinned, Receipt, Users } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, apiDownload } from '../lib/api';
import { addMonths, startOfMonth } from '../lib/dates';
import { errorMessage } from '../lib/errors';
import { useSession, useWorkspace } from '../stores/session';
import { toast } from '../stores/toast';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { PageHeader } from '../ui/Page';

type Format = 'pdf' | 'xlsx' | 'csv';

interface ReportDef {
  key: 'timesheet' | 'timesheet-detail' | 'expenses' | 'team' | 'payroll';
  icon: LucideIcon;
  formats: Format[];
}

/** Registro de toda la plantilla (solo quien supervisa): no depende de la persona elegida. */
const TEAM_REPORT: ReportDef = { key: 'team', icon: Users, formats: ['xlsx', 'pdf'] };
/** Archivo para la gestoría (solo la administración). */
const PAYROLL_REPORT: ReportDef = { key: 'payroll', icon: Banknote, formats: ['xlsx', 'csv'] };

const REPORTS: ReportDef[] = [
  { key: 'timesheet', icon: ClipboardList, formats: ['pdf', 'xlsx', 'csv'] },
  { key: 'timesheet-detail', icon: MapPinned, formats: ['pdf'] },
  { key: 'expenses', icon: Receipt, formats: ['pdf', 'xlsx', 'csv'] },
];

const FORMAT_LABEL: Record<Format, string> = { pdf: 'PDF', xlsx: 'Excel', csv: 'CSV' };

export function Reports() {
  const { t, i18n } = useTranslation();
  const workspaceId = useSession((s) => s.workspaceId);
  const me = useSession((s) => s.user)!;
  const ws = useWorkspace();
  const supervises = ws.kind === 'organization' && ws.role !== 'EMPLOYEE';
  const [month, setMonth] = useState(() => startOfMonth(new Date()));
  const [userId, setUserId] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  const members = useQuery({ queryKey: ['members', workspaceId], queryFn: () => api<MemberDto[]>('/members'), enabled: supervises });
  const people = (members.data ?? []).filter((m) => m.role !== 'INSPECTOR' && m.userId !== me.id);

  const isCurrent = month.getTime() === startOfMonth(new Date()).getTime();
  const monthParam = `${month.getFullYear()}-${String(month.getMonth() + 1).padStart(2, '0')}`;
  const arrow = 'focus-ring flex size-11 items-center justify-center rounded-xl text-fg-muted hover:bg-surface-2 hover:text-fg disabled:opacity-30';

  const download = async (report: ReportDef, format: Format): Promise<void> => {
    const id = `${report.key}.${format}`;
    setBusy(id);
    try {
      if (report.key === 'payroll') {
        await apiDownload(`/reports/payroll-export?month=${monthParam}&format=${format}`, `gestoria-${monthParam}.${format}`);
      } else if (report.key === 'team') {
        await apiDownload(`/reports/team-timesheet?month=${monthParam}&format=${format}`, `registro-jornada-plantilla-${monthParam}.${format}`);
      } else {
        const query = `month=${monthParam}&format=${format}${userId ? `&userId=${userId}` : ''}`;
        await apiDownload(`/reports/${report.key}?${query}`, `${report.key}-${monthParam}.${format}`);
      }
    } catch (e) {
      toast.error(errorMessage(t, e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="animate-page space-y-4">
      <PageHeader title={t('nav.reports')} subtitle={ws.kind === 'organization' ? ws.name : t('workspace.personal')} />

      <Card className="flex items-center gap-1 p-1.5">
        <button type="button" onClick={() => setMonth(addMonths(month, -1))} aria-label={t('shifts.prev')} className={arrow}>
          <ChevronLeft className="size-5" />
        </button>
        <p className="flex-1 text-center font-semibold first-letter:uppercase">
          {new Intl.DateTimeFormat(i18n.resolvedLanguage, { month: 'long', year: 'numeric' }).format(month)}
        </p>
        <button type="button" onClick={() => setMonth(addMonths(month, 1))} disabled={isCurrent} aria-label={t('shifts.next')} className={arrow}>
          <ChevronRight className="size-5" />
        </button>
      </Card>

      {supervises && (
        <div>
          <label htmlFor="report-user" className="mb-1.5 block text-sm font-medium">
            {t('reports.person')}
          </label>
          <select
            id="report-user"
            value={userId}
            onChange={(e) => setUserId(e.target.value)}
            className="edge h-12 w-full rounded-control bg-surface px-3 text-base focus:border-accent focus:ring-3 focus:ring-accent/20 focus:outline-none"
          >
            <option value="">{t('reports.me', { name: me.fullName })}</option>
            {people.map((p) => (
              <option key={p.userId} value={p.userId}>
                {p.fullName}
              </option>
            ))}
          </select>
        </div>
      )}

      <ul className="space-y-3">
        {[...REPORTS, ...(supervises ? [TEAM_REPORT] : []), ...(ws.kind === 'organization' && ws.role === 'ADMIN' ? [PAYROLL_REPORT] : [])].map((r) => (
          <li key={r.key}>
            <Card className="p-4">
              <div className="flex gap-3.5">
                <span className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-accent-soft text-accent-text">
                  <r.icon className="size-6" />
                </span>
                <div className="min-w-0">
                  <h2 className="font-bold tracking-tight">{t(`reports.${r.key}.title`)}</h2>
                  <p className="mt-0.5 text-sm text-fg-muted">{t(`reports.${r.key}.desc`)}</p>
                </div>
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                {r.formats.map((f, i) => (
                  <Button
                    key={f}
                    variant={i === 0 ? 'primary' : 'secondary'}
                    loading={busy === `${r.key}.${f}`}
                    disabled={busy !== null && busy !== `${r.key}.${f}`}
                    onClick={() => void download(r, f)}
                    icon={f === 'pdf' ? <FileText className="size-4" /> : <FileSpreadsheet className="size-4" />}
                    aria-label={t('reports.downloadAs', { report: t(`reports.${r.key}.title`), format: FORMAT_LABEL[f] })}
                  >
                    {FORMAT_LABEL[f]}
                  </Button>
                ))}
              </div>
            </Card>
          </li>
        ))}
      </ul>
      <p className="text-sm text-fg-muted">{t('reports.note')}</p>
    </div>
  );
}
