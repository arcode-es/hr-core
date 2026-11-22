import {
  GEOFENCE_MAX_METERS,
  GEOFENCE_MIN_METERS,
  type GeoPlace,
  LOCATION_COLORS,
  type LocationDto,
  locationSchema,
} from '@hr/shared';
import { useMutation, useQuery } from '@tanstack/react-query';
import { ArrowLeft, Check, Download, LocateFixed, MapPin, QrCode, RefreshCw, Search, X } from 'lucide-react';
import { type CSSProperties, type FormEvent, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, Navigate, useNavigate, useParams } from 'react-router';
import { api, apiDownload } from '../lib/api';
import { cn } from '../lib/cn';
import { errorMessage } from '../lib/errors';
import { formatDistance } from '../lib/format';
import { currentPosition, type GeoFailure, geolocationGranted } from '../lib/geolocation';
import { queryClient } from '../lib/query';
import { useSession, useWorkspace } from '../stores/session';
import { toast } from '../stores/toast';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { Field } from '../ui/Field';
import { GeofenceEditorMap, type LatLng } from '../ui/Map';
import { Spinner } from '../ui/Spinner';
import { locationsKey, useCanManageLocations } from './Locations';

const PRESETS = [50, 100, 200, 500];
const DEFAULT_RADIUS = 200;

