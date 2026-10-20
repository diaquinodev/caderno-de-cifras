import { uid, normalizeLibrary } from "./store.js";
import { bufferToBase64, base64ToBuffer } from "./files.js";

/**
 * Creates a clean BackupV2 object containing the normalized library
 * and an array of unique PDF documents with their base64 binary data.
 * Guarantees that each PDF binary is exported exactly once.
 *
 * @param {import('./store.js').Library} library
 * @param {(documentId: string) => Promise<{ name?: string, pageCount?: number, buffer?: ArrayBuffer } | null>} loadPdfRecord
 * @returns {Promise<{ version: 2, library: import('./store.js').Library, pdfDocuments: Array<{ id: string, name: string, pageCount: number, data: string }> }>}
 */
export async function createBackupV2(library, loadPdfRecord) {
  const normLib = normalizeLibrary(library);

  // Collect all unique document IDs referenced in pdfDocuments or songs
  const docIdsToExport = new Set();
  for (const doc of normLib.pdfDocuments || []) {
    if (doc?.id) docIdsToExport.add(doc.id);
  }
  for (const song of normLib.songs || []) {
    if (song?.pdfRef?.documentId) {
      docIdsToExport.add(song.pdfRef.documentId);
    }
  }

  const pdfDocuments = [];
  for (const docId of docIdsToExport) {
    try {
      const record = await loadPdfRecord(docId);
      if (record?.buffer) {
        const docMeta = normLib.pdfDocuments.find((d) => d.id === docId);
        const name = record.name || docMeta?.name || "documento.pdf";
        const pageCount = Number(record.pageCount || docMeta?.pageCount || 1);
        const data = bufferToBase64(record.buffer);
        pdfDocuments.push({
          id: docId,
          name,
          pageCount,
          data,
        });
      }
    } catch {
      // If a document fails to load, it will simply be omitted from binary exports
    }
  }

  return {
    version: 2,
    library: normLib,
    pdfDocuments,
  };
}

/**
 * Parses and normalizes incoming backup data (v1 or v2).
 * Handles both BackupV2 shape and legacy flattened shape.
 *
 * @param {any} raw
 * @returns {{ library: import('./store.js').Library, rawPdfs: Array<{ id: string, name?: string, pageCount?: number, data?: string }> }}
 */
export function parseBackupData(raw) {
  const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
  if (!parsed || typeof parsed !== "object") {
    throw new Error("Arquivo de backup inválido.");
  }

  // Identify library source
  let rawLib;
  if (parsed.library && typeof parsed.library === "object") {
    rawLib = parsed.library;
  } else {
    rawLib = parsed;
  }
  const library = normalizeLibrary(rawLib);

  // Extract PDF entries from either pdfDocuments array or pdfs map/object
  const rawPdfs = [];
  const seenIds = new Set();

  if (Array.isArray(parsed.pdfDocuments)) {
    for (const item of parsed.pdfDocuments) {
      if (item?.id && !seenIds.has(item.id)) {
        seenIds.add(item.id);
        rawPdfs.push(item);
      }
    }
  }

  if (parsed.pdfs && typeof parsed.pdfs === "object") {
    for (const [id, val] of Object.entries(parsed.pdfs)) {
      if (id && val && !seenIds.has(id)) {
        seenIds.add(id);
        rawPdfs.push({
          id,
          name: val.name,
          pageCount: val.pageCount ?? val.pages,
          data: val.data,
        });
      }
    }
  }

  return { library, rawPdfs };
}

/**
 * Resolves ID collisions when merging an incoming library into a current library.
 * Generates fresh UIDs for incoming items whose IDs already exist in the current library,
 * updating all internal references (pdfRef, playlist.songIds, setlist.items[].songId)
 * and building a mapping for PDF document IDs.
 *
 * @param {import('./store.js').Library} current
 * @param {import('./store.js').Library} incoming
 * @returns {{
 *   mergedLibrary: import('./store.js').Library,
 *   docIdMap: Map<string, string>,
 *   songIdMap: Map<string, string>
 * }}
 */
