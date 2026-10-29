import { env } from '@/config/env';
import type { MapPoint } from './map';

type LatLng = { lat: number; lng: number };
interface MapInstance {
  setCenter(position: LatLng): void;
  setZoom(zoom: number): void;
  fitBounds(bounds: unknown): void;
  destroy(): void;
}
interface MarkerLayer {
  on(event: 'click', listener: (event: { geometry?: { id: string } }) => void): void;
  setMap(map: null): void;
}
interface MapSdk {
  LatLng: new (latitude: number, longitude: number) => LatLng;
  LatLngBounds: new () => { extend(position: LatLng): void };
  Map: new (element: HTMLElement, options: { center: LatLng; zoom: number }) => MapInstance;
  MarkerStyle: new (options: { width: number; height: number; anchor: { x: number; y: number }; src: string }) => unknown;
  MultiMarker: new (options: { map: MapInstance; styles: Record<string, unknown>; geometries: Array<{ id: string; styleId: string; position: LatLng }> }) => MarkerLayer;
}

declare global { interface Window { TMap?: MapSdk } }

let sdkPromise: Promise<MapSdk> | null = null;
const markerSvg = '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="42" viewBox="0 0 32 42"><path d="M16 2C8 2 2 8 2 16c0 11 14 24 14 24s14-13 14-24C30 8 24 2 16 2Z" fill="#267d70" stroke="white" stroke-width="2"/><circle cx="16" cy="16" r="5" fill="white"/></svg>';

export function loadTencentMap() {
  if (!env.tencentMapKey.trim()) return Promise.reject(new Error('尚未配置腾讯地图前端 Key，地图暂不可用'));
  if (window.TMap) return Promise.resolve(window.TMap);
  if (sdkPromise) return sdkPromise;
  sdkPromise = new Promise<MapSdk>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = `https://map.qq.com/api/gljs?v=1.exp&key=${encodeURIComponent(env.tencentMapKey.trim())}`;
    script.async = true;
    const timer = window.setTimeout(() => { script.remove(); reject(new Error('地图服务加载超时，请重试')); }, 12000);
    script.onload = () => {
      window.clearTimeout(timer);
      if (window.TMap) resolve(window.TMap);
      else reject(new Error('地图服务加载失败，请重试'));
    };
    script.onerror = () => { window.clearTimeout(timer); script.remove(); reject(new Error('地图服务加载失败，请重试')); };
    document.head.append(script);
  }).catch((error: unknown) => { sdkPromise = null; throw error; });
  return sdkPromise;
}

function toPosition(sdk: MapSdk, point: MapPoint) {
  const position = point.mapLocation;
  if (!position || !Number.isFinite(position.latitude) || !Number.isFinite(position.longitude)) return null;
  return new sdk.LatLng(position.latitude, position.longitude);
}

export function focusMapPoint(map: MapInstance, sdk: MapSdk, point: MapPoint) {
  const position = toPosition(sdk, point);
  if (!position) return false;
  map.setCenter(position);
  map.setZoom(12);
  return true;
}

export function fitMapPoints(map: MapInstance, sdk: MapSdk, points: MapPoint[]) {
  const positions = points.map((point) => toPosition(sdk, point)).filter((item): item is LatLng => item !== null);
  if (!positions.length) return false;
  if (positions.length === 1) { map.setCenter(positions[0]); map.setZoom(11); return true; }
  const bounds = new sdk.LatLngBounds();
  positions.forEach((position) => bounds.extend(position));
  map.fitBounds(bounds);
  return true;
}

export function createMap(element: HTMLElement, sdk: MapSdk, points: MapPoint[], select: (id: string) => void) {
  const first = toPosition(sdk, points[0]);
  if (!first) throw new Error('没有可绘制的地图点位');
  const map = new sdk.Map(element, { center: first, zoom: 5 });
  const valid = points.filter((point) => toPosition(sdk, point));
  const layer = new sdk.MultiMarker({
    map,
    styles: { footprint: new sdk.MarkerStyle({ width: 32, height: 42, anchor: { x: 16, y: 40 }, src: `data:image/svg+xml,${encodeURIComponent(markerSvg)}` }) },
    geometries: valid.map((point) => ({ id: point.id, styleId: 'footprint', position: toPosition(sdk, point)! })),
  });
  const ids = new Set(valid.map((point) => point.id));
  layer.on('click', (event) => { if (event.geometry && ids.has(event.geometry.id)) select(event.geometry.id); });
  fitMapPoints(map, sdk, points);
  return { map, destroy: () => { layer.setMap(null); map.destroy(); } };
}
