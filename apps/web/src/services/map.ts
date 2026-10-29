import { apiRequest } from './api';
import type { NodeLocation } from './nodes';

export interface MapFile {
  id: string;
  parentId: string | null;
  name: string;
  mime: string | null;
  size: number;
  uploadedAt: string | null;
}

export interface MapPoint extends MapFile {
  location: Omit<NodeLocation, 'source'> & { source: NodeLocation['source'] | null };
  mapLocation?: { latitude: number; longitude: number };
}

export interface MapPage<T> {
  items: T[];
  total: number;
  offset: number;
  limit: number;
}

export interface PointPage extends MapPage<MapPoint> {
  mapStatus: 'ready' | 'not_configured' | 'unavailable';
}

const PAGE_SIZE = 100;
const MAX_OFFSET = 100_000;

export const mapApi = {
  points(offset = 0, signal?: AbortSignal) {
    return apiRequest<PointPage>(`/api/v1/map/points?offset=${offset}&limit=${PAGE_SIZE}`, { signal });
  },
  unlocated(offset = 0, signal?: AbortSignal) {
    return apiRequest<MapPage<MapFile>>(`/api/v1/map/unlocated?offset=${offset}&limit=${PAGE_SIZE}`, { signal });
  },
  async allPoints(signal?: AbortSignal): Promise<{ points: MapPoint[]; total: number; mapStatus: PointPage['mapStatus']; truncated: boolean }> {
    const points: MapPoint[] = [];
    const seen = new Set<string>();
    let offset = 0;
    let total = 0;
    let mapStatus: PointPage['mapStatus'] = 'ready';
    while (offset <= MAX_OFFSET) {
      const page = await mapApi.points(offset, signal);
      total = page.total;
      if (page.mapStatus !== 'ready') mapStatus = page.mapStatus;
      for (const point of page.items) {
        if (!seen.has(point.id)) { seen.add(point.id); points.push(point); }
      }
      if (page.items.length === 0 || offset + page.items.length >= total) break;
      offset += page.items.length;
    }
    return { points, total, mapStatus, truncated: offset > MAX_OFFSET && points.length < total };
  },
};

export function pointLabel(point: MapPoint) {
  return (typeof point.location.placeName === 'string' ? point.location.placeName.trim() : '') || `${point.location.latitude.toFixed(4)}°, ${point.location.longitude.toFixed(4)}°`;
}
