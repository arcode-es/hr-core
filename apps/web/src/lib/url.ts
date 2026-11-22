/** URL absoluta de una ruta de la app, respetando la carpeta donde se publica (p. ej. /HR-core). */
export const appUrl = (path: string): string =>
  `${window.location.origin}${import.meta.env.BASE_URL.replace(/\/$/, '')}${path.startsWith('/') ? path : `/${path}`}`;