export function mergeLibrariesWithRemap(current, incoming) {
  const currentNorm = normalizeLibrary(current);
  const incomingNorm = normalizeLibrary(incoming);

  const existingDocIds = new Set(currentNorm.pdfDocuments.map((d) => d.id));
  const existingSongIds = new Set(currentNorm.songs.map((s) => s.id));
  const existingPlaylistIds = new Set(currentNorm.playlists.map((p) => p.id));
  const existingSetlistIds = new Set(currentNorm.setlists.map((s) => s.id));

  const docIdMap = new Map();
  for (const doc of incomingNorm.pdfDocuments) {
    if (existingDocIds.has(doc.id)) {
      docIdMap.set(doc.id, uid());
    } else {
      docIdMap.set(doc.id, doc.id);
    }
  }

  const songIdMap = new Map();
  for (const song of incomingNorm.songs) {
    if (existingSongIds.has(song.id)) {
      songIdMap.set(song.id, uid());
    } else {
      songIdMap.set(song.id, song.id);
    }
  }

  const playlistIdMap = new Map();
  for (const pl of incomingNorm.playlists) {
    if (existingPlaylistIds.has(pl.id)) {
      playlistIdMap.set(pl.id, uid());
    } else {
      playlistIdMap.set(pl.id, pl.id);
    }
  }

  const setlistIdMap = new Map();
  for (const sl of incomingNorm.setlists) {
    if (existingSetlistIds.has(sl.id)) {
      setlistIdMap.set(sl.id, uid());
    } else {
      setlistIdMap.set(sl.id, sl.id);
    }
  }

  // Remap incoming documents
  const remappedIncomingDocs = incomingNorm.pdfDocuments.map((doc) => ({
    ...doc,
    id: docIdMap.get(doc.id) || doc.id,
  }));

  // Remap incoming songs
  const remappedIncomingSongs = incomingNorm.songs.map((song) => {
    const newSongId = songIdMap.get(song.id) || song.id;
    let pdfRef = null;
    if (song.pdfRef) {
      const newDocId = docIdMap.get(song.pdfRef.documentId) || song.pdfRef.documentId;
      pdfRef = {
        ...song.pdfRef,
        documentId: newDocId,
      };
    }
    return {
      ...song,
      id: newSongId,
      pdfRef,
    };
  });

  // Remap incoming playlists
  const remappedIncomingPlaylists = incomingNorm.playlists.map((pl) => ({
    ...pl,
    id: playlistIdMap.get(pl.id) || pl.id,
    songIds: pl.songIds.map((id) => songIdMap.get(id) || id),
  }));

  // Remap incoming setlists
  const remappedIncomingSetlists = incomingNorm.setlists.map((sl) => ({
    ...sl,
    id: setlistIdMap.get(sl.id) || sl.id,
    items: sl.items.map((item) => ({
      ...item,
      id: uid(),
      songId: songIdMap.get(item.songId) || item.songId,
    })),
  }));

  const mergedLibrary = normalizeLibrary({
    version: 2,
    pdfDocuments: [...currentNorm.pdfDocuments, ...remappedIncomingDocs],
    songs: [...currentNorm.songs, ...remappedIncomingSongs],
    playlists: [...currentNorm.playlists, ...remappedIncomingPlaylists],
    setlists: [...currentNorm.setlists, ...remappedIncomingSetlists],
  });

  return {
    mergedLibrary,
    docIdMap,
    songIdMap,
  };
}

/**
 * Restores PDF documents from parsed raw entries, handling base64 decoding,
 * ID remapping, signaling missing or corrupt documents, and saving valid ones.
 *
 * @param {Array<{ id: string, name?: string, pageCount?: number, data?: string }>} rawPdfs
 * @param {Map<string, string>} docIdMap
 * @param {Set<string>} expectedDocIds All document IDs required by the library
 * @param {(id: string, record: { name: string, pageCount: number, buffer: ArrayBuffer }) => Promise<void>} savePdfRecord
 * @returns {Promise<{
 *   restored: Array<{ id: string, name: string }>,
 *   missing: Array<{ id: string, name: string, reason: string }>,
 *   warnings: string[]
 * }>}
 */
