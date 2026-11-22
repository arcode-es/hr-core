/** Margen máximo que se concede por imprecisión del GPS al evaluar una geocerca. */
export const MAX_ACCURACY_ALLOWANCE_METERS = 50;

export interface GeofenceEvaluation {
  within: boolean;
  outsideByMeters: number;
}

/**
 * Decide si una posición está dentro de una geocerca.
 *
 * El GPS da un círculo de incertidumbre, no un punto. Si ese círculo toca la
 * geocerca se considera dentro, para no marcar «fuera de perímetro» a quien
 * está en la obra con mala señal; el margen se limita para que una precisión
 * pésima (cientos de metros en interiores) no valide cualquier posición.
 */
export function evaluateGeofence(
  distanceMeters: number,
  radiusMeters: number,
  accuracyMeters = 0,
): GeofenceEvaluation {
  const allowance = Math.min(Math.max(accuracyMeters, 0), MAX_ACCURACY_ALLOWANCE_METERS);
  const outside = distanceMeters - radiusMeters - allowance;
  return outside <= 0 ? { within: true, outsideByMeters: 0 } : { within: false, outsideByMeters: Math.ceil(outside) };
}
