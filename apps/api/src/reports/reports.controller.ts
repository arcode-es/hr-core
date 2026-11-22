import { Controller, Get, Query, Res } from '@nestjs/common';
import { type PayrollExportQuery, payrollExportQuerySchema, ReportQuery, reportQuerySchema, type SiteCostReport, siteCostQuerySchema, type TeamReportQuery, teamReportQuerySchema } from '@hr/shared';
import type { Response } from 'express';
import { AuthUser, CurrentUser, CurrentWorkspace, Roles, WorkspaceContext } from '../common/context';
import { ZodPipe } from '../common/zod.pipe';
import { expensesCsv, expensesPdf, expensesXlsx } from './expenses.render';
import { payrollCsv, payrollXlsx, sitesXlsx } from './management.render';
import { ManagementReportsService } from './management.service';
import { ReportsService } from './reports.service';
import { teamTimesheetPdf, teamTimesheetXlsx, timesheetCsv, timesheetDetailPdf, timesheetPdf, timesheetXlsx } from './timesheet.render';

const MIME = {
  pdf: 'application/pdf',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  csv: 'text/csv; charset=utf-8',
} as const;

const slug = (s: string): string =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase();

function send(res: Response, body: Buffer, format: keyof typeof MIME, name: string): void {
  res
    .set({
      'Content-Type': MIME[format],
      'Content-Disposition': `attachment; filename="${name}.${format}"`,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    })
    .send(body);
}

@Controller('reports')
export class ReportsController {
  constructor(
    private readonly reports: ReportsService,
    private readonly management: ManagementReportsService,
  ) {}

  /** Archivo para la gestoría: una fila por persona con horas, ausencias y gastos del mes. */
  @Get('payroll-export')
  @Roles('ADMIN')
  async payrollExport(@CurrentUser() user: AuthUser, @CurrentWorkspace() ws: WorkspaceContext, @Query(new ZodPipe(payrollExportQuerySchema)) q: PayrollExportQuery, @Res() res: Response): Promise<void> {
    const data = await this.management.payroll(user.id, ws, q.month);
    const body = q.format === 'csv' ? payrollCsv(data) : await payrollXlsx({ ...data, month: q.month });
    send(res, body, q.format, `gestoria-${q.month}`);
  }

  /** Coste estimado y gastos de cada obra o centro en el mes. */
  @Get('sites')
  @Roles('ADMIN')
  sites(@CurrentUser() user: AuthUser, @CurrentWorkspace() ws: WorkspaceContext, @Query(new ZodPipe(siteCostQuerySchema)) q: { month: string }): Promise<SiteCostReport> {
    return this.management.sites(user.id, ws, q.month);
  }

  @Get('sites.xlsx')
  @Roles('ADMIN')
  async sitesXlsx(@CurrentUser() user: AuthUser, @CurrentWorkspace() ws: WorkspaceContext, @Query(new ZodPipe(siteCostQuerySchema)) q: { month: string }, @Res() res: Response): Promise<void> {
    const [report, team] = await Promise.all([this.management.sites(user.id, ws, q.month), this.reports.teamTimesheets(user.id, ws, q.month).then((t) => t.organization)]);
    send(res, await sitesXlsx(report, team), 'xlsx', `coste-por-obra-${q.month}`);
  }

  /** Informe oficial de registro de jornada del mes. */
  @Get('timesheet')
  async timesheet(@CurrentUser() user: AuthUser, @CurrentWorkspace() ws: WorkspaceContext, @Query(new ZodPipe(reportQuerySchema)) q: ReportQuery, @Res() res: Response): Promise<void> {
    const data = await this.reports.timesheet(user.id, ws, q.month, q.userId);
    const body = q.format === 'pdf' ? await timesheetPdf(data) : q.format === 'xlsx' ? await timesheetXlsx(data) : timesheetCsv(data);
    send(res, body, q.format, `registro-jornada-${q.month}-${slug(data.person.fullName)}`);
  }

  /** Registro de toda la plantilla (la que ve quien lo pide): Excel con resumen y una hoja por persona, o un PDF con todos. */
  @Get('team-timesheet')
  @Roles('ADMIN', 'MANAGER', 'INSPECTOR')
  async teamTimesheet(@CurrentUser() user: AuthUser, @CurrentWorkspace() ws: WorkspaceContext, @Query(new ZodPipe(teamReportQuerySchema)) q: TeamReportQuery, @Res() res: Response): Promise<void> {
    const { organization, reports } = await this.reports.teamTimesheets(user.id, ws, q.month);
    const body = q.format === 'pdf' ? await teamTimesheetPdf(reports) : await teamTimesheetXlsx(reports, q.month, organization);
    send(res, body, q.format, `registro-jornada-plantilla-${q.month}`);
  }

  /** Informe detallado con coordenadas, horas exactas y fotos de evidencia. Solo PDF. */
  @Get('timesheet-detail')
  async detail(@CurrentUser() user: AuthUser, @CurrentWorkspace() ws: WorkspaceContext, @Query(new ZodPipe(reportQuerySchema)) q: ReportQuery, @Res() res: Response): Promise<void> {
    const data = await this.reports.timesheet(user.id, ws, q.month, q.userId);
    send(res, await timesheetDetailPdf(data, (key) => this.reports.photo(key)), 'pdf', `jornada-detallada-${q.month}-${slug(data.person.fullName)}`);
  }

  /** Liquidación de gastos y dietas del mes, con los tickets. */
  @Get('expenses')
  async expenses(@CurrentUser() user: AuthUser, @CurrentWorkspace() ws: WorkspaceContext, @Query(new ZodPipe(reportQuerySchema)) q: ReportQuery, @Res() res: Response): Promise<void> {
    const data = await this.reports.expenses(user.id, ws, q.month, q.userId);
    const body = q.format === 'pdf' ? await expensesPdf(data, (key) => this.reports.photo(key)) : q.format === 'xlsx' ? await expensesXlsx(data) : expensesCsv(data);
    send(res, body, q.format, `liquidacion-gastos-${q.month}-${slug(data.person.fullName)}`);
  }
}