export async function restorePdfDocuments(rawPdfs, docIdMap, expectedDocIds, savePdfRecord) {
  const restored = [];
  const missing = [];
  const warnings = [];

  const rawMap = new Map();
  for (const entry of rawPdfs) {
    if (entry?.id) rawMap.set(entry.id, entry);
  }

  // Restore available PDFs
  const restoredDocIds = new Set();
  for (const [origId, entry] of rawMap.entries()) {
    const targetId = docIdMap.get(origId) || origId;
    const name = String(entry.name || "partitura.pdf");
    const pageCount = Number(entry.pageCount || 1);

    if (!entry.data || typeof entry.data !== "string") {
      missing.push({ id: targetId, name, reason: "Dados binários ausentes" });
      continue;
    }

    let buffer;
    try {
      buffer = base64ToBuffer(entry.data);
      if (!buffer || buffer.byteLength === 0) {
        throw new Error("Buffer vazio");
      }
    } catch {
      missing.push({ id: targetId, name, reason: "Base64 corrompido" });
      continue;
    }

    try {
      await savePdfRecord(targetId, {
        name,
        pageCount,
        buffer,
      });
      restored.push({ id: targetId, name });
      restoredDocIds.add(targetId);
    } catch (err) {
      missing.push({ id: targetId, name, reason: `Falha ao salvar: ${err?.message || err}` });
    }
  }

  // Check if any expected document was not provided at all
  for (const expectedId of expectedDocIds) {
    if (!restoredDocIds.has(expectedId)) {
      const alreadyMissing = missing.some((m) => m.id === expectedId);
      if (!alreadyMissing) {
        missing.push({
          id: expectedId,
          name: "Documento não encontrado no backup",
          reason: "Não incluso no backup",
        });
      }
    }
  }

  if (missing.length > 0) {
    warnings.push(`${missing.length} partitura(s) não puderam ser restauradas.`);
  }

  return { restored, missing, warnings };
}

/**
 * End-to-end restore workflow for a backup file:
 * parses data, applies replace or merge (with collision remapping),
 * restores all valid PDFs, and returns the resulting library and report.
 *
 * @param {import('./store.js').Library} currentLibrary
 * @param {any} rawBackup
 * @param {{
 *   mode: "replace" | "merge",
 *   savePdfRecord: (id: string, record: { name: string, pageCount: number, buffer: ArrayBuffer }) => Promise<void>
 * }} options
 * @returns {Promise<{
 *   library: import('./store.js').Library,
 *   restored: Array<{ id: string, name: string }>,
 *   missing: Array<{ id: string, name: string, reason: string }>,
 *   warnings: string[]
 * }>}
 */
export async function executeRestore(currentLibrary, rawBackup, { mode, savePdfRecord }) {
  const { library: incomingLibrary, rawPdfs } = parseBackupData(rawBackup);

  let targetLibrary;
  let docIdMap;

  if (mode === "replace") {
    targetLibrary = incomingLibrary;
    docIdMap = new Map();
    for (const doc of incomingLibrary.pdfDocuments) {
      docIdMap.set(doc.id, doc.id);
    }
  } else {
    const mergeResult = mergeLibrariesWithRemap(currentLibrary, incomingLibrary);
    targetLibrary = mergeResult.mergedLibrary;
    docIdMap = mergeResult.docIdMap;
  }

  // Expected document IDs in the target library that came from incoming
  const expectedDocIds = new Set();
  for (const doc of incomingLibrary.pdfDocuments) {
    expectedDocIds.add(docIdMap.get(doc.id) || doc.id);
  }

  const { restored, missing, warnings } = await restorePdfDocuments(
    rawPdfs,
    docIdMap,
    expectedDocIds,
    savePdfRecord
  );

  return {
    library: targetLibrary,
    restored,
    missing,
    warnings,
  };
}
