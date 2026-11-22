import type { ClockState, KioskIdentity, KioskInfo, PauseKind } from '@hr/shared';
import { ArrowLeft, Camera, CircleCheck, CloudOff, CreditCard, Delete, Pause, Play, Search, Square, Tablet, Unplug } from 'lucide-react';
import { type ChangeEvent, type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ApiError, isNetworkError } from '../lib/api';
import { cn } from '../lib/cn';
import { errorMessage } from '../lib/errors';
import { formatTime } from '../lib/format';
import { cachedInfo, flushKiosk, forgetKiosk, kioskApi, kioskToken, saveInfo, saveKiosk, sendKioskClock, startKioskSync, useKioskOutbox } from '../lib/kiosk';
import { evidenceLines, stampPhoto } from '../lib/photo';
import { Avatar } from '../ui/Avatar';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { LogoMark } from '../ui/Logo';
import { QrScanner } from '../ui/QrScanner';
import { SEGMENT_ICON } from '../time/Timeline';

/** Prefijo de las tarjetas personales que imprime la administración. */
const CARD_PREFIX = 'hrcore-card:';
/** Sin tocar nada, la tablet vuelve a la lista de personas (otra persona no ve la sesión de la anterior). */
const IDLE_MS = 45_000;
const DONE_MS = 4_000;

type Who = { membershipId: string; fullName: string } | { cardCode: string; fullName: null };
type Step =
  | { kind: 'home' }
  | { kind: 'pin'; who: Who }
  | { kind: 'action'; identity: KioskIdentity }
  | { kind: 'done'; action: 'START' | 'PAUSE' | 'RESUME' | 'STOP'; at: Date; queued: boolean; fullName: string };

function useNow(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(id);
  }, []);
  return now;
}

/** Mantiene la pantalla encendida mientras la tablet está en modo quiosco (donde el navegador lo permite). */
function useWakeLock(): void {
  useEffect(() => {
    let lock: { release: () => Promise<void> } | null = null;
    const request = async (): Promise<void> => {
      try {
        lock = (await (navigator as unknown as { wakeLock?: { request: (t: 'screen') => Promise<{ release: () => Promise<void> }> } }).wakeLock?.request('screen')) ?? null;
      } catch {
        /* sin permiso o sin soporte */
      }
    };
    void request();
    const again = (): void => void (document.visibilityState === 'visible' && request());
    document.addEventListener('visibilitychange', again);
    return () => {
      document.removeEventListener('visibilitychange', again);
      void lock?.release().catch(() => undefined);
    };
  }, []);
}

// ── Emparejar ────────────────────────────────────────────────────────────

function Pairing({ onPaired }: { onPaired: (info: KioskInfo) => void }) {
  const { t } = useTranslation();
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await kioskApi<{ token: string; info: KioskInfo }>('/kiosk/pair', { method: 'POST', body: { code } });
      saveKiosk(res.token, res.info);
      onPaired(res.info);
    } catch (err) {
      setError(errorMessage(t, err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <main className="flex min-h-dvh items-center justify-center bg-bg p-4">
      <form onSubmit={submit} className="edge w-full max-w-sm space-y-5 rounded-[1.75rem] bg-surface p-6 shadow-pop" noValidate>
        <div className="flex items-center gap-3">
          <LogoMark className="size-10" />
          <div>
            <h1 className="text-xl font-bold tracking-tight">{t('kiosk.pairTitle')}</h1>
            <p className="text-sm text-fg-muted">{t('kiosk.title')}</p>
          </div>
        </div>
        <p className="text-sm text-fg-muted">{t('kiosk.pairDesc')}</p>
        <div>
          <label htmlFor="kiosk-code" className="mb-1.5 block text-sm font-medium">
            {t('kiosk.pairCode')}
          </label>
          <input
            id="kiosk-code"
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8))}
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            aria-invalid={!!error}
            aria-describedby={error ? 'kiosk-code-err' : undefined}
            className="focus-ring edge h-16 w-full rounded-control bg-surface text-center font-mono text-3xl font-bold tracking-[0.3em] uppercase"
          />
          {error && (
            <p id="kiosk-code-err" role="alert" className="mt-1.5 text-sm font-medium text-danger-text">
              {error}
            </p>
          )}
        </div>
        <Button type="submit" size="lg" block loading={busy} disabled={code.length !== 8}>
          {t('kiosk.pair')}
        </Button>
      </form>
    </main>
  );
}

