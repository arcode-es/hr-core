import type { LocationDto } from '@hr/shared';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { useEffect, useRef, type RefObject } from 'react';
import { cn } from '../lib/cn';

export interface LatLng {
  lat: number;
  lng: number;
}

const TILES: string = import.meta.env.VITE_MAP_TILES_URL ?? 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const SPAIN: L.LatLngBoundsExpression = [
  [35.9, -9.5],
  [43.9, 3.4],
];

/** Chincheta SVG propia: evita los iconos PNG de Leaflet, que no sobreviven al empaquetado. */
const pin = (color: string, dimmed = false): L.DivIcon =>
  L.divIcon({
    className: 'map-pin',
    iconSize: [34, 44],
    iconAnchor: [17, 42],
    html: `<svg viewBox="0 0 34 44" width="34" height="44" opacity="${dimmed ? 0.45 : 1}"><path d="M17 1C8.2 1 1 8 1 16.7 1 28.4 17 43 17 43s16-14.6 16-26.3C33 8 25.8 1 17 1Z" fill="${color}" stroke="#fff" stroke-width="2"/><circle cx="17" cy="16.5" r="5.5" fill="#fff"/></svg>`,
  });

const circleStyle = (color: string): L.CircleMarkerOptions => ({
  color,
  weight: 2,
  fillColor: color,
  fillOpacity: 0.16,
});

function useLeaflet(container: RefObject<HTMLDivElement | null>): RefObject<L.Map | null> {
  const map = useRef<L.Map | null>(null);
  useEffect(() => {
    const host = container.current;
    if (!host) return;
    // El mapa vive en un nodo propio: al desmontar se retira al instante de la página,
    // pero Leaflet se destruye cuando sus animaciones han terminado (destruirlo a
    // mitad de un zoom lanza errores internos).
    const node = document.createElement('div');
    node.style.cssText = 'width:100%;height:100%';
    host.appendChild(node);
    const m = L.map(node, { zoomControl: false, attributionControl: true }).fitBounds(SPAIN);
    L.control.zoom({ position: 'bottomleft' }).addTo(m);
    L.tileLayer(TILES, { maxZoom: 19, attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' }).addTo(m);
    // El contenedor puede cambiar de tamaño (rotación, hojas, columnas): Leaflet necesita saberlo.
    const ro = new ResizeObserver(() => m.invalidateSize());
    ro.observe(host);
    map.current = m;
    return () => {
      ro.disconnect();
      map.current = null;
      m.off();
      m.stop();
      node.remove();
      setTimeout(() => m.remove(), 1000);
    };
  }, [container]);
  return map;
}

interface EditorProps {
  value: LatLng | null;
  radius: number;
  color: string;
  onChange: (p: LatLng) => void;
  label: string;
  className?: string;
}

/** Mapa de edición: tocar o arrastrar la chincheta mueve el centro; el círculo es la geocerca. */
export function GeofenceEditorMap({ value, radius, color, onChange, label, className }: EditorProps) {
  const el = useRef<HTMLDivElement>(null);
  const map = useLeaflet(el);
  const marker = useRef<L.Marker | null>(null);
  const circle = useRef<L.Circle | null>(null);
  const owner = useRef<L.Map | null>(null);
  const emit = useRef(onChange);
  emit.current = onChange;

  useEffect(() => {
    const m = map.current;
    if (!m) return;
    const onClick = (e: L.LeafletMouseEvent): void => emit.current({ lat: e.latlng.lat, lng: e.latlng.lng });
    m.on('click', onClick);
    return () => void m.off('click', onClick);
  }, [map]);

  useEffect(() => {
    const m = map.current;
    if (!m) return;
    // Si el mapa se ha recreado, las capas anteriores pertenecen a uno ya destruido.
    if (owner.current !== m) {
      owner.current = m;
      marker.current = circle.current = null;
    }
    if (!value) {
      marker.current?.remove();
      circle.current?.remove();
      marker.current = circle.current = null;
      return;
    }
    const at: L.LatLngExpression = [value.lat, value.lng];
    if (!marker.current) {
      marker.current = L.marker(at, { draggable: true, icon: pin(color), keyboard: false }).addTo(m);
      marker.current.on('drag', () => circle.current?.setLatLng(marker.current!.getLatLng()));
      marker.current.on('dragend', () => {
        const p = marker.current!.getLatLng();
        emit.current({ lat: p.lat, lng: p.lng });
      });
      circle.current = L.circle(at, { radius, interactive: false, ...circleStyle(color) }).addTo(m);
    }
    marker.current.setLatLng(at).setIcon(pin(color));
    circle.current!.setLatLng(at).setRadius(radius).setStyle(circleStyle(color));
    // Mantiene el perímetro completo a la vista al mover el punto o cambiar el radio.
    m.fitBounds(circle.current!.getBounds(), { padding: [48, 48], maxZoom: 18, animate: true, duration: 0.35 });
  }, [map, value, radius, color]);

  return <div ref={el} role="application" aria-label={label} className={cn('h-full w-full', className)} />;
}

interface OverviewProps {
  locations: LocationDto[];
  onSelect?: (id: string) => void;
  label: string;
  className?: string;
}

/** Mapa de conjunto: todas las geocercas del espacio de un vistazo. */
export function LocationsOverviewMap({ locations, onSelect, label, className }: OverviewProps) {
  const el = useRef<HTMLDivElement>(null);
  const map = useLeaflet(el);
  const select = useRef(onSelect);
  select.current = onSelect;

  useEffect(() => {
    const m = map.current;
    if (!m) return;
    const group = L.featureGroup().addTo(m);
    for (const l of locations) {
      const at: L.LatLngExpression = [l.latitude, l.longitude];
      L.circle(at, { radius: l.geofenceRadiusMeters, interactive: false, ...circleStyle(l.color), opacity: l.isActive ? 1 : 0.4 }).addTo(group);
      L.marker(at, { icon: pin(l.color, !l.isActive), title: l.name, alt: l.name })
        .on('click', () => select.current?.(l.id))
        .addTo(group);
    }
    if (locations.length) m.fitBounds(group.getBounds(), { padding: [40, 40], maxZoom: 16 });
    return () => void group.remove();
  }, [map, locations]);

  return <div ref={el} role="application" aria-label={label} className={cn('h-full w-full', className)} />;
}
