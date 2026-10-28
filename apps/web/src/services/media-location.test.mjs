import assert from 'node:assert/strict';
import test from 'node:test';
import exifr from 'exifr';
import { firstSrtCoordinate, matchingSidecar, parseAutomaticLocation } from './media-location.ts';

globalThis.FileReader ??= class {
  readAsArrayBuffer(blob) {
    blob.arrayBuffer().then((result) => {
      this.result = result;
      this.onloadend?.();
    }).catch((error) => this.onerror?.(error));
  }
};

const cue = (index, telemetry) => `${index}\n00:00:0${index},000 --> 00:00:0${index},999\n${telemetry}\n\n`;
const media = (file, batchId = 'batch-1') => ({ file, batchId });
const file = (name, content = '', type = '') => new File([content], name, { type });

function jpegWithGps() {
  const tiff = Buffer.alloc(128);
  tiff.write('II', 0);
  tiff.writeUInt16LE(42, 2);
  tiff.writeUInt32LE(8, 4);
  tiff.writeUInt16LE(1, 8);
  tiff.writeUInt16LE(0x8825, 10);
  tiff.writeUInt16LE(4, 12);
  tiff.writeUInt32LE(1, 14);
  tiff.writeUInt32LE(26, 18);
  tiff.writeUInt16LE(4, 26);
  for (const [index, tag, type, count, value] of [
    [0, 1, 2, 2, null], [1, 2, 5, 3, 80], [2, 3, 2, 2, null], [3, 4, 5, 3, 104],
  ]) {
    const offset = 28 + index * 12;
    tiff.writeUInt16LE(tag, offset);
    tiff.writeUInt16LE(type, offset + 2);
    tiff.writeUInt32LE(count, offset + 4);
    if (value !== null) tiff.writeUInt32LE(value, offset + 8);
  }
  tiff.write('N\0', 36);
  tiff.write('W\0', 60);
  for (const [start, degrees, minutes] of [[80, 35, 30], [104, 120, 15]]) {
    for (const [index, numerator] of [degrees, minutes, 0].entries()) {
      tiff.writeUInt32LE(numerator, start + index * 8);
      tiff.writeUInt32LE(1, start + index * 8 + 4);
    }
  }
  const app1 = Buffer.concat([Buffer.from('Exif\0\0'), tiff]);
  const header = Buffer.alloc(4);
  header.writeUInt16BE(0xffe1, 0);
  header.writeUInt16BE(app1.length + 2, 2);
  return Buffer.concat([Buffer.from([0xff, 0xd8]), header, app1, Buffer.from([0xff, 0xd9])]);
}

test('synthetic JPEG EXIF GPS is read locally and JPEG without GPS falls back', async () => {
  const photo = media(file('view.JpG', jpegWithGps(), 'image/jpeg'));
  assert.deepEqual(await exifr.gps(photo.file), { latitude: 35.5, longitude: -120.25 });
  assert.deepEqual(await parseAutomaticLocation(photo, [photo]), { latitude: 35.5, longitude: -120.25, source: 'exif' });
  const empty = media(file('empty.jpeg', Buffer.from([0xff, 0xd8, 0xff, 0xd9]), 'image/jpeg'));
  assert.equal(await parseAutomaticLocation(empty, [empty]), null);
  const unsupported = media(file('photo.heic', jpegWithGps(), 'image/heic'));
  assert.equal(await parseAutomaticLocation(unsupported, [unsupported]), null);
});

test('SRT bracket GPS, HTML-wrapped GPS and GPS(...) formats take the first valid frame, never HOME', () => {
  const frames = cue(1, 'HOME(35.1,119.2,0)')
    + cue(2, '[latitude: 100.5] [longitude: 120.3]')
    + cue(3, '<font size="28">[latitude: -3.5] [longitude: 116.391305] [rel_alt: 2.0]</font>')
    + cue(4, '[latitude: 40.1] [longitude: 120.1]');
  assert.deepEqual(firstSrtCoordinate(frames), { latitude: -3.5, longitude: 116.391305 });
  assert.deepEqual(firstSrtCoordinate(cue(1, 'GPS (39.906217, -6.1120, 69.8M) HOME(42,10,0)')), { latitude: 39.906217, longitude: -6.112 });
  assert.deepEqual(firstSrtCoordinate(cue(1, 'GPS(22.1,113.2,50) BAROMETER(1)')), { latitude: 22.1, longitude: 113.2 });
  assert.equal(firstSrtCoordinate(cue(1, 'HOME(22,113,1)')), null);
  assert.equal(firstSrtCoordinate('GPS(22,113,1)'), null);
  assert.equal(firstSrtCoordinate(cue(1, 'GPS(22,181,1)')), null);
});

test('a unique video and SRT in the same selection use only their own coordinates', async () => {
  const videoA = media(file('DJI_001.MP4', '', 'video/mp4'));
  const srtA = media(file('dji_001.sRt', cue(1, '[latitude: 21] [longitude: 111]')));
  const videoB = media(file('DJI_002.mov', '', 'video/quicktime'));
  const srtB = media(file('DJI_002.SRT', cue(1, 'GPS(33,122,1)')));
  const batch = [videoA, srtA, videoB, srtB];
  const queueItemA = { ...videoA, id: 'queue-A' };
  const queueItemB = { ...videoB, id: 'queue-B' };
  assert.equal(matchingSidecar(queueItemA, batch), srtA.file);
  assert.deepEqual(await parseAutomaticLocation(queueItemA, batch), { latitude: 21, longitude: 111, source: 'srt' });
  assert.deepEqual(await parseAutomaticLocation(queueItemB, batch), { latitude: 33, longitude: 122, source: 'srt' });
});

test('duplicates, other selections, missing SRT, invalid SRT and corrupt text cannot mislocate a video', async () => {
  const video = media(file('clip.MP4', '', 'video/mp4'));
  const srt = media(file('clip.SRT', cue(1, 'GPS(30,120,1)')));
  assert.equal(matchingSidecar(video, [video, media(srt.file, 'other-selection')]), null);
  assert.equal(matchingSidecar(video, [video]), null);
  assert.equal(matchingSidecar(video, [video, srt, media(file('clip.MOV', '', 'video/quicktime'))]), null);
  assert.equal(matchingSidecar(video, [video, srt, media(file('CLIP.srt', cue(1, 'GPS(40,100,1)')))]), null);
  assert.equal(await parseAutomaticLocation(video, [video, srt, media(file('CLIP.srt', cue(1, 'GPS(40,100,1)')))]), null);
  assert.equal(await parseAutomaticLocation(video, [video, media(file('clip.srt', cue(1, 'GPS(91,120,1)')))]), null);
  assert.equal(await parseAutomaticLocation(video, [video, media(file('clip.srt', Uint8Array.from([0xc3, 0x28])))]), null);
});

test('UTF-16 BOM DJI SRT can locate; oversized sidecar safely falls back', async () => {
  const video = media(file('clip.mp4', '', 'video/mp4'));
  const utf16 = file('clip.srt', Buffer.from(`\ufeff${cue(1, '[latitude: 0] [longitude: -70]')}`, 'utf16le'));
  assert.deepEqual(await parseAutomaticLocation(video, [video, media(utf16)]), { latitude: 0, longitude: -70, source: 'srt' });
  assert.equal(await parseAutomaticLocation(video, [video, media(file('clip.srt', new Uint8Array(4 * 1024 * 1024 + 1)))]), null);
});
