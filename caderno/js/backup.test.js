import test from "node:test";
import assert from "node:assert/strict";
import {
  createBackupV2,
  parseBackupData,
  mergeLibrariesWithRemap,
  restorePdfDocuments,
  executeRestore,
} from "./backup.js";
import { normalizeLibrary } from "./store.js";
import { bufferToBase64 } from "./files.js";

function mockPdfBytes(text = "PDF MOCK") {
  const enc = new TextEncoder();
  return enc.encode(text).buffer;
}

test("createBackupV2 exporta bytes uma unica vez por documentId e preserva todas as pdfRef", async () => {
  const samplePdf = mockPdfBytes("PARTITURA UNICA");
  const storedPdfs = new Map([
    ["doc_shared", { name: "completo.pdf", pageCount: 10, buffer: samplePdf }],
  ]);

  const library = normalizeLibrary({
    version: 2,
    pdfDocuments: [
      { id: "doc_shared", name: "completo.pdf", pageCount: 10 },
    ],
    songs: [
      {
        id: "song_1",
        title: "Musica 1",
        pdfRef: { documentId: "doc_shared", firstPage: 1, lastPage: 2 },
      },
      {
        id: "song_2",
        title: "Musica 2",
        pdfRef: { documentId: "doc_shared", firstPage: 3, lastPage: 5 },
      },
    ],
    playlists: [],
    setlists: [],
  });

  const backup = await createBackupV2(library, async (id) => storedPdfs.get(id) || null);

  assert.equal(backup.version, 2);
  assert.equal(backup.library.songs.length, 2);
  assert.equal(backup.library.songs[0].pdfRef.documentId, "doc_shared");
  assert.equal(backup.library.songs[1].pdfRef.documentId, "doc_shared");

  // Confirm exactly 1 binary entry in backup for doc_shared
  assert.equal(backup.pdfDocuments.length, 1);
  assert.equal(backup.pdfDocuments[0].id, "doc_shared");
  assert.equal(backup.pdfDocuments[0].data, bufferToBase64(samplePdf));
});

test("backup v2 preserva anotacao por compasso na exportacao e restauracao", async () => {
  const library = normalizeLibrary({
    version: 2,
    pdfDocuments: [],
    songs: [{
      id: "song_annotated",
      title: "Tema com breque",
      sections: [{
        id: "section_a",
        label: "A",
        measures: [{ id: "measure_1", chords: "C7", annotation: "Breque com metais" }],
      }],
    }],
    playlists: [],
    setlists: [],
  });

  const backup = await createBackupV2(library, async () => null);
  const parsed = parseBackupData(JSON.stringify(backup));
  const restored = await executeRestore(
    normalizeLibrary({ version: 2, pdfDocuments: [], songs: [], playlists: [], setlists: [] }),
    JSON.stringify(backup),
    { mode: "replace", savePdfRecord: async () => {} }
  );

  assert.equal(backup.library.songs[0].sections[0].measures[0].annotation, "Breque com metais");
  assert.equal(parsed.library.songs[0].sections[0].measures[0].annotation, "Breque com metais");
  assert.equal(restored.library.songs[0].sections[0].measures[0].annotation, "Breque com metais");
});

test("parseBackupData aceita backup v1 legado e converte para v2", () => {
  const legacyV1 = {
    version: 1,
    songs: [
      {
        id: "legacy_song_1",
        title: "Cifra Antiga",
        pdfName: "antiga.pdf",
        pdfPages: 4,
      },
    ],
    playlists: [],
    setlists: [],
    pdfs: {
      legacy_song_1: {
        name: "antiga.pdf",
        pages: 4,
        data: bufferToBase64(mockPdfBytes("LEGACY")),
      },
    },
  };

  const { library, rawPdfs } = parseBackupData(legacyV1);

  assert.equal(library.version, 2);
  assert.equal(library.pdfDocuments.length, 1);
  assert.equal(library.pdfDocuments[0].name, "antiga.pdf");
  assert.equal(library.songs[0].pdfRef.documentId, "legacy_song_1");
  assert.equal(rawPdfs.length, 1);
  assert.equal(rawPdfs[0].id, "legacy_song_1");
});

