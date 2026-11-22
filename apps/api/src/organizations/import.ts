import { IMPORT_ERRORS, type ImportError, type ImportRow, type Role } from '@hr/shared';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { z } from 'zod';
import { normalizeDni, validDniNie } from '../common/dni';

/*
 * Plantilla de alta masiva: CSV (con «;» o «,», como lo exporta Excel en español) o
 * XLSX. La primera fila es la cabecera; las columnas se reconocen por su nombre, en
 * cualquier orden y en español o en inglés.
 */

type Field = 'email' | 'fullName' | 'dniNie' | 'role' | 'department' | 'jobTitle' | 'weeklyHours';

const HEADERS: Record<Field, string[]> = {
  email: ['correo', 'correoelectronico', 'email', 'mail', 'emailaddress'],
  fullName: ['nombre', 'nombreyapellidos', 'nombrecompleto', 'name', 'fullname'],
  dniNie: ['dni', 'nie', 'dninie', 'nif', 'documento', 'id'],
  role: ['rol', 'role', 'perfil'],
  department: ['departamento', 'department', 'equipo', 'area', 'team'],
  jobTitle: ['puesto', 'cargo', 'jobtitle', 'position', 'title'],
  weeklyHours: ['jornada', 'horassemanales', 'horas', 'weeklyhours', 'hours', 'horassemana'],
};

const ROLES: Record<string, Role> = {
  empleado: 'EMPLOYEE',
  empleada: 'EMPLOYEE',
  employee: 'EMPLOYEE',
  trabajador: 'EMPLOYEE',
  trabajadora: 'EMPLOYEE',
  responsable: 'MANAGER',
  manager: 'MANAGER',
  encargado: 'MANAGER',
  encargada: 'MANAGER',
  administrador: 'ADMIN',
  administradora: 'ADMIN',
  administracion: 'ADMIN',
  admin: 'ADMIN',
  inspeccion: 'INSPECTOR',
  inspector: 'INSPECTOR',
  inspectora: 'INSPECTOR',
  representacionlegal: 'INSPECTOR',
};

const key = (s: string): string =>
  s
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');

export class UnreadableImportError extends Error {}

