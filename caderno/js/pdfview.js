import * as pdfjs from "../vendor/pdfjs/pdf.min.mjs";

pdfjs.GlobalWorkerOptions.workerSrc = new URL("../vendor/pdfjs/pdf.worker.min.mjs", import.meta.url).href;

const standardFontDataUrl = new URL("../vendor/pdfjs/standard_fonts/", import.meta.url).href;

let open = null;
let ticket = 0;

/**
 * Inspeciona os bytes de um arquivo PDF com o PDF.js e retorna o resultado discriminado.
 *
 * @param {Uint8Array} bytes
 * @returns {Promise<{ ok: true, pageCount: number, doc: any } | { ok: false, error: string, message: string }>}
 */
export async function inspectPdf(bytes) {
  if (!bytes || bytes.byteLength === 0) {
    return { ok: false, error: "MISSING_BYTES", message: "Arquivo PDF vazio ou bytes ausentes." };
  }
  try {
    const copy = bytes.slice(0);
    const loadingTask = pdfjs.getDocument({ data: copy, standardFontDataUrl });
    const doc = await loadingTask.promise;
    return { ok: true, pageCount: doc.numPages, doc };
  } catch (err) {
    const errStr = String(err?.name || "") + " " + String(err?.message || "");
    if (err?.name === "PasswordException" || /password/i.test(errStr)) {
      return { ok: false, error: "PASSWORD_REQUIRED", message: "PDF protegido por senha." };
    }
    if (err?.name === "InvalidPDFException" || /invalid|format/i.test(errStr)) {
      return { ok: false, error: "INVALID_PDF", message: "Arquivo PDF inválido ou corrompido." };
    }
    return { ok: false, error: "LOAD_FAILED", message: err?.message || "Falha ao abrir PDF." };
  }
}

/**
 * Fecha e libera a memória do documento PDF ativo em cache.
 *
 * @param {string} [documentId]
 */
export function releasePdf(documentId) {
  if (!open || (documentId && open.documentId !== documentId)) return;
  try {
    open.doc.destroy();
  } catch {
    /* ignore */
  }
  open = null;
}

/**
 * Renderiza uma página física do PDF em um canvas com fundo branco garantido.
 *
 * @param {HTMLCanvasElement} canvas
 * @param {string} documentId
 * @param {Uint8Array} bytes
 * @param {number} physicalPage
 * @returns {Promise<{ ok: true, pageNumber: number, pageCount: number, width: number, height: number } | { ok: false, error: string, message: string, requested?: number, total?: number }>}
 */
export async function paintPdf(canvas, documentId, bytes, physicalPage = 1) {
  const token = ++ticket;
  if (!canvas) {
    return { ok: false, error: "CANVAS_MISSING", message: "Elemento canvas não encontrado." };
  }
  if (!bytes || bytes.byteLength === 0) {
    return { ok: false, error: "MISSING_BYTES", message: "Arquivo PDF vazio ou bytes ausentes." };
  }

  let doc;
  try {
    doc = await documentFor(documentId, bytes);
  } catch (err) {
    const errStr = String(err?.name || "") + " " + String(err?.message || "");
    if (err?.name === "PasswordException" || /password/i.test(errStr)) {
      return { ok: false, error: "PASSWORD_REQUIRED", message: "PDF protegido por senha." };
    }
    if (err?.name === "InvalidPDFException" || /invalid|format/i.test(errStr)) {
      return { ok: false, error: "INVALID_PDF", message: "Arquivo PDF inválido ou corrompido." };
    }
    return { ok: false, error: "LOAD_FAILED", message: err?.message || "Falha ao abrir o documento." };
  }

  if (token !== ticket || !canvas.isConnected) {
    return { ok: false, error: "CANCELLED", message: "Renderização cancelada." };
  }

  const totalPages = doc.numPages;
  const pageNum = Number(physicalPage) || 1;
  if (pageNum < 1 || pageNum > totalPages) {
    return {
      ok: false,
      error: "PAGE_OUT_OF_RANGE",
      requested: pageNum,
      total: totalPages,
      message: "Página solicitada fora do intervalo do documento.",
    };
  }

  let page;
  try {
    page = await doc.getPage(pageNum);
  } catch (err) {
    return { ok: false, error: "PAGE_LOAD_FAILED", message: err?.message || "Falha ao carregar página do PDF." };
  }

  if (token !== ticket || !canvas.isConnected) {
    return { ok: false, error: "CANCELLED", message: "Renderização cancelada." };
  }

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

  const ctx = canvas.getContext("2d");
  if (ctx) {
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  await page.render({ canvas, viewport }).promise;

  return {
    ok: true,
    pageNumber: pageNum,
    pageCount: totalPages,
    width: canvas.width,
    height: canvas.height,
  };
}

async function documentFor(documentId, bytes) {
  const signature = `${bytes.byteLength}:${bytes[0] || 0}:${bytes[bytes.length - 1] || 0}`;
  if (open && open.documentId === documentId && open.signature === signature) {
    return open.doc;
  }
  if (open) {
    try {
      open.doc.destroy();
    } catch {
      /* ignore */
    }
  }
  const copy = bytes.slice(0);
  const loadingTask = pdfjs.getDocument({ data: copy, standardFontDataUrl });
  const doc = await loadingTask.promise;
  open = { documentId, signature, doc };
  return doc;
}