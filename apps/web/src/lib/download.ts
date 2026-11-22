/**
 * Guarda un archivo en el dispositivo con el nombre indicado. El enlace se añade
 * al documento antes de pulsarlo: un enlace suelto hace que algunos navegadores
 * ignoren el nombre y guarden el archivo como «download».
 */
export function saveBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.rel = 'noopener';
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
