import * as pdfjs from "../vendor/pdfjs/pdf.min.mjs";

pdfjs.GlobalWorkerOptions.workerSrc = new URL("../vendor/pdfjs/pdf.worker.min.mjs", import.meta.url).href;

const standardFontDataUrl = new URL("../vendor/pdfjs/standard_fonts/", import.meta.url).href;

let open = null;
let ticket = 0;

export function releasePdf(songId) {
  if (!open || (songId && open.songId !== songId)) return;
  open.doc.destroy();
  open = null;
}

export async function paintPdf(canvas, songId, bytes, pageNumber) {
  const token = ++ticket;
  const doc = await documentFor(songId, bytes);
  if (token !== ticket || !canvas.isConnected) return;
  const page = await doc.getPage(pageNumber);
  if (token !== ticket || !canvas.isConnected) return;
  const host = canvas.parentElement;
  const maxW = Math.max(240, (host?.clientWidth || 320) - 16);
  const maxH = Math.max(240, (host?.clientHeight || 480) - 64);
  const base = page.getViewport({ scale: 1 });
  const scale = Math.min(maxW / base.width, maxH / base.height);
  const dpr = window.devicePixelRatio || 1;
  const viewport = page.getViewport({ scale: scale * dpr });
  canvas.width = Math.floor(viewport.width);
  canvas.height = Math.floor(viewport.height);
  canvas.style.width = `${Math.floor(viewport.width / dpr)}px`;
  canvas.style.height = `${Math.floor(viewport.height / dpr)}px`;
  await page.render({ canvas, viewport }).promise;
}

async function documentFor(songId, bytes) {
  const signature = `${bytes.byteLength}:${bytes[0] || 0}:${bytes[bytes.length - 1] || 0}`;
  if (open && open.songId === songId && open.signature === signature) return open.doc;
  if (open) open.doc.destroy();
  const copy = bytes.slice(0);
  const doc = await pdfjs.getDocument({ data: copy, standardFontDataUrl }).promise;
  open = { songId, signature, doc };
  return doc;
}
