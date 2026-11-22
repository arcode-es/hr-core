import { PDFDocument } from 'pdf-lib';
import ExcelJS from 'exceljs';
import { coords, csv, dateTime, dayLabel, esDate, hhmm, hhmmss, hm, hoursDecimal, monthLabel, SEGMENT_ES } from './format';
import { PdfReport } from './pdf-kit';
import type { ReportSegment, TimesheetDay, TimesheetReport } from './reports.service';

const LEGAL =
  'Registro diario de jornada conforme al artículo 34.9 del Estatuto de los Trabajadores. ' +
  'La empresa debe conservarlo durante cuatro años a disposición del trabajador, de sus representantes y de la Inspección de Trabajo.';

const work = (d: TimesheetDay): ReportSegment[] => d.segments.filter((s) => s.entryType === 'WORK');

/** Entrada y salida de cada tramo de trabajo: "08:00–13:00 · 14:00–17:30". */
function intervals(d: TimesheetDay, tz: string): string {
  return work(d)
    .map((s) => `${hhmm(s.startTime, tz)}–${s.endTime ? hhmm(s.endTime, tz) : 'en curso'}`)
    .join(' · ');
}

/** M = introducido a mano · F = fichado fuera del perímetro · S = sin posición GPS. */
function marks(d: TimesheetDay): string {
  const m: string[] = [];
  if (d.segments.some((s) => s.origin === 'MANUAL')) m.push('M');
  if (d.segments.some((s) => s.isWithinGeofence === false)) m.push('F');
  if (d.segments.some((s) => s.origin === 'REALTIME' && s.startLat === null)) m.push('S');
  return m.join(' ');
}

const headerFacts = (r: TimesheetReport): [string, string][] => [
  ['Empresa', r.organization?.name ?? 'Registro personal del trabajador'],
  ['CIF / NIF', r.organization?.taxId ?? '—'],
  ['Trabajador/a', r.person.fullName],
  ['DNI / NIE', r.person.dniNie ?? '—'],
  ['Periodo', monthLabel(r.month)],
  ['Generado', `${dateTime(r.generatedAt, r.timezone)} (${r.timezone})`],
  ...(r.annual
    ? ([['Jornada anual', `${hm(r.annual.workedSeconds, false)} trabajadas de ${r.annual.agreedHours} h pactadas (hasta el fin del mes)`]] as [string, string][])
    : []),
];

const footer = (r: TimesheetReport): string => `HR-Core · ${r.person.fullName} · ${monthLabel(r.month)} · generado el ${dateTime(r.generatedAt, r.timezone)}`;

/** Informe oficial de registro de jornada mensual: una página, listo para firmar y archivar. */
export async function timesheetPdf(r: TimesheetReport): Promise<Buffer> {
  const doc = await PdfReport.create({ title: `Registro de jornada ${r.month} - ${r.person.fullName}`, footer: footer(r) });
  await doc.brand(r.brand);
  doc.text('Registro de jornada', { size: 18, bold: true });
  doc.text(monthLabel(r.month), { size: 11, color: undefined });
  doc.gap(6);
  doc.facts(headerFacts(r));

  const rows = r.days.map((d) => [
    dayLabel(d.date),
    intervals(d, r.timezone) || (d.off ?? ''),
    hm(d.breakSeconds),
    hm(d.travelSeconds),
    hm(d.ordinarySeconds),
    hm(d.overtimeSeconds),
    hm(d.nightSeconds),
    hm(d.workedSeconds),
    marks(d),
  ]);
  rows.push([
    'Total',
    '',
    hm(r.total.breakSeconds, false),
    hm(r.total.travelSeconds, false),
    hm(r.total.ordinarySeconds, false),
    hm(r.total.overtimeSeconds, false),
    hm(r.total.nightSeconds, false),
    hm(r.total.workedSeconds, false),
    '',
  ]);
  doc.table(
    [
      { header: 'Día', width: 9 },
      { header: 'Entrada – salida', width: 34 },
      { header: 'Pausas', width: 9, align: 'right' },
      { header: 'Desplaz.', width: 9, align: 'right' },
      { header: 'Ordinarias', width: 10, align: 'right' },
      { header: 'Extra', width: 8, align: 'right' },
      { header: 'Nocturnas', width: 10, align: 'right' },
      { header: 'Total', width: 9, align: 'right' },
      { header: 'Notas', width: 8, align: 'center' },
    ],
    rows,
    { size: 7.5, rowPad: 3.5, emphasizeLast: true, shade: (i) => [0, 6].includes(new Date(`${r.days[i]?.date}T12:00:00Z`).getUTCDay()) },
  );

  doc.text(
    `Horas en formato h:mm. M: tramo introducido manualmente · F: fichado fuera del perímetro asignado · S: fichado sin posición GPS.` +
      (r.hasPlan ? '' : ' Sin turnos planificados en el periodo: todas las horas figuran como ordinarias.'),
    { size: 7, color: undefined },
  );
  doc.gap(4);
  doc.signatures('Firma de la empresa', 'Firma del trabajador/a');
  doc.text(LEGAL, { size: 7 });
  return doc.finish();
}

