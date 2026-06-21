import { createRoot } from 'react-dom/client';
import { QRCodeCanvas } from 'qrcode.react';
import jsQR from 'jsqr';
import { buildShareUrl, readTrajectPresetFromUrl } from './src/components/Traject/trajectShare';

const settings = {
  mijnOpleidingKlasgroepen: ['2 TI A', '3 TI B — Systèmes', '1 EM C', '2 BI A', '3 CHE B'],
  semesterStart: '2026-02-09',
  semesterEind: '2026-06-26',
};
const url = buildShareUrl(settings);
// Round-trip the hash portion back through the real decoder as an extra sanity check.
const hash = url.slice(url.indexOf('#'));
const decoded = (() => {
  const orig = window.location.hash;
  window.history.replaceState(null, '', window.location.pathname + window.location.search + hash);
  const r = readTrajectPresetFromUrl();
  window.history.replaceState(null, '', window.location.pathname + window.location.search + orig);
  return r;
})();
const w = window as unknown as Record<string, unknown>;
w.__qrUrl = url;
w.__qrDecoded = decoded;

createRoot(document.getElementById('qrroot')!).render(
  <QRCodeCanvas value={url} size={240} level="L" marginSize={2} />
);

// After paint, read the rendered pixels back and decode the QR with jsQR to prove
// the generated image actually scans to the same URL.
setTimeout(() => {
  const canvas = document.querySelector('canvas') as HTMLCanvasElement;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const result = jsQR(img.data, img.width, img.height);
  w.__dec = {
    decodedSomething: !!result,
    value: result?.data ?? null,
    match: result?.data === url,
  };
}, 400);