/** Buscador de direcciones superpuesto al mapa. */
function AddressSearch({ onPick }: { onPick: (p: GeoPlace) => void }) {
  const { t, i18n } = useTranslation();
  const [q, setQ] = useState('');
  const [results, setResults] = useState<GeoPlace[] | null>(null);
  const [busy, setBusy] = useState(false);
  const seq = useRef(0);

  useEffect(() => {
    const query = q.trim();
    if (query.length < 3) {
      setResults(null);
      return;
    }
    const id = ++seq.current;
    // Espera a que se deje de escribir: el geocodificador admite pocas peticiones.
    const timer = setTimeout(() => {
      setBusy(true);
      api<GeoPlace[]>(`/geo/search?q=${encodeURIComponent(query)}&lang=${i18n.resolvedLanguage ?? 'es'}`)
        .then((r) => id === seq.current && setResults(r))
        .catch(() => id === seq.current && setResults([]))
        .finally(() => id === seq.current && setBusy(false));
    }, 600);
    return () => clearTimeout(timer);
  }, [q, i18n.resolvedLanguage]);

  return (
    <div className="edge rounded-2xl bg-surface shadow-pop">
      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-3.5 size-[18px] -translate-y-1/2 text-fg-subtle" />
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t('locations.searchPlaceholder')}
          aria-label={t('locations.searchPlaceholder')}
          enterKeyHint="search"
          className="h-12 w-full rounded-2xl bg-transparent pr-11 pl-11 text-base placeholder:text-fg-subtle focus:outline-none [&::-webkit-search-cancel-button]:hidden"
        />
        <span className="absolute top-1/2 right-1.5 flex size-9 -translate-y-1/2 items-center justify-center text-fg-subtle">
          {busy ? (
            <Spinner className="size-4" />
          ) : (
            q && (
              <button type="button" onClick={() => setQ('')} aria-label={t('common.close')} className="focus-ring flex size-9 items-center justify-center rounded-full hover:text-fg">
                <X className="size-4" />
              </button>
            )
          )}
        </span>
      </div>
      {results && (
        <ul className="edge-t max-h-56 overflow-y-auto py-1">
          {results.length === 0 ? (
            <li className="px-4 py-3 text-sm text-fg-muted">{t('locations.searchEmpty')}</li>
          ) : (
            results.map((r) => (
              <li key={`${r.latitude},${r.longitude}`}>
                <button
                  type="button"
                  onClick={() => {
                    onPick(r);
                    setQ('');
                  }}
                  className="focus-ring flex w-full items-start gap-2.5 px-4 py-2.5 text-left text-sm hover:bg-surface-2"
                >
                  <MapPin className="mt-0.5 size-4 shrink-0 text-fg-subtle" />
                  <span className="line-clamp-2">{r.label}</span>
                </button>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}

function EditorForm({ existing }: { existing: LocationDto | null }) {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const workspaceId = useSession((s) => s.workspaceId);

  const [name, setName] = useState(existing?.name ?? '');
  const [address, setAddress] = useState(existing?.address ?? '');
  const [point, setPoint] = useState<LatLng | null>(existing ? { lat: existing.latitude, lng: existing.longitude } : null);
  const [radius, setRadius] = useState(existing?.geofenceRadiusMeters ?? DEFAULT_RADIUS);
  const [color, setColor] = useState<string>(existing?.color ?? LOCATION_COLORS[0]);
  const [isActive, setIsActive] = useState(existing?.isActive ?? true);
  const [nameError, setNameError] = useState(false);
  const [saving, setSaving] = useState(false);
  const [locating, setLocating] = useState(false);
  const [resolving, setResolving] = useState(false);
  // Si el usuario escribe la dirección a mano, no se la pisamos al mover el punto.
  const addressEdited = useRef(!!existing?.address);
  const reverseSeq = useRef(0);

  const movePoint = (p: LatLng, knownAddress?: string): void => {
    setPoint(p);
    if (knownAddress !== undefined) {
      reverseSeq.current++;
      addressEdited.current = false;
      setAddress(knownAddress);
      setResolving(false);
      return;
    }
    if (addressEdited.current) return;
    const id = ++reverseSeq.current;
    setResolving(true);
    api<{ address: string | null }>(`/geo/reverse?lat=${p.lat}&lng=${p.lng}&lang=${i18n.resolvedLanguage ?? 'es'}`)
      .then((r) => id === reverseSeq.current && !addressEdited.current && setAddress(r.address ?? ''))
      .catch(() => undefined)
      .finally(() => id === reverseSeq.current && setResolving(false));
  };

  const locate = async (silent = false): Promise<void> => {
    setLocating(true);
    try {
      const p = await currentPosition();
      movePoint({ lat: p.lat, lng: p.lng });
    } catch (reason) {
      if (!silent) toast.error(t(`locations.geo_${reason as GeoFailure}`));
    } finally {
      setLocating(false);
    }
  };

  // Al crear, si el permiso ya estaba concedido, empieza donde está el usuario.
  useEffect(() => {
    if (existing) return;
    void geolocationGranted().then((ok) => {
      if (ok) void locate(true);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const submit = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    if (!point) return;
    const parsed = locationSchema.safeParse({
      name,
      address,
      latitude: point.lat,
      longitude: point.lng,
      geofenceRadiusMeters: radius,
      color,
    });
    if (!parsed.success) {
      setNameError(parsed.error.issues.some((i) => i.path[0] === 'name'));
      return;
    }
    setSaving(true);
    try {
      if (existing) {
        await api(`/locations/${existing.id}`, { method: 'PATCH', body: { ...parsed.data, isActive } });
      } else {
        await api('/locations', { method: 'POST', body: parsed.data });
      }
      await queryClient.invalidateQueries({ queryKey: locationsKey(workspaceId) });
      toast.success(existing ? t('common.saved') : t('locations.created'));
      void navigate('/locations');
    } catch (err) {
      toast.error(errorMessage(t, err));
      setSaving(false);
    }
  };

  const fill = ((radius - GEOFENCE_MIN_METERS) / (GEOFENCE_MAX_METERS - GEOFENCE_MIN_METERS)) * 100;

  return (
    <div className="animate-page">
      <div className="mb-4 flex items-center gap-2">
        <Link
          to="/locations"
          aria-label={t('common.back')}
          className="focus-ring -ml-2 flex size-10 items-center justify-center rounded-full text-fg-muted hover:bg-surface-2 hover:text-fg"
        >
          <ArrowLeft className="size-5" />
        </Link>
        <h1 className="truncate text-2xl font-bold tracking-tight">{existing ? existing.name : t('locations.newTitle')}</h1>
      </div>

      <form onSubmit={submit} noValidate className="space-y-4">
        <Card className="relative h-[46dvh] min-h-72 overflow-hidden lg:h-[420px]">
          <GeofenceEditorMap value={point} radius={radius} color={color} onChange={(p) => movePoint(p)} label={t('locations.mapLabel')} />
          <div className="absolute inset-x-3 top-3 z-10">
            <AddressSearch onPick={(p) => movePoint({ lat: p.latitude, lng: p.longitude }, p.label)} />
          </div>
          <button
            type="button"
            onClick={() => void locate()}
            disabled={locating}
            aria-label={t('locations.useMyLocation')}
            title={t('locations.useMyLocation')}
            className="focus-ring edge absolute right-3 bottom-6 z-10 flex size-12 items-center justify-center rounded-full bg-surface text-accent-text shadow-pop transition-transform active:scale-95"
          >
            {locating ? <Spinner className="size-5" /> : <LocateFixed className="size-[22px]" />}
          </button>
          {!point && (
            <p className="pointer-events-none absolute inset-x-0 bottom-6 z-10 mx-auto w-fit max-w-[70%] rounded-full bg-fg px-4 py-2 text-center text-sm font-medium text-bg shadow-pop">
              {t('locations.tapHint')}
            </p>
          )}
        </Card>

        <Card className="space-y-5 p-4 sm:p-5">
          <Field
            label={t('locations.name')}
            placeholder={t('locations.namePlaceholder')}
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setNameError(false);
            }}
            error={nameError ? t('validation.tooShort') : undefined}
            maxLength={80}
          />
          <Field
            label={t('locations.address')}
            value={address}
            onChange={(e) => {
              addressEdited.current = e.target.value !== '';
              setAddress(e.target.value);
            }}
            hint={resolving ? t('locations.resolving') : t('locations.addressHint')}
            maxLength={240}
          />

          <div>
            <div className="flex items-baseline justify-between">
              <label htmlFor="radius" className="text-sm font-medium">
                {t('locations.radius')}
              </label>
              <output htmlFor="radius" className="text-lg font-bold tabular-nums">
                {formatDistance(radius, i18n.resolvedLanguage)}
              </output>
            </div>
            <input
              id="radius"
              type="range"
              className="slider"
              min={GEOFENCE_MIN_METERS}
              max={GEOFENCE_MAX_METERS}
              step={25}
              value={radius}
              onChange={(e) => setRadius(Number(e.target.value))}
              style={{ '--fill': `${fill}%` } as CSSProperties}
              aria-valuetext={formatDistance(radius, i18n.resolvedLanguage)}
            />
            <div className="mt-1 flex gap-2">
              {PRESETS.map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setRadius(p)}
                  aria-pressed={radius === p}
                  className={cn(
                    'focus-ring h-9 flex-1 rounded-full text-sm font-semibold transition-colors',
                    radius === p ? 'bg-accent text-accent-fg' : 'edge bg-surface text-fg-muted hover:bg-surface-2',
                  )}
                >
                  {p} m
                </button>
              ))}
            </div>
            <p className="mt-2 text-sm text-fg-muted">{t('locations.radiusHint')}</p>
          </div>

          <div>
            <p className="mb-2 text-sm font-medium" id="color-label">
              {t('locations.color')}
            </p>
            <div role="radiogroup" aria-labelledby="color-label" className="flex gap-3">
              {LOCATION_COLORS.map((c, i) => (
                <button
                  key={c}
                  type="button"
                  role="radio"
                  aria-checked={color === c}
                  aria-label={`${t('locations.color')} ${i + 1}`}
                  onClick={() => setColor(c)}
                  className={cn(
                    'focus-ring flex size-10 items-center justify-center rounded-full text-white transition-transform',
                    color === c && 'scale-110 ring-2 ring-fg ring-offset-2 ring-offset-surface',
                  )}
                  style={{ backgroundColor: c }}
                >
                  {color === c && <Check className="size-5" strokeWidth={3} />}
                </button>
              ))}
            </div>
          </div>

          {existing && (
            <label className="edge-t flex cursor-pointer items-center gap-3 pt-4">
              <span className="min-w-0 flex-1">
                <span className="block font-semibold">{t('locations.active')}</span>
                <span className="block text-sm text-fg-muted">{t('locations.activeHint')}</span>
              </span>
              <input type="checkbox" role="switch" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} className="peer sr-only" />
              <span className="relative h-8 w-14 shrink-0 rounded-full bg-border-strong transition-colors peer-checked:bg-success peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-(--ring) after:absolute after:top-1 after:left-1 after:size-6 after:rounded-full after:bg-white after:shadow after:transition-transform peer-checked:after:translate-x-6" />
            </label>
          )}
        </Card>

        <Button type="submit" size="lg" block loading={saving} disabled={!point}>
          {existing ? t('common.save') : t('locations.create')}
        </Button>
      </form>
      {existing && <QrPoster location={existing} />}
    </div>
  );
}

/** Cartel con el QR de la ubicación: fichar escaneándolo cuenta como presencia aunque falle el GPS. */
function QrPoster({ location }: { location: LocationDto }) {
  const { t } = useTranslation();
  const ws = useWorkspace();
  const download = useMutation({
    mutationFn: () => apiDownload(`/locations/${location.id}/qr.pdf`, 'qr.pdf'),
    onError: (e) => toast.error(errorMessage(t, e)),
  });
  const regenerate = useMutation({
    mutationFn: () => api<{ code: string }>(`/locations/${location.id}/qr`, { method: 'POST' }),
    onSuccess: () => toast.success(t('locations.qrRegenerated')),
    onError: (e) => toast.error(errorMessage(t, e)),
  });
  if (ws.kind !== 'organization') return null;
  return (
    <Card className="mt-4 space-y-3 p-4 sm:p-5">
      <div className="flex items-start gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent-text">
          <QrCode className="size-5" />
        </span>
        <div className="min-w-0">
          <h2 className="font-semibold">{t('locations.qrTitle')}</h2>
          <p className="text-sm text-fg-muted">{t('locations.qrDesc')}</p>
        </div>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <Button variant="secondary" loading={download.isPending} onClick={() => download.mutate()} icon={<Download className="size-4" />}>
          {t('locations.qrDownload')}
        </Button>
        <Button
          variant="ghost"
          loading={regenerate.isPending}
          onClick={() => window.confirm(t('locations.qrRegenerateConfirm')) && regenerate.mutate()}
          icon={<RefreshCw className="size-4" />}
        >
          {t('locations.qrRegenerate')}
        </Button>
      </div>
    </Card>
  );
}

export function LocationEditor() {
  const { id } = useParams();
  const workspaceId = useSession((s) => s.workspaceId);
  const canManage = useCanManageLocations();
  const { data, isPending } = useQuery({
    queryKey: locationsKey(workspaceId),
    queryFn: () => api<LocationDto[]>('/locations'),
    enabled: !!id,
  });

  if (!canManage) return <Navigate to="/locations" replace />;
  if (!id) return <EditorForm existing={null} />;
  if (isPending) {
    return (
      <div className="flex justify-center py-16 text-fg-subtle">
        <Spinner className="size-6" />
      </div>
    );
  }
  const existing = data?.find((l) => l.id === id);
  // Cambiar de espacio con el editor abierto: la ubicación ya no pertenece al espacio activo.
  if (!existing) return <Navigate to="/locations" replace />;
  return <EditorForm key={existing.id} existing={existing} />;
}