/**
 * Informe detallado: cada tramo con su hora exacta, origen, coordenadas,
 * dirección y resultado de geocerca, y las fotos de evidencia en anexo.
 * Pensado para contrastar con los registros de la empresa.
 */
export async function timesheetDetailPdf(r: TimesheetReport, photo: (key: string | null) => Promise<Buffer | null>): Promise<Buffer> {
  const doc = await PdfReport.create({ title: `Informe detallado de jornada ${r.month} - ${r.person.fullName}`, footer: footer(r), landscape: true });
  await doc.brand(r.brand);
  doc.text('Informe detallado de jornada', { size: 18, bold: true });
  doc.text(`${monthLabel(r.month)} · con ubicaciones y evidencias`, { size: 11 });
  doc.gap(6);
  doc.facts(headerFacts(r), 3);

  const photos: { image: Buffer; caption: string }[] = [];
  const rows: string[][] = [];
  for (const d of r.days) {
    for (const s of d.segments) {
      const refs: string[] = [];
      for (const [key, label, at] of [
        [s.startPhotoKey, 'entrada', s.startTime],
        [s.endPhotoKey, 'salida', s.endTime],
      ] as const) {
        const image = await photo(key);
        if (image && at) {
          photos.push({ image, caption: `Foto ${photos.length + 1} · ${esDate(d.date)} ${hhmmss(at, r.timezone)} · ${label} · ${SEGMENT_ES(s.entryType, s.breakKind)}` });
          refs.push(`Foto ${photos.length}`);
        }
      }
      const geofence = s.isWithinGeofence === null ? '—' : s.isWithinGeofence ? `Dentro: ${s.location?.name ?? ''}` : `Fuera, a ${s.geofenceDistanceMeters ?? '?'} m de ${s.location?.name ?? ''}`;
      rows.push([
        esDate(d.date),
        SEGMENT_ES(s.entryType, s.breakKind),
        hhmmss(s.startTime, r.timezone),
        s.endTime ? hhmmss(s.endTime, r.timezone) : 'en curso',
        hm((((s.endTime ?? r.generatedAt).getTime() - s.startTime.getTime()) / 1000) | 0, false),
        s.origin === 'MANUAL' ? 'Manual' : s.syncedOffline ? 'Cronómetro (sin conexión)' : 'Cronómetro',
        s.origin === 'MANUAL' ? '—' : `${coords(s.startLat, s.startLng, s.startAccuracy)}\n${s.startAddress ?? ''}`.trim(),
        s.origin === 'MANUAL' || !s.endTime ? '—' : `${coords(s.endLat, s.endLng, s.endAccuracy)}\n${s.endAddress ?? ''}`.trim(),
        geofence,
        refs.join(', '),
      ]);
    }
  }
  if (rows.length === 0) doc.text('No hay jornadas registradas en este periodo.', { size: 10 });
  else
    doc.table(
      [
        { header: 'Fecha', width: 8 },
        { header: 'Tipo', width: 10 },
        { header: 'Inicio', width: 7 },
        { header: 'Fin', width: 7 },
        { header: 'Duración', width: 7, align: 'right' },
        { header: 'Origen', width: 9 },
        { header: 'Posición de inicio', width: 20 },
        { header: 'Posición de fin', width: 20 },
        { header: 'Perímetro', width: 13 },
        { header: 'Evidencia', width: 7 },
      ],
      rows,
      { size: 7 },
    );
  doc.text(
    `Total trabajado: ${hm(r.total.workedSeconds, false)} · Pausas: ${hm(r.total.breakSeconds, false)} · Desplazamiento: ${hm(r.total.travelSeconds, false)} · ` +
      `Extraordinarias: ${hm(r.total.overtimeSeconds, false)} · Nocturnas: ${hm(r.total.nightSeconds, false)}`,
    { size: 9, bold: true },
  );
  doc.text(
    'Las horas de los tramos de cronómetro las fija el servidor en el momento del fichaje, no el dispositivo. ' +
      'En los marcados «sin conexión» la hora es la del dispositivo, corregida con el último desfase conocido respecto al servidor, y se registró al recuperar la red. ' +
      'Las coordenadas proceden del GPS del dispositivo, con la precisión indicada. Los tramos manuales no llevan posición.',
    { size: 7 },
  );

  if (photos.length) {
    doc.addPage();
    doc.text('Anexo: fotos de evidencia', { size: 14, bold: true });
    doc.gap(6);
    await doc.gallery(photos, 3, 300);
  }
  return doc.finish();
}