test("mergeLibrariesWithRemap resolve colisoes de IDs em documentos, musicas, playlists e setlists", () => {
  const current = normalizeLibrary({
    version: 2,
    pdfDocuments: [{ id: "doc_common", name: "Doc Original", pageCount: 2 }],
    songs: [
      {
        id: "song_common",
        title: "Musica Original",
        pdfRef: { documentId: "doc_common", firstPage: 1, lastPage: 2 },
      },
    ],
    playlists: [{ id: "pl_common", name: "Playlist Original", songIds: ["song_common"] }],
    setlists: [{ id: "sl_common", name: "Setlist Original", items: [{ id: "it_1", songId: "song_common" }] }],
  });

  const incoming = normalizeLibrary({
    version: 2,
    pdfDocuments: [
      { id: "doc_common", name: "Doc Importado Colidindo", pageCount: 5 },
      { id: "doc_unique", name: "Doc Sem Colisao", pageCount: 3 },
    ],
    songs: [
      {
        id: "song_common",
        title: "Musica Importada Colidindo",
        pdfRef: { documentId: "doc_common", firstPage: 1, lastPage: 5 },
      },
      {
        id: "song_unique",
        title: "Musica Sem Colisao",
        pdfRef: { documentId: "doc_unique", firstPage: 1, lastPage: 3 },
      },
    ],
    playlists: [{ id: "pl_common", name: "Playlist Importada", songIds: ["song_common", "song_unique"] }],
    setlists: [{ id: "sl_common", name: "Setlist Importada", items: [{ id: "it_2", songId: "song_common" }] }],
  });

  const { mergedLibrary, docIdMap, songIdMap } = mergeLibrariesWithRemap(current, incoming);

  // Both the original and incoming items must exist in mergedLibrary
  assert.equal(mergedLibrary.pdfDocuments.length, 3);
  assert.equal(mergedLibrary.songs.length, 3);
  assert.equal(mergedLibrary.playlists.length, 2);
  assert.equal(mergedLibrary.setlists.length, 2);

  // doc_common collision remapped
  const newDocId = docIdMap.get("doc_common");
  assert.notEqual(newDocId, "doc_common");
  assert.equal(docIdMap.get("doc_unique"), "doc_unique");

  // song_common collision remapped
  const newSongId = songIdMap.get("song_common");
  assert.notEqual(newSongId, "song_common");
  assert.equal(songIdMap.get("song_unique"), "song_unique");

  // Check that the remapped song has its pdfRef pointing to newDocId
  const remappedSong = mergedLibrary.songs.find((s) => s.id === newSongId);
  assert.ok(remappedSong);
  assert.equal(remappedSong.pdfRef.documentId, newDocId);

  // Check that the remapped playlist references newSongId
  const remappedPl = mergedLibrary.playlists.find((p) => p.name === "Playlist Importada");
  assert.ok(remappedPl);
  assert.ok(remappedPl.songIds.includes(newSongId));
  assert.ok(remappedPl.songIds.includes("song_unique"));

  // Check that the remapped setlist references newSongId
  const remappedSl = mergedLibrary.setlists.find((s) => s.name === "Setlist Importada");
  assert.ok(remappedSl);
  assert.equal(remappedSl.items[0].songId, newSongId);
});

