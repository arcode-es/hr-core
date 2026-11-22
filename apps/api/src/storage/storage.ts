/**
 * Almacén de archivos privados (fotos de fichaje, tickets, documentos).
 * Nada se sirve con URL pública permanente: solo enlaces firmados que caducan.
 */
export abstract class Storage {
  abstract put(key: string, body: Buffer, contentType: string): Promise<void>;
  abstract get(key: string): Promise<Buffer>;
  /** Enlace temporal de solo lectura. */
  abstract signedUrl(key: string, ttlSeconds?: number): Promise<string>;
  /** Borra archivos. Las claves que no existen se ignoran. Solo lo usa el reinicio de la demo. */
  abstract delete(keys: string[]): Promise<void>;
}

/** Las claves las genera siempre el servidor; aun así se rechaza cualquier intento de salir del árbol. */
export function assertSafeKey(key: string): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9/_.-]*$/.test(key) || key.includes('..') || key.includes('//')) {
    throw new Error(`Clave de almacenamiento no válida: ${key}`);
  }
}