export async function timesheetXlsx(r: TimesheetReport): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'HR-Core';
  addTimesheetSheet(wb, r, 'Registro de jornada');
  return Buffer.from(await wb.xlsx.writeBuffer());
}

/** Hoja con el registro de una persona: cabecera, un día por fila y totales. */
function addTimesheetSheet(wb: ExcelJS.Workbook, r: TimesheetReport, name: string): void {
  const ws = wb.addWorksheet(name);
  for (const [label, value] of headerFacts(r)) ws.addRow([label, value]).getCell(1).font = { bold: true };
  ws.addRow([]);
  const head = ws.addRow(['Fecha', 'Entrada – salida', 'Pausas (h)', 'Desplazamiento (h)', 'Ordinarias (h)', 'Extraordinarias (h)', 'Nocturnas (h)', 'Total (h)', 'Planificado (h)', 'Notas']);
  head.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  head.eachCell((c) => (c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F1524' } }));
  for (const d of r.days) {
    ws.addRow([
      new Date(`${d.date}T00:00:00Z`),
      intervals(d, r.timezone) || (d.off ?? ''),
      hoursDecimal(d.breakSeconds),
      hoursDecimal(d.travelSeconds),
      hoursDecimal(d.ordinarySeconds),
      hoursDecimal(d.overtimeSeconds),
      hoursDecimal(d.nightSeconds),
      hoursDecimal(d.workedSeconds),
      hoursDecimal(d.plannedSeconds),
      marks(d),
    ]);
  }
  const first = head.number + 1;
  const last = head.number + r.days.length;
  const total = ws.addRow(['Total', '', ...['C', 'D', 'E', 'F', 'G', 'H', 'I'].map((c) => ({ formula: `SUM(${c}${first}:${c}${last})` }))]);
  total.font = { bold: true };
  ws.getColumn(1).numFmt = 'ddd dd/mm/yyyy';
  ws.getColumn(1).width = 16;
  ws.getColumn(2).width = 38;
  for (let c = 3; c <= 9; c++) {
    ws.getColumn(c).width = 16;
    ws.getColumn(c).numFmt = '0.00';
  }
  ws.addRow([]);
  ws.addRow(['M: tramo manual · F: fuera del perímetro asignado · S: sin posición GPS']);
  ws.addRow([LEGAL]);
}

/** Nombre de hoja válido en Excel (31 caracteres, sin []:*?/\, sin comillas en los extremos) y distinto de los anteriores. */
function sheetName(name: string, used: Set<string>): string {
  // Excel tampoco admite comillas simples en los extremos ni el nombre reservado «History».
  const clean = name.replace(/[[\]:*?/\\]/g, ' ').replace(/^['\s]+|['\s]+$/g, '').slice(0, 28).replace(/['\s]+$/g, '');
  const base = !clean || clean.toLowerCase() === 'history' ? 'Persona' : clean;
  let candidate = base;
  for (let i = 2; used.has(candidate.toLowerCase()); i++) candidate = `${base.slice(0, 26)} ${i}`;
  used.add(candidate.toLowerCase());
  return candidate;
}

/** Registro de toda la plantilla: una hoja de resumen (una fila por persona) y una hoja por persona. */
export async function teamTimesheetXlsx(reports: TimesheetReport[], month: string, organization: string): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'HR-Core';
  const summary = wb.addWorksheet('Resumen');
  summary.addRow([organization]).font = { bold: true, size: 14 };
  summary.addRow([`Registro de jornada de ${monthLabel(month)}`]);
  summary.addRow([]);
  const head = summary.addRow(['Trabajador/a', 'DNI/NIE', 'Días trabajados', 'Total (h)', 'Ordinarias (h)', 'Extraordinarias (h)', 'Nocturnas (h)', 'Desplazamiento (h)', 'Planificado (h)', 'Ausencia justificada (h)']);
  head.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  head.eachCell((c) => (c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F1524' } }));
  for (const r of reports) {
    summary.addRow([
      r.person.fullName,
      r.person.dniNie ?? '',
      r.days.filter((d) => d.workedSeconds > 0).length,
      hoursDecimal(r.total.workedSeconds),
      hoursDecimal(r.total.ordinarySeconds),
      hoursDecimal(r.total.overtimeSeconds),
      hoursDecimal(r.total.nightSeconds),
      hoursDecimal(r.total.travelSeconds),
      hoursDecimal(r.total.plannedSeconds),
      hoursDecimal(r.total.absenceSeconds),
    ]);
  }
  summary.getColumn(1).width = 30;
  summary.getColumn(2).width = 14;
  for (let c = 3; c <= 10; c++) {
    summary.getColumn(c).width = 16;
    if (c > 3) summary.getColumn(c).numFmt = '0.00';
  }
  summary.addRow([]);
  summary.addRow([LEGAL]);
  const used = new Set(['resumen']);
  for (const r of reports) addTimesheetSheet(wb, r, sheetName(r.person.fullName, used));
  return Buffer.from(await wb.xlsx.writeBuffer());
}

/** Un solo PDF con el registro de cada persona, uno detrás de otro. */
export async function teamTimesheetPdf(reports: TimesheetReport[]): Promise<Buffer> {
  const out = await PDFDocument.create();
  out.setTitle(`Registro de jornada ${reports[0]?.month ?? ''}`);
  out.setProducer('HR-Core');
  for (const r of reports) {
    const one = await PDFDocument.load(await timesheetPdf(r));
    for (const page of await out.copyPages(one, one.getPageIndices())) out.addPage(page);
  }
  return Buffer.from(await out.save());
}

export function timesheetCsv(r: TimesheetReport): Buffer {
  const rows: (string | number)[][] = [
    ['Empresa', r.organization?.name ?? 'Registro personal'],
    ['Trabajador/a', r.person.fullName, 'DNI/NIE', r.person.dniNie ?? ''],
    ['Periodo', monthLabel(r.month)],
    [],
    ['Fecha', 'Tipo', 'Inicio', 'Fin', 'Horas', 'Origen', 'Ubicación', 'Dentro del perímetro', 'Latitud inicio', 'Longitud inicio', 'Precisión (m)', 'Dirección'],
  ];
  for (const d of r.days) {
    for (const s of d.segments) {
      rows.push([
        esDate(d.date),
        SEGMENT_ES(s.entryType, s.breakKind),
        hhmmss(s.startTime, r.timezone),
        s.endTime ? hhmmss(s.endTime, r.timezone) : '',
        hoursDecimal(((s.endTime ?? r.generatedAt).getTime() - s.startTime.getTime()) / 1000),
        s.origin === 'MANUAL' ? 'Manual' : 'Cronómetro',
        s.location?.name ?? '',
        s.isWithinGeofence === null ? '' : s.isWithinGeofence ? 'Sí' : 'No',
        s.startLat ?? '',
        s.startLng ?? '',
        s.startAccuracy === null ? '' : Math.round(s.startAccuracy),
        s.startAddress ?? '',
      ]);
    }
  }
  return csv(rows);
}
