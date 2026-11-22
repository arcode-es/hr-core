/**
 * Límite por minuto e IP de una ruta sensible (cambiar la contraseña, borrar la cuenta,
 * exportar datos). Los tests de navegador relajan los límites de /auth con
 * AUTH_RATE_LIMIT_PER_MINUTE; con un valor alto, también se relajan estos.
 */
export const strictLimit =
  (perMinute: number) =>
  (): number => {
    const relaxed = Number(process.env.AUTH_RATE_LIMIT_PER_MINUTE ?? 0);
    return relaxed > 1000 ? relaxed : perMinute;
  };
