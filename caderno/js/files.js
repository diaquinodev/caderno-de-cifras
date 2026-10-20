const DB_NAME = "caderno-files";
const STORE = "pdfs";

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function done(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

export function countPdfPages(bytes) {
  const text = new TextDecoder("latin1").decode(bytes);
  const marks = text.match(/\/Type\s*\/Page(?!s)/g);
  return Math.max(1, Math.min(200, marks?.length || 1));
}

/**
 * Salva um registro de PDF no IndexedDB por documentId.
 *
 * @param {string} documentId
 * @param {{ name: string, pageCount?: number, pages?: number, buffer: ArrayBuffer, createdAt?: string }} record
 */
export async function savePdfDocument(documentId, record) {
  if (!documentId || !record?.buffer) {
    throw new Error("documentId e buffer sao obrigatorios para salvar PDF");
  }
  const db = await openDb();
  const tx = db.transaction(STORE, "readwrite");
  const payload = {
    name: String(record.name || "documento.pdf"),
    pageCount: Number(record.pageCount ?? record.pages ?? 1),
    buffer: record.buffer,
    createdAt: record.createdAt || new Date().toISOString(),
  };
  tx.objectStore(STORE).put(payload, documentId);
  await done(tx);
  db.close();
  return payload;
}

/**
 * Carrega um registro de PDF do IndexedDB por documentId.
 *
 * @param {string} documentId
 * @returns {Promise<{ name: string, pageCount: number, buffer: ArrayBuffer, createdAt?: string } | null>}
 */
export async function loadPdfDocument(documentId) {
  if (!documentId) return null;
  const db = await openDb();
  const tx = db.transaction(STORE, "readonly");
  const request = tx.objectStore(STORE).get(documentId);
  const record = await new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error);
  });
  await done(tx);
  db.close();
  if (!record) return null;
  return {
    name: String(record.name || "documento.pdf"),
    pageCount: Number(record.pageCount ?? record.pages ?? 1),
    buffer: record.buffer,
    createdAt: record.createdAt || undefined,
  };
}

/**
 * Exclui um PDF do IndexedDB por documentId.
 *
 * @param {string} documentId
 */
export async function deletePdfDocument(documentId) {
  if (!documentId) return;
  const db = await openDb();
  const tx = db.transaction(STORE, "readwrite");
  tx.objectStore(STORE).delete(documentId);
  await done(tx);
  db.close();
}

/**
 * Conta a quantidade de registros no armazenamento IndexedDB.
 *
 * @returns {Promise<number>}
 */
export async function countStoredPdfRecords() {
  const db = await openDb();
  const tx = db.transaction(STORE, "readonly");
  const request = tx.objectStore(STORE).count();
  const count = await new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  await done(tx);
  db.close();
  return count;
}

// Aliases para compatibilidade legada
export async function savePdf(id, file) {
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  const pages = countPdfPages(bytes);
  await savePdfDocument(id, { name: file.name, pageCount: pages, buffer });
  return { name: file.name, pages };
}

export async function savePdfRecord(id, record) {
  return savePdfDocument(id, record);
}

export async function loadPdf(id) {
  return loadPdfDocument(id);
}

export async function copyPdf(fromId, toId) {
  const record = await loadPdfDocument(fromId);
  if (record) await savePdfDocument(toId, record);
}

export async function deletePdf(id) {
  return deletePdfDocument(id);
}

export function bufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let index = 0; index < bytes.length; index += 1) binary += String.fromCharCode(bytes[index]);
  return btoa(binary);
}

export function base64ToBuffer(data) {
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes.buffer;
}