/** CSV con comillas, saltos de línea dentro de comillas y separador «;», «,» o tabulador. */
export function parseCsv(text: string): string[][] {
  const clean = text.replace(/^﻿/, '');
  const firstLine = clean.split(/\r?\n/, 1)[0] ?? '';
  const sep = [';', '\t', ','].reduce((best, c) => (firstLine.split(c).length > firstLine.split(best).length ? c : best), ',');
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < clean.length; i++) {
    const c = clean[i]!;
    if (quoted) {
      if (c === '"' && clean[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"' && cell === '') quoted = true;
    else if (c === sep) {
      row.push(cell);
      cell = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && clean[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += c;
  }
  if (cell !== '' || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((v) => v.trim() !== ''));
}

const cellText = (v: ExcelJS.CellValue): string => {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'object') {
    if ('text' in v && typeof v.text === 'string') return v.text; // enlace (los correos suelen serlo)
    if ('richText' in v) return v.richText.map((r) => r.text).join('');
    if ('result' in v) return String(v.result ?? '');
    return '';
  }
  return String(v);
};

/** Lo máximo que puede ocupar un libro una vez descomprimido: una hoja de 500 filas no pasa de unos cientos de KB. */
const MAX_XLSX_INFLATED_BYTES = 8 * 1024 * 1024;

/**
 * Tamaño descomprimido declarado en el índice del zip, sin descomprimir nada. Un xlsx pequeño
 * puede expandirse a cientos de MB: se rechaza antes de entregárselo a ExcelJS.
 */
async function inflatedSize(buffer: Buffer): Promise<number> {
  const zip = await JSZip.loadAsync(buffer);
  let total = 0;
  zip.forEach((_, file) => {
    total += (file as unknown as { _data?: { uncompressedSize?: number } })._data?.uncompressedSize ?? 0;
  });
  return total;
}

async function parseXlsx(buffer: Buffer): Promise<string[][]> {
  if ((await inflatedSize(buffer)) > MAX_XLSX_INFLATED_BYTES) throw new UnreadableImportError();
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as unknown as ArrayBuffer);
  const sheet = wb.worksheets[0];
  if (!sheet) return [];
  const rows: string[][] = [];
  sheet.eachRow({ includeEmpty: false }, (r) => {
    const values: string[] = [];
    for (let c = 1; c <= r.cellCount; c++) values.push(cellText(r.getCell(c).value).trim());
    rows.push(values);
  });
  return rows.filter((r) => r.some((v) => v !== ''));
}

const XLSX_MAGIC = Buffer.from([0x50, 0x4b, 0x03, 0x04]);

/** Lee el archivo y devuelve las filas con sus errores. `members` = correos que ya están en la empresa. */
export async function readImport(buffer: Buffer, members: Set<string>): Promise<{ rows: ImportRow[]; columns: string[] }> {
  let table: string[][];
  try {
    table = buffer.subarray(0, 4).equals(XLSX_MAGIC) ? await parseXlsx(buffer) : parseCsv(buffer.toString('utf8'));
  } catch {
    throw new UnreadableImportError();
  }
  const [header, ...body] = table;
  if (!header) throw new UnreadableImportError();
  const index = {} as Partial<Record<Field, number>>;
  header.forEach((h, i) => {
    const k = key(h);
    const field = (Object.keys(HEADERS) as Field[]).find((f) => HEADERS[f].includes(k));
    if (field && index[field] === undefined) index[field] = i;
  });
  if (index.email === undefined || index.fullName === undefined) throw new UnreadableImportError();
  if (body.length > 500) throw new UnreadableImportError();

  const email = z.string().trim().toLowerCase().email().max(254);
  const seen = new Set<string>();
  const rows = body.map((cells, i): ImportRow => {
    const get = (f: Field): string => (index[f] === undefined ? '' : (cells[index[f]!] ?? '').trim());
    const errors: ImportError[] = [];
    const mail = email.safeParse(get('email'));
    if (!mail.success) errors.push('EMAIL');
    const address = mail.success ? mail.data : get('email').toLowerCase();
    if (mail.success && seen.has(address)) errors.push('DUPLICATE');
    if (mail.success && members.has(address)) errors.push('MEMBER');
    seen.add(address);

    const fullName = get('fullName').replace(/\s+/g, ' ');
    if (fullName.length < 2 || fullName.length > 120) errors.push('NAME');
    const dniRaw = get('dniNie');
    const dniNie = dniRaw ? normalizeDni(dniRaw) : null;
    if (dniNie && !validDniNie(dniNie)) errors.push('DNI');
    const roleRaw = key(get('role'));
    const role = roleRaw ? (ROLES[roleRaw] ?? (['ADMIN', 'MANAGER', 'EMPLOYEE', 'INSPECTOR'].includes(get('role').toUpperCase()) ? (get('role').toUpperCase() as Role) : null)) : 'EMPLOYEE';
    if (!role) errors.push('ROLE');
    const hoursRaw = get('weeklyHours').replace(',', '.');
    const hours = hoursRaw ? Number(hoursRaw) : null;
    if (hours !== null && (!Number.isFinite(hours) || hours < 0 || hours > 60)) errors.push('HOURS');

    return {
      line: i + 2,
      email: address,
      fullName,
      dniNie,
      role: role ?? 'EMPLOYEE',
      department: get('department').slice(0, 80) || null,
      jobTitle: get('jobTitle').slice(0, 80) || null,
      weeklyHours: hours !== null && Number.isFinite(hours) ? hours : null,
      errors: IMPORT_ERRORS.filter((e) => errors.includes(e)),
    };
  });
  return { rows, columns: (Object.keys(index) as Field[]).sort((a, b) => index[a]! - index[b]!) };
}

/** Plantilla para descargar: la cabecera, dos filas de ejemplo y una hoja con instrucciones. */
export async function importTemplate(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'HR-Core';
  const sheet = wb.addWorksheet('Plantilla');
  sheet.columns = [
    { header: 'Nombre y apellidos', width: 28 },
    { header: 'Correo electrónico', width: 30 },
    { header: 'DNI/NIE', width: 14 },
    { header: 'Rol', width: 14 },
    { header: 'Departamento', width: 18 },
    { header: 'Puesto', width: 20 },
    { header: 'Horas semanales', width: 16 },
  ];
  sheet.addRow(['Lucía Gómez Ferrer', 'lucia.gomez@ejemplo.es', '12345678Z', 'Empleado', 'Obra', 'Oficial de 1ª', 40]);
  sheet.addRow(['Marcos Ibáñez Sáez', 'marcos.ibanez@ejemplo.es', 'X1234567L', 'Responsable', 'Obra', 'Jefe de obra', 40]);
  sheet.getRow(1).font = { bold: true };
  sheet.views = [{ state: 'frozen', ySplit: 1 }];
  const help = wb.addWorksheet('Instrucciones');
  help.columns = [{ width: 22 }, { width: 80 }];
  for (const r of [
    ['Columna', 'Qué poner'],
    ['Nombre y apellidos', 'Obligatorio.'],
    ['Correo electrónico', 'Obligatorio. Le llegará la invitación a ese correo.'],
    ['DNI/NIE', 'Opcional. Se usa para repartir las nóminas y para firmar documentos.'],
    ['Rol', 'Empleado, Responsable, Administrador o Inspección. Vacío = Empleado.'],
    ['Departamento', 'Opcional. Si no existe, se crea.'],
    ['Puesto', 'Opcional.'],
    ['Horas semanales', 'Opcional. Jornada pactada, por ejemplo 40 o 20,5.'],
    ['', 'Se puede guardar como Excel o como CSV. Máximo 500 filas por archivo.'],
  ]) help.addRow(r);
  help.getRow(1).font = { bold: true };
  return Buffer.from(await wb.xlsx.writeBuffer());
}
