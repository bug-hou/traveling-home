import exifr from 'exifr';

export interface AutomaticLocation {
  latitude: number;
  longitude: number;
  source: 'exif' | 'srt';
}

export interface SelectedMedia {
  file: File;
  batchId: string;
}

const MAX_SRT_BYTES = 4 * 1024 * 1024;
const DECIMAL = '([+-]?(?:\\d+(?:\\.\\d+)?|\\.\\d+))';
const LATITUDE = new RegExp(`\\[latitude:\\s*${DECIMAL}\\s*\\]`, 'i');
const LONGITUDE = new RegExp(`\\[longitude:\\s*${DECIMAL}\\s*\\]`, 'i');
const GPS = new RegExp(`\\bGPS\\s*\\(\\s*${DECIMAL}\\s*,\\s*${DECIMAL}(?:\\s*,[^)]*)?\\s*\\)`, 'i');
const CUE = /^\s*\d+\s*\r?\n\s*\d{2}:\d{2}:\d{2}[,.]\d{3}\s*-->\s*\d{2}:\d{2}:\d{2}[,.]\d{3}[^\r\n]*\r?\n/gm;

function valid(latitude: number, longitude: number) {
  return Number.isFinite(latitude) && Number.isFinite(longitude)
    && latitude >= -90 && latitude <= 90 && longitude >= -180 && longitude <= 180;
}

function stem(name: string) {
  return name.replace(/\.[^.]+$/, '').toLowerCase();
}

export function isPhoto(file: File) {
  return /\.jpe?g$/i.test(file.name) && (!file.type || file.type === 'image/jpeg');
}

export function isVideo(file: File) {
  return /\.(mp4|mov)$/i.test(file.name) && (!file.type || file.type.startsWith('video/'));
}

export function matchingSidecar(video: SelectedMedia, items: readonly SelectedMedia[]): File | null {
  if (!isVideo(video.file)) return null;
  const sameName = items.filter((item) => item.batchId === video.batchId && stem(item.file.name) === stem(video.file.name));
  const videos = sameName.filter((item) => isVideo(item.file));
  const sidecars = sameName.filter((item) => /\.srt$/i.test(item.file.name));
  return videos.length === 1 && videos[0] === video && sidecars.length === 1 ? sidecars[0].file : null;
}

function coordinatesFromCue(cue: string): { latitude: number; longitude: number } | null {
  const latitude = LATITUDE.exec(cue);
  const longitude = LONGITUDE.exec(cue);
  const pair = latitude && longitude ? [Number(latitude[1]), Number(longitude[1])] : null;
  const gps = GPS.exec(cue);
  const values = pair ?? (gps ? [Number(gps[1]), Number(gps[2])] : null);
  return values && valid(values[0], values[1]) ? { latitude: values[0], longitude: values[1] } : null;
}

export function firstSrtCoordinate(text: string): { latitude: number; longitude: number } | null {
  const cues = [...text.matchAll(CUE)];
  for (let index = 0; index < cues.length; index += 1) {
    const start = (cues[index].index ?? 0) + cues[index][0].length;
    const end = index + 1 < cues.length ? cues[index + 1].index : text.length;
    const point = coordinatesFromCue(text.slice(start, end));
    if (point) return point;
  }
  return null;
}

export async function parseAutomaticLocation(media: SelectedMedia, items: readonly SelectedMedia[]): Promise<AutomaticLocation | null> {
  try {
    if (isPhoto(media.file)) {
      const point = await exifr.gps(media.file);
      if (point && valid(point.latitude, point.longitude)) {
        return { latitude: point.latitude, longitude: point.longitude, source: 'exif' };
      }
    } else if (isVideo(media.file)) {
      const sidecar = matchingSidecar(media, items);
      if (!sidecar || sidecar.size > MAX_SRT_BYTES) return null;
      const bytes = new Uint8Array(await sidecar.arrayBuffer());
      const utf16 = bytes[0] === 0xff && bytes[1] === 0xfe ? 'utf-16le' : bytes[0] === 0xfe && bytes[1] === 0xff ? 'utf-16be' : 'utf-8';
      const point = firstSrtCoordinate(new TextDecoder(utf16, { fatal: true }).decode(bytes));
      if (point) return { ...point, source: 'srt' };
    }
  } catch {
    // Metadata parsing must never block the original file upload.
  }
  return null;
}
