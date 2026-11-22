import type { TFunction } from 'i18next';
import type { FieldError } from 'react-hook-form';
import { ApiError } from './api';

/** Mensaje traducido para un error de la API. */
export function errorMessage(t: TFunction, error: unknown): string {
  const code = error instanceof ApiError ? error.code : 'UNKNOWN';
  return t(`errors.${code}`, { defaultValue: t('errors.UNKNOWN') });
}

/** Mensaje traducido para un error de validación de formulario (zod). */
export function fieldMessage(t: TFunction, error: FieldError | undefined): string | undefined {
  if (!error) return undefined;
  if (error.type === 'too_small') return t('validation.tooShort');
  if (error.type === 'too_big') return t('validation.tooLong');
  if (error.type === 'invalid_string') return t('validation.email');
  return t('validation.invalid');
}