// ── PIN ──────────────────────────────────────────────────────────────────

function PinPad({ who, onBack, onIdentified }: { who: Who; onBack: () => void; onIdentified: (id: KioskIdentity) => void }) {
  const { t } = useTranslation();
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = useCallback(async (): Promise<void> => {
    if (pin.length < 4 || busy) return;
    setBusy(true);
    setError(null);
    try {
      const body = 'cardCode' in who ? { cardCode: who.cardCode, pin } : { membershipId: who.membershipId, pin };
      onIdentified(await kioskApi<KioskIdentity>('/kiosk/identify', { method: 'POST', body }));
    } catch (e) {
      setPin('');
      setError(isNetworkError(e) ? t('kiosk.offlineHint') : errorMessage(t, e));
    } finally {
      setBusy(false);
    }
  }, [pin, busy, who, onIdentified, t]);

  // También con un teclado físico (algunas tablets llevan funda con teclado).
  useEffect(() => {
    const key = (e: KeyboardEvent): void => {
      if (/^\d$/.test(e.key)) setPin((p) => (p.length < 6 ? p + e.key : p));
      else if (e.key === 'Backspace') setPin((p) => p.slice(0, -1));
      else if (e.key === 'Enter') void submit();
      else if (e.key === 'Escape') onBack();
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [submit, onBack]);

  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'erase', '0', 'ok'] as const;
  return (
    <section aria-labelledby="pin-title" className="mx-auto w-full max-w-sm">
      <Button variant="ghost" onClick={onBack} icon={<ArrowLeft className="size-5" />}>
        {t('kiosk.back')}
      </Button>
      <h2 id="pin-title" className="mt-3 text-center text-2xl font-bold tracking-tight">
        {who.fullName ? t('kiosk.hello', { name: who.fullName }) : t('kiosk.scanCard')}
      </h2>
      <p className="mt-1 text-center text-fg-muted">{t('kiosk.pinDesc')}</p>
      <div className="mt-5 flex justify-center gap-3" role="img" aria-label={`${t('kiosk.pinLabel')}: ${pin.length}`}>
        {Array.from({ length: Math.max(4, pin.length) }, (_, i) => (
          <span key={i} className={cn('size-4 rounded-full border-2 border-fg-muted', i < pin.length && 'border-fg bg-fg')} />
        ))}
      </div>
      <p role="alert" className="mt-3 min-h-10 text-center text-sm font-medium text-danger-text">
        {error}
      </p>
      <div className="grid grid-cols-3 gap-3">
        {keys.map((k) =>
          k === 'erase' ? (
            <button
              key={k}
              type="button"
              onClick={() => setPin((p) => p.slice(0, -1))}
              aria-label={t('kiosk.erase')}
              className="focus-ring flex h-20 items-center justify-center rounded-2xl text-fg-muted hover:bg-surface-2"
            >
              <Delete className="size-7" />
            </button>
          ) : k === 'ok' ? (
            <button
              key={k}
              type="button"
              onClick={() => void submit()}
              disabled={pin.length < 4 || busy}
              className="focus-ring flex h-20 items-center justify-center rounded-2xl bg-accent text-lg font-bold text-accent-fg disabled:opacity-50"
            >
              {t('kiosk.confirm')}
            </button>
          ) : (
            <button
              key={k}
              type="button"
              onClick={() => setPin((p) => (p.length < 6 ? p + k : p))}
              className="focus-ring edge flex h-20 items-center justify-center rounded-2xl bg-surface text-3xl font-semibold tabular-nums hover:bg-surface-2 active:scale-[0.97]"
            >
              {k}
            </button>
          ),
        )}
      </div>
    </section>
  );
}

// ── Fichar ───────────────────────────────────────────────────────────────

function Actions({ identity, info, onDone, onBack }: { identity: KioskIdentity; info: KioskInfo; onDone: (step: Extract<Step, { kind: 'done' }>) => void; onBack: () => void }) {
  const { t } = useTranslation();
  const input = useRef<HTMLInputElement>(null);
  const [photo, setPhoto] = useState<Blob | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [noPhoto, setNoPhoto] = useState(false);
  const [pausing, setPausing] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const state: ClockState = identity.state;

  useEffect(() => {
    if (!photo) return setPreview(null);
    const url = URL.createObjectURL(photo);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [photo]);

  const pick = async (e: ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      setPhoto(await stampPhoto(file, evidenceLines(new Date(), null, t('kiosk.stamp', { name: info.locationName ?? info.name }))));
      setNoPhoto(false);
    } catch {
      setError(t('clock.photoError'));
    }
  };

  const needsPhoto = (action: string): boolean => info.requirePhoto && (action === 'START' || action === 'STOP') && !photo && !noPhoto;

  const send = async (action: 'START' | 'PAUSE' | 'RESUME' | 'STOP', pause?: PauseKind): Promise<void> => {
    if (needsPhoto(action)) {
      setError(t('kiosk.photoRequired'));
      return;
    }
    setBusy(action);
    setError(null);
    try {
      const evidence = action === 'START' || action === 'STOP' ? photo : null;
      const { queued } = await sendKioskClock(
        {
          token: identity.token,
          action,
          pause,
          clientTime: new Date().toISOString(),
          clientUuid: crypto.randomUUID(),
          ...(noPhoto && !evidence && (action === 'START' || action === 'STOP') ? { photoUnavailable: true } : {}),
        },
        evidence ?? undefined,
      );
      navigator.vibrate?.(35);
      onDone({ kind: 'done', action, at: new Date(), queued, fullName: identity.fullName });
    } catch (e) {
      setError(errorMessage(t, e));
      if (e instanceof ApiError && e.code === 'INVALID_CLOCK_STATE') window.setTimeout(onBack, 2500);
    } finally {
      setBusy(null);
    }
  };

  const photoBlock = (
    <div className="edge rounded-2xl bg-surface p-3">
      <input ref={input} type="file" accept="image/*" capture="user" className="sr-only" onChange={pick} tabIndex={-1} aria-hidden="true" />
      <p className="mb-2 text-sm font-medium">{info.requirePhoto ? t('kiosk.photoRequired') : t('kiosk.photoOptional')}</p>
      <div className="flex items-center gap-3">
        {preview ? <img src={preview} alt={t('clock.photoAlt')} className="size-16 rounded-xl object-cover" /> : null}
        <Button variant="secondary" onClick={() => input.current?.click()} icon={<Camera className="size-5" />}>
          {photo ? t('kiosk.retake') : t('kiosk.takePhoto')}
        </Button>
        {info.requirePhoto && !photo && (
          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <input type="checkbox" checked={noPhoto} onChange={(e) => setNoPhoto(e.target.checked)} className="size-5 accent-(--accent)" />
            {t('kiosk.noPhoto')}
          </label>
        )}
      </div>
    </div>
  );

  return (
    <section aria-labelledby="action-title" className="mx-auto w-full max-w-lg space-y-5">
      <Button variant="ghost" onClick={onBack} icon={<ArrowLeft className="size-5" />}>
        {t('kiosk.back')}
      </Button>
      <div className="text-center">
        <h2 id="action-title" className="text-3xl font-bold tracking-tight">
          {t('kiosk.hello', { name: identity.fullName })}
        </h2>
        <p className="mt-2">
          <Badge tone={state === 'WORKING' ? 'success' : state === 'PAUSED' ? 'warning' : 'neutral'}>{t(`kiosk.state_${state}`)}</Badge>
        </p>
      </div>

      {state !== 'PAUSED' && photoBlock}

      {pausing ? (
        <div className="grid gap-3 sm:grid-cols-3">
          {(['MEAL', 'REST', 'TRAVEL'] as const).map((p) => {
            const Icon = SEGMENT_ICON[p];
            return (
              <Button key={p} variant="secondary" size="lg" loading={busy === 'PAUSE'} onClick={() => void send('PAUSE', p)} icon={<Icon className="size-5" />}>
                {t(`clock.kind_${p}`)}
              </Button>
            );
          })}
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {state === 'IDLE' && (
            <Button size="lg" className="h-20 text-xl sm:col-span-2" loading={busy === 'START'} onClick={() => void send('START')} icon={<Play className="size-6 fill-current" />}>
              {t('kiosk.start')}
            </Button>
          )}
          {state === 'WORKING' && (
            <Button variant="secondary" size="lg" className="h-20 text-xl" disabled={!!busy} onClick={() => setPausing(true)} icon={<Pause className="size-6" />}>
              {t('kiosk.pause')}
            </Button>
          )}
          {state === 'PAUSED' && (
            <Button size="lg" className="h-20 text-xl" loading={busy === 'RESUME'} onClick={() => void send('RESUME')} icon={<Play className="size-6 fill-current" />}>
              {t('kiosk.resume')}
            </Button>
          )}
          {state !== 'IDLE' && (
            <Button variant="danger" size="lg" className="h-20 text-xl" loading={busy === 'STOP'} onClick={() => void send('STOP')} icon={<Square className="size-5 fill-current" />}>
              {t('kiosk.stop')}
            </Button>
          )}
        </div>
      )}
      {state === 'PAUSED' && photoBlock}
      <p role="alert" className="min-h-6 text-center text-sm font-medium text-danger-text">
        {error}
      </p>
    </section>
  );
}

// ── Pantalla del quiosco ─────────────────────────────────────────────────

export function Kiosk() {
  const { t, i18n } = useTranslation();
  const lang = i18n.resolvedLanguage;
  const [info, setInfo] = useState<KioskInfo | null>(() => (kioskToken() ? cachedInfo() : null));
  const [paired, setPaired] = useState(() => !!kioskToken());
  const [step, setStep] = useState<Step>({ kind: 'home' });
  const [query, setQuery] = useState('');
  const [scanning, setScanning] = useState(false);
  const { pending, online } = useKioskOutbox();
  const now = useNow();
  useWakeLock();

  useEffect(() => {
    document.title = `${t('kiosk.title')} · HR-Core`;
  }, [t]);

  // Datos de la tablet (personas, si pide foto…), al abrir y cada pocos minutos.
  useEffect(() => {
    if (!paired) return;
    const stop = startKioskSync();
    const load = async (): Promise<void> => {
      try {
        const fresh = await kioskApi<KioskInfo>('/kiosk/info');
        saveInfo(fresh);
        setInfo(fresh);
      } catch (e) {
        if (e instanceof ApiError && e.code === 'KIOSK_INVALID') {
          forgetKiosk();
          setPaired(false);
          setInfo(null);
        }
      }
    };
    void load();
    const id = window.setInterval(() => void load(), 5 * 60_000);
    return () => {
      stop();
      window.clearInterval(id);
    };
  }, [paired]);

  // Vuelta a la lista: tras fichar, y si alguien se va a medias.
  useEffect(() => {
    if (step.kind === 'home') return;
    const ms = step.kind === 'done' ? DONE_MS : IDLE_MS;
    const timer = window.setTimeout(() => setStep({ kind: 'home' }), ms);
    const reset = (): void => {
      if (step.kind === 'done') return;
      window.clearTimeout(timer);
    };
    window.addEventListener('pointerdown', reset, { once: true });
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('pointerdown', reset);
    };
  }, [step]);

  const people = useMemo(() => {
    const q = query.trim().toLocaleLowerCase(lang).normalize('NFD').replace(/\p{Diacritic}/gu, '');
    const list = info?.people ?? [];
    if (!q) return list;
    return list.filter((p) => p.fullName.toLocaleLowerCase(lang).normalize('NFD').replace(/\p{Diacritic}/gu, '').includes(q));
  }, [info, query, lang]);

  if (!paired) {
    return (
      <Pairing
        onPaired={(i) => {
          setInfo(i);
          setPaired(true);
        }}
      />
    );
  }

  const card = (text: string): void => {
    setScanning(false);
    if (!text.startsWith(CARD_PREFIX)) {
      setStep({ kind: 'home' });
      window.alert(t('kiosk.cardInvalid'));
      return;
    }
    setStep({ kind: 'pin', who: { cardCode: text.slice(CARD_PREFIX.length), fullName: null } });
  };

  const back = (): void => {
    setQuery('');
    setStep({ kind: 'home' });
  };

  return (
    <div className="flex min-h-dvh flex-col bg-bg">
      <header className="edge-b flex items-center gap-3 bg-surface px-4 py-3 sm:px-6">
        <LogoMark className="size-9 shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="truncate font-bold">{info?.organizationName ?? t('kiosk.title')}</p>
          <p className="flex items-center gap-1.5 truncate text-sm text-fg-muted">
            <Tablet className="size-4 shrink-0" />
            {info ? [info.name, info.locationName].filter(Boolean).join(' · ') : '…'}
          </p>
        </div>
        {(!online || pending > 0) && (
          <Badge tone="warning">
            <CloudOff className="size-3" />
            {pending > 0 ? t('kiosk.pending', { count: pending }) : t('kiosk.offline')}
          </Badge>
        )}
        <div className="text-right">
          <p className="text-2xl leading-none font-bold tabular-nums" aria-live="off">
            {formatTime(now.toISOString(), lang)}
          </p>
          <p className="mt-1 text-xs text-fg-muted first-letter:uppercase">
            {new Intl.DateTimeFormat(lang, { weekday: 'long', day: 'numeric', month: 'long' }).format(now)}
          </p>
        </div>
      </header>

      <main className="flex-1 px-4 py-6 sm:px-6">
        {step.kind === 'home' && (
          <section aria-labelledby="who-title" className="mx-auto max-w-4xl space-y-4">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <h1 id="who-title" className="text-3xl font-bold tracking-tight">
                {t('kiosk.whoAreYou')}
              </h1>
              <Button variant="secondary" size="lg" onClick={() => setScanning(true)} icon={<CreditCard className="size-5" />}>
                {t('kiosk.scanCard')}
              </Button>
            </div>
            {!online && <p className="edge rounded-2xl bg-warning-soft px-4 py-3 text-sm font-medium text-warning-text">{t('kiosk.offlineHint')}</p>}
            <label className="edge flex h-14 items-center gap-3 rounded-control bg-surface px-4 focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-(--ring)">
              <Search className="size-5 shrink-0 text-fg-muted" />
              <span className="sr-only">{t('kiosk.search')}</span>
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t('kiosk.search')}
                className="h-full min-w-0 flex-1 bg-transparent text-lg outline-none"
                autoComplete="off"
              />
            </label>
            {people.length === 0 ? (
              <p className="py-8 text-center text-fg-muted">{t('kiosk.noPeople')}</p>
            ) : (
              <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                {people.map((p) => (
                  <li key={p.membershipId}>
                    <button
                      type="button"
                      onClick={() => setStep({ kind: 'pin', who: p })}
                      className="focus-ring edge flex w-full flex-col items-center gap-2 rounded-2xl bg-surface px-3 py-4 text-center transition-colors hover:bg-surface-2 active:scale-[0.98]"
                    >
                      <Avatar name={p.fullName} size="lg" />
                      <span className="line-clamp-2 font-semibold">{p.fullName}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}

        {step.kind === 'pin' && <PinPad who={step.who} onBack={back} onIdentified={(identity) => setStep({ kind: 'action', identity })} />}

        {step.kind === 'action' && info && (
          <Actions
            identity={step.identity}
            info={info}
            onBack={back}
            onDone={(done) => {
              setStep(done);
              void flushKiosk();
            }}
          />
        )}

        {step.kind === 'done' && (
          <section role="status" className="mx-auto flex max-w-md flex-col items-center gap-3 pt-10 text-center">
            <span className="flex size-24 items-center justify-center rounded-full bg-success-soft text-success-text">
              <CircleCheck className="size-14" />
            </span>
            <h2 className="text-3xl font-bold tracking-tight">{t(`kiosk.done_${step.action}`)}</h2>
            <p className="text-lg text-fg-muted">
              {step.fullName} · {t('kiosk.doneAt', { time: formatTime(step.at.toISOString(), lang) })}
            </p>
            {step.queued && <p className="edge rounded-2xl bg-warning-soft px-4 py-2 text-sm font-medium text-warning-text">{t('kiosk.doneQueued')}</p>}
            <Button size="lg" className="mt-4" onClick={back}>
              {t('kiosk.confirm')}
            </Button>
          </section>
        )}
      </main>

      {step.kind === 'home' && (
        <footer className="flex justify-center px-4 pb-4">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              if (!window.confirm(t('kiosk.unpairConfirm'))) return;
              forgetKiosk();
              setPaired(false);
              setInfo(null);
            }}
            icon={<Unplug className="size-4" />}
          >
            {t('kiosk.unpair')}
          </Button>
        </footer>
      )}

      <QrScanner open={scanning} onClose={() => setScanning(false)} onResult={card} title={t('kiosk.scanCard')} facing="user" />
    </div>
  );
}
