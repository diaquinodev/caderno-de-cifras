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

export async function savePdf(songId, file) {
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  const pages = countPdfPages(bytes);
  const db = await openDb();
  const tx = db.transaction(STORE, "readwrite");
  tx.objectStore(STORE).put({ name: file.name, pages, buffer }, songId);
  await done(tx);
  db.close();
  return { name: file.name, pages };
}

export async function savePdfRecord(songId, record) {
  const db = await openDb();
  const tx = db.transaction(STORE, "readwrite");
  tx.objectStore(STORE).put(record, songId);
  await done(tx);
  db.close();
}

export async function loadPdf(songId) {
  const db = await openDb();
  const tx = db.transaction(STORE, "readonly");
  const request = tx.objectStore(STORE).get(songId);
  const record = await new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error);
  });
  await done(tx);
  db.close();
  return record;
}

export async function copyPdf(fromId, toId) {
  const record = await loadPdf(fromId);
  if (record) await savePdfRecord(toId, record);
}

export async function deletePdf(songId) {
  const db = await openDb();
  const tx = db.transaction(STORE, "readwrite");
  tx.objectStore(STORE).delete(songId);
  await done(tx);
  db.close();
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