test("restorePdfDocuments sinaliza documento ausente e base64 corrompido sem abortar os validos", async () => {
  const saved = new Map();
  const mockSave = async (id, record) => {
    saved.set(id, record);
  };

  const rawPdfs = [
    {
      id: "doc_valid",
      name: "valido.pdf",
      pageCount: 2,
      data: bufferToBase64(mockPdfBytes("VALIDO")),
    },
    {
      id: "doc_corrupt",
      name: "corrompido.pdf",
      pageCount: 1,
      data: "!!!not-valid-base64???",
    },
  ];

  const docIdMap = new Map([
    ["doc_valid", "doc_valid"],
    ["doc_corrupt", "doc_corrupt"],
  ]);

  // Expected doc_missing was never provided
  const expectedDocIds = new Set(["doc_valid", "doc_corrupt", "doc_missing"]);

  const { restored, missing, warnings } = await restorePdfDocuments(
    rawPdfs,
    docIdMap,
    expectedDocIds,
    mockSave
  );

  assert.equal(restored.length, 1);
  assert.equal(restored[0].id, "doc_valid");
  assert.ok(saved.has("doc_valid"));

  assert.equal(missing.length, 2);
  const corruptEntry = missing.find((m) => m.id === "doc_corrupt");
  assert.ok(corruptEntry);
  assert.equal(corruptEntry.reason, "Base64 corrompido");

  const missingEntry = missing.find((m) => m.id === "doc_missing");
  assert.ok(missingEntry);
  assert.equal(missingEntry.reason, "Não incluso no backup");

  assert.ok(warnings.length > 0);
});

test("executeRestore executa fluxo completo de round-trip mantendo intervalos e integridade", async () => {
  const samplePdf = mockPdfBytes("ROUNDTRIP BYTES");
  const storage = new Map([
    ["doc_shared", { name: "partitura.pdf", pageCount: 8, buffer: samplePdf }],
  ]);

  const originalLibrary = normalizeLibrary({
    version: 2,
    pdfDocuments: [{ id: "doc_shared", name: "partitura.pdf", pageCount: 8 }],
    songs: [
      { id: "s1", title: "Musica 1", pdfRef: { documentId: "doc_shared", firstPage: 1, lastPage: 2 } },
      { id: "s2", title: "Musica 2", pdfRef: { documentId: "doc_shared", firstPage: 3, lastPage: 4 } },
      { id: "s3", title: "Musica 3", pdfRef: { documentId: "doc_shared", firstPage: 5, lastPage: 6 } },
      { id: "s4", title: "Musica 4", pdfRef: { documentId: "doc_shared", firstPage: 7, lastPage: 7 } },
      { id: "s5", title: "Musica 5", pdfRef: { documentId: "doc_shared", firstPage: 8, lastPage: 8 } },
    ],
    playlists: [],
    setlists: [],
  });

  // 1. Export
  const backup = await createBackupV2(originalLibrary, async (id) => storage.get(id) || null);
  const jsonString = JSON.stringify(backup);

  // Verify only ONE occurrence of the base64 string in JSON
  const b64 = bufferToBase64(samplePdf);
  const matches = jsonString.split(b64).length - 1;
  assert.equal(matches, 1, "O base64 da partitura deve aparecer exatamente uma vez no JSON exportado");

  // 2. Restore into fresh empty environment
  const freshStorage = new Map();
  const mockSave = async (id, record) => {
    freshStorage.set(id, record);
  };

  const currentEmpty = normalizeLibrary({ version: 2, pdfDocuments: [], songs: [], playlists: [], setlists: [] });
  const result = await executeRestore(currentEmpty, jsonString, {
    mode: "replace",
    savePdfRecord: mockSave,
  });

  assert.equal(result.missing.length, 0);
  assert.equal(result.restored.length, 1);
  assert.equal(result.library.songs.length, 5);

  // Check that all 5 songs still reference doc_shared and keep page ranges
  for (let i = 0; i < 5; i += 1) {
    const orig = originalLibrary.songs[i];
    const restored = result.library.songs[i];
    assert.equal(restored.pdfRef.documentId, "doc_shared");
    assert.equal(restored.pdfRef.firstPage, orig.pdfRef.firstPage);
    assert.equal(restored.pdfRef.lastPage, orig.pdfRef.lastPage);
  }

  assert.ok(freshStorage.has("doc_shared"));
  assert.equal(freshStorage.get("doc_shared").buffer.byteLength, samplePdf.byteLength);
});
