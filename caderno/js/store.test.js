import test from "node:test";
import assert from "node:assert/strict";
import {
  blankLibrary,
  blankSong,
  normalizeLibrary,
  normalizePdfDocument,
  normalizePdfRef,
  normalizeSong,
  pdfRangeSize,
  physicalToRelativePage,
  relativeToPhysicalPage,
  countPdfDocumentReferences,
  collectOrphanPdfDocuments,
  removePdfDocument,
  getSongPageCount,
  stepPerformancePosition,
  canStepPerformance,
} from "./store.js";

test("blankLibrary inicia na versao 2 com pdfDocuments vazio", () => {
  const lib = blankLibrary();
  assert.equal(lib.version, 2);
  assert.deepEqual(lib.pdfDocuments, []);
  assert.deepEqual(lib.songs, []);
  assert.deepEqual(lib.playlists, []);
  assert.deepEqual(lib.setlists, []);
});

test("blankSong possui valores padrao corretos e campos v2", () => {
  const song = blankSong();
  assert.equal(song.title, "Sem título");
  assert.equal(song.key, "C");
  assert.equal(song.timeSignature, "4/4");
  assert.equal(song.pdfRef, null);
  assert.equal(song.sourceSnapshot, null);
  assert.equal(song.sections.length, 1);
  assert.equal(song.sections[0].measures[0].annotation, "");
});

test("normalizeSong normaliza anotacao curta por compasso de forma idempotente", () => {
  const annotation = "  Convenção\ncom   metais " + "!".repeat(40);
  const firstPass = normalizeSong({
    title: "Tema anotado",
    sections: [{
      label: "A",
      measures: [
        { id: "m1", chords: "C7", annotation },
        { id: "m2", chords: "F7" },
      ],
    }],
  });

  assert.equal(firstPass.sections[0].measures[0].annotation, "Convenção com metais " + "!".repeat(19));
  assert.equal(firstPass.sections[0].measures[0].annotation.length, 40);
  assert.equal(firstPass.sections[0].measures[1].annotation, "");
  assert.deepEqual(normalizeSong(firstPass), firstPass);

  const unicode = normalizeSong({
    sections: [{ measures: [{ chords: "C7", annotation: "a".repeat(39) + "🎵" }] }],
  });
  assert.equal(unicode.sections[0].measures[0].annotation, "a".repeat(39) + "🎵");
  assert.equal(Array.from(unicode.sections[0].measures[0].annotation).length, 40);
});

test("normalizeSong aceita timeSignature vazia explicitamente e nao forca 4/4", () => {
  const songEmpty = normalizeSong({ title: "Sem compasso", timeSignature: "" });
  assert.equal(songEmpty.timeSignature, "");

  const song34 = normalizeSong({ title: "Valsa", timeSignature: "3/4" });
  assert.equal(song34.timeSignature, "3/4");

  const songInvalid = normalizeSong({ title: "Invalido", timeSignature: "abc" });
  assert.equal(songInvalid.timeSignature, "");
});

test("normalizePdfDocument valida limites e valores padrao", () => {
  const doc = normalizePdfDocument({ name: "", pageCount: 0 });
  assert.equal(doc.name, "Documento.pdf");
  assert.equal(doc.pageCount, 1);

  const docMax = normalizePdfDocument({ name: "Partitura.pdf", pageCount: 999 });
  assert.equal(docMax.name, "Partitura.pdf");
  assert.equal(docMax.pageCount, 200);
});

test("helpers de PdfRef calculam tamanho de intervalo e conversao de paginas", () => {
  const doc = { id: "doc-1", name: "livro.pdf", pageCount: 10 };
  const ref = normalizePdfRef({ documentId: "doc-1", firstPage: 3, lastPage: 6 }, doc);

  assert.equal(ref.firstPage, 3);
  assert.equal(ref.lastPage, 6);
  assert.equal(pdfRangeSize(ref), 4);

  // Pagina 1 da musica corresponde a pagina 3 fisica do PDF
  assert.equal(relativeToPhysicalPage(ref, 1), 3);
  // Pagina 4 da musica corresponde a pagina 6 fisica
  assert.equal(relativeToPhysicalPage(ref, 4), 6);
  // Limites: nao ultrapassa o intervalo
  assert.equal(relativeToPhysicalPage(ref, 99), 6);

  // Conversao inversa: pagina 3 fisica vira pagina 1 da musica
  assert.equal(physicalToRelativePage(ref, 3), 1);
  assert.equal(physicalToRelativePage(ref, 5), 3);
  assert.equal(physicalToRelativePage(ref, 6), 4);
});

test("PdfRef recupera de intervalo invertido, pagina zero e documento ausente", () => {
  // Intervalo invertido: first > last
  const inverted = normalizePdfRef({ documentId: "doc-1", firstPage: 5, lastPage: 2 });
  assert.equal(inverted.firstPage, 5);
  assert.equal(inverted.lastPage, 5);
  assert.equal(pdfRangeSize(inverted), 1);

  // Pagina zero ou negativa
  const zero = normalizePdfRef({ documentId: "doc-1", firstPage: 0, lastPage: -2 });
  assert.equal(zero.firstPage, 1);
  assert.equal(zero.lastPage, 1);

  // Documento ausente ou nulo
  assert.equal(normalizePdfRef(null), null);
  assert.equal(normalizePdfRef({ documentId: "" }), null);
});

test("migracao v1 para v2 converte pdfName em pdfDocuments e pdfRef", () => {
  const v1Library = {
    version: 1,
    songs: [
      {
        id: "song-1",
        title: "Wave",
        composer: "Tom Jobim",
        key: "D",
        tempo: 130,
        timeSignature: "4/4",
        pdfName: "wave.pdf",
        pdfPages: 3,
        sections: [],
      },
      {
        id: "song-2",
        title: "Garota de Ipanema",
        composer: "Tom Jobim",
        key: "F",
        tempo: 120,
        timeSignature: "",
        sections: [],
      },
    ],
    playlists: [],
    setlists: [],
  };

  const v2 = normalizeLibrary(v1Library);
  assert.equal(v2.version, 2);
  assert.equal(v2.pdfDocuments.length, 1);
  assert.equal(v2.pdfDocuments[0].id, "song-1");
  assert.equal(v2.pdfDocuments[0].name, "wave.pdf");
  assert.equal(v2.pdfDocuments[0].pageCount, 3);

  const song1 = v2.songs.find((s) => s.id === "song-1");
  assert.ok(song1.pdfRef);
  assert.equal(song1.pdfRef.documentId, "song-1");
  assert.equal(song1.pdfRef.firstPage, 1);
  assert.equal(song1.pdfRef.lastPage, 3);
  assert.equal(song1.pdfName, "wave.pdf");
  assert.equal(song1.pdfPages, 3);

  const song2 = v2.songs.find((s) => s.id === "song-2");
  assert.equal(song2.pdfRef, null);
  assert.equal(song2.timeSignature, "");
});

test("migracao v1 para v2 e idempotente", () => {
  const v1Library = {
    version: 1,
    songs: [
      {
        id: "song-1",
        title: "Wave",
        pdfName: "wave.pdf",
        pdfPages: 2,
      },
    ],
    playlists: [],
    setlists: [],
  };

  const firstPass = normalizeLibrary(v1Library);
  const secondPass = normalizeLibrary(firstPass);

  assert.equal(secondPass.version, 2);
  assert.equal(secondPass.pdfDocuments.length, 1);
  assert.deepEqual(secondPass, firstPass);
});

test("countPdfDocumentReferences calcula corretamente referencias compartilhadas", () => {
  const library = {
    version: 2,
    pdfDocuments: [{ id: "doc-shared", name: "songbook.pdf", pageCount: 12 }],
    songs: [
      { id: "song-1", title: "Tema 1", pdfRef: { documentId: "doc-shared", firstPage: 1, lastPage: 4 } },
      { id: "song-2", title: "Tema 2", pdfRef: { documentId: "doc-shared", firstPage: 5, lastPage: 8 } },
      { id: "song-3", title: "Cifra Pura", pdfRef: null },
    ],
  };

  assert.equal(countPdfDocumentReferences(library, "doc-shared"), 2);
  assert.equal(countPdfDocumentReferences(library, "doc-inexistente"), 0);
  assert.equal(countPdfDocumentReferences(null, "doc-shared"), 0);
});

test("collectOrphanPdfDocuments e removePdfDocument identificam e limpam documentos sem referencias", () => {
  const library = {
    version: 2,
    pdfDocuments: [
      { id: "doc-active", name: "ativo.pdf", pageCount: 5 },
      { id: "doc-orphan", name: "orfao.pdf", pageCount: 2 },
    ],
    songs: [
      { id: "s1", title: "Musica", pdfRef: { documentId: "doc-active", firstPage: 1, lastPage: 5 } },
    ],
  };

  const orphans = collectOrphanPdfDocuments(library);
  assert.deepEqual(orphans, ["doc-orphan"]);

  removePdfDocument(library, "doc-orphan");
  assert.equal(library.pdfDocuments.length, 1);
  assert.equal(library.pdfDocuments[0].id, "doc-active");
  assert.deepEqual(collectOrphanPdfDocuments(library), []);
});

import {
  createPdfSplitDraft,
  addSplitRange,
  updateSplitRange,
  removeSplitRange,
  validateSplitDraft,
  applyPdfSplitDraft,
} from "./store.js";

test("createPdfSplitDraft inicializa rascunho com valores padrao e intervalo unico", () => {
  const draft = createPdfSplitDraft({
    documentId: "doc-123",
    fileName: "songbook-chic.pdf",
    pageCount: 12,
  });

  assert.equal(draft.documentId, "doc-123");
  assert.equal(draft.fileName, "songbook-chic.pdf");
  assert.equal(draft.pageCount, 12);
  assert.equal(draft.ranges.length, 1);
  assert.equal(draft.ranges[0].title, "songbook-chic");
  assert.equal(draft.ranges[0].firstPage, 1);
  assert.equal(draft.ranges[0].lastPage, 12);
});

test("addSplitRange sugere proxima pagina e removeSplitRange preserva pelo menos um", () => {
  const draft = createPdfSplitDraft({
    fileName: "partitura.pdf",
    pageCount: 12,
  });
  updateSplitRange(draft, 0, { title: "Tema 1", firstPage: 1, lastPage: 6 });

  addSplitRange(draft, { title: "Tema 2" });
  assert.equal(draft.ranges.length, 2);
  assert.equal(draft.ranges[1].firstPage, 7);
  assert.equal(draft.ranges[1].lastPage, 8);

  removeSplitRange(draft, 1);
  assert.equal(draft.ranges.length, 1);

  // Tentativa de remover o unico range nao altera a lista
  removeSplitRange(draft, 0);
  assert.equal(draft.ranges.length, 1);
});

test("validateSplitDraft valida intervalos contiguos e detecta sobreposicoes e lacunas", () => {
  const draft = createPdfSplitDraft({ fileName: "chic.pdf", pageCount: 12 });
  draft.ranges = [
    { id: "1", title: "Tema 1", firstPage: 1, lastPage: 6 },
    { id: "2", title: "Tema 2", firstPage: 7, lastPage: 8 },
    { id: "3", title: "Tema 3", firstPage: 9, lastPage: 10 },
    { id: "4", title: "Tema 4", firstPage: 11, lastPage: 11 },
    { id: "5", title: "Tema 5", firstPage: 12, lastPage: 12 },
  ];

  const contigVal = validateSplitDraft(draft);
  assert.equal(contigVal.valid, true);
  assert.equal(contigVal.hasOverlap, false);
  assert.equal(contigVal.hasGaps, false);

  // Com sobreposicao na pagina 6
  draft.ranges[1].firstPage = 6;
  const overlapVal = validateSplitDraft(draft);
  assert.equal(overlapVal.valid, true);
  assert.equal(overlapVal.hasOverlap, true);
  assert.deepEqual(overlapVal.overlaps, [6]);

  // Com lacuna na pagina 7
  draft.ranges[1].firstPage = 8;
  const gapVal = validateSplitDraft(draft);
  assert.equal(gapVal.valid, true);
  assert.equal(gapVal.hasGaps, true);
  assert.deepEqual(gapVal.gaps, [7]);

  // Erros impeditivos: pagina invertida e titulo vazio
  draft.ranges[0].firstPage = 10;
  draft.ranges[0].lastPage = 2;
  draft.ranges[1].title = "   ";
  const errorVal = validateSplitDraft(draft);
  assert.equal(errorVal.valid, false);
  assert.ok(errorVal.errors.length >= 2);
});

test("applyPdfSplitDraft aplica divisao atomicamente criando musicas e registrando documento", () => {
  const library = {
    version: 2,
    pdfDocuments: [],
    songs: [{ id: "target-empty", title: "Sem Cifra", pdfRef: null, pdfName: "", pdfPages: 0 }],
  };

  const draft = createPdfSplitDraft({
    documentId: "doc-chic-12",
    fileName: "NEW CHIC.pdf",
    pageCount: 12,
  });
  draft.ranges = [
    { id: "1", title: "Música 1", firstPage: 1, lastPage: 6 },
    { id: "2", title: "Música 2", firstPage: 7, lastPage: 8 },
  ];

  const res = applyPdfSplitDraft(library, draft, { allowGaps: true, targetSongId: "target-empty" });
  assert.equal(res.documentId, "doc-chic-12");
  assert.equal(library.pdfDocuments.length, 1);
  assert.equal(library.pdfDocuments[0].id, "doc-chic-12");
  assert.equal(library.pdfDocuments[0].pageCount, 12);

  // A primeira musica reaproveita target-empty e a segunda e criada
  assert.equal(library.songs.length, 2);
  const song1 = library.songs.find((s) => s.id === "target-empty");
  assert.equal(song1.title, "Música 1");
  assert.deepEqual(song1.pdfRef, { documentId: "doc-chic-12", firstPage: 1, lastPage: 6 });
  assert.equal(song1.pdfPages, 6);

  const song2 = library.songs.find((s) => s.id !== "target-empty");
  assert.equal(song2.title, "Música 2");
  assert.deepEqual(song2.pdfRef, { documentId: "doc-chic-12", firstPage: 7, lastPage: 8 });
  assert.equal(song2.pdfPages, 2);
});


test("getSongPageCount calcula paginas utilizaveis para cifras e partituras", () => {
  assert.equal(getSongPageCount(null), 1);
  assert.equal(getSongPageCount({}), 1);
  assert.equal(getSongPageCount({ pdfRef: { documentId: "doc-1", firstPage: 7, lastPage: 8 } }), 2);
  assert.equal(getSongPageCount({ pdfPages: 4 }), 4);
  assert.equal(getSongPageCount({ id: "chart" }, { chartPageCount: () => 3 }), 3);
  assert.equal(getSongPageCount({ id: "chart" }, { chartPageCount: () => 0 }), 1);
  assert.equal(getSongPageCount({ id: "chart" }, { chartPageCount: () => Number.NaN }), 1);
  assert.equal(getSongPageCount({ id: "chart" }, { chartPageCount: () => Number.POSITIVE_INFINITY }), 1);
  assert.equal(getSongPageCount({ id: "chart" }, { chartPageCount: () => 2.9 }), 2);
  assert.equal(getSongPageCount({ pdfRef: { documentId: "doc-1", firstPage: 1, lastPage: 2 } }, { chartPageCount: () => 9 }), 2);
});

test("getSongPageCount escolhe explicitamente cifra ou PDF em música híbrida", () => {
  const hybrid = { id: "hybrid", pdfRef: { documentId: "doc-1", firstPage: 1, lastPage: 6 } };
  const chartPageCount = () => 3;

  assert.equal(getSongPageCount(hybrid, { representation: "auto", chartPageCount }), 6);
  assert.equal(getSongPageCount(hybrid, { representation: "pdf", chartPageCount }), 6);
  assert.equal(getSongPageCount(hybrid, { representation: "chart", chartPageCount }), 3);
});

test("stepPerformancePosition usa contador runtime para paginas de cifra", () => {
  const library = {
    songs: [
      { id: "chart-long" },
      { id: "chart-short" },
    ],
  };
  const items = [{ songId: "chart-long" }, { songId: "chart-short" }];
  const chartPageCount = (entry) => entry.id === "chart-long" ? 3 : 1;

  const page2 = stepPerformancePosition({ itemIndex: 0, page: 1 }, 1, { items, library, chartPageCount });
  const page3 = stepPerformancePosition(page2, 1, { items, library, chartPageCount });
  const nextSong = stepPerformancePosition(page3, 1, { items, library, chartPageCount });
  const backToLastPage = stepPerformancePosition(nextSong, -1, { items, library, chartPageCount });

  assert.equal(canStepPerformance({ itemIndex: 0, page: 1 }, 1, { items, library, chartPageCount }), true);
  assert.deepEqual(page2, { itemIndex: 0, page: 2, changedSong: false, reachedBoundary: false });
  assert.deepEqual(page3, { itemIndex: 0, page: 3, changedSong: false, reachedBoundary: false });
  assert.deepEqual(nextSong, { itemIndex: 1, page: 1, changedSong: true, reachedBoundary: false });
  assert.deepEqual(backToLastPage, { itemIndex: 0, page: 3, changedSong: true, reachedBoundary: false });
  assert.equal(canStepPerformance({ itemIndex: 1, page: 1 }, 1, { items, library, chartPageCount }), false);
});

test("stepPerformancePosition navega paginas e musicas na setlist com retorno para a ultima pagina", () => {
  const library = {
    version: 2,
    songs: [
      { id: "s-cifra-1", title: "Cifra 1" }, // 1 pagina
      { id: "s-pdf-2", title: "Partitura 2", pdfRef: { documentId: "d1", firstPage: 7, lastPage: 8 } }, // 2 paginas
      { id: "s-cifra-3", title: "Cifra 3" }, // 1 pagina
    ],
  };
  const items = [
    { songId: "s-cifra-1" },
    { songId: "s-pdf-2" },
    { songId: "s-cifra-3" },
  ];

  // 1. Início da setlist: Música 0, Página 1
  const pos0 = { itemIndex: 0, page: 1 };
  assert.equal(canStepPerformance(pos0, -1, { items, library }), false);
  assert.equal(canStepPerformance(pos0, 1, { items, library }), true);

  // 2. Avança de Música 0 (1 página) -> vai para Música 1, Página 1
  const step1 = stepPerformancePosition(pos0, 1, { items, library });
  assert.deepEqual(step1, { itemIndex: 1, page: 1, changedSong: true, reachedBoundary: false });

  // 3. Avança dentro de Música 1 (página 1 de 2 -> página 2 de 2)
  const step2 = stepPerformancePosition(step1, 1, { items, library });
  assert.deepEqual(step2, { itemIndex: 1, page: 2, changedSong: false, reachedBoundary: false });

  // 4. Avança de Música 1 página 2 -> vai para Música 2, Página 1
  const step3 = stepPerformancePosition(step2, 1, { items, library });
  assert.deepEqual(step3, { itemIndex: 2, page: 1, changedSong: true, reachedBoundary: false });

  // 5. Final da setlist: não avança além do limite
  assert.equal(canStepPerformance(step3, 1, { items, library }), false);
  const stepEnd = stepPerformancePosition(step3, 1, { items, library });
  assert.deepEqual(stepEnd, { itemIndex: 2, page: 1, changedSong: false, reachedBoundary: true });

  // 6. RECUO CRUCIAL: De Música 2 (pág 1) recuando para Música 1 -> DEVE ENTRAR NA PÁGINA 2 DE 2!
  const stepBackToPdf = stepPerformancePosition(step3, -1, { items, library });
  assert.deepEqual(stepBackToPdf, { itemIndex: 1, page: 2, changedSong: true, reachedBoundary: false });

  // 7. Recua dentro de Música 1 (página 2 de 2 -> página 1 de 2)
  const stepBackWithinPdf = stepPerformancePosition(stepBackToPdf, -1, { items, library });
  assert.deepEqual(stepBackWithinPdf, { itemIndex: 1, page: 1, changedSong: false, reachedBoundary: false });

  // 8. Recua de Música 1 página 1 -> volta para Música 0, Página 1
  const stepBackToFirst = stepPerformancePosition(stepBackWithinPdf, -1, { items, library });
  assert.deepEqual(stepBackToFirst, { itemIndex: 0, page: 1, changedSong: true, reachedBoundary: false });

  // 9. Limite inicial: não recua antes de Música 0, Página 1
  const stepBeforeStart = stepPerformancePosition(stepBackToFirst, -1, { items, library });
  assert.deepEqual(stepBeforeStart, { itemIndex: 0, page: 1, changedSong: false, reachedBoundary: true });
});

test("stepPerformancePosition funciona para musica avulsa fora de setlist", () => {
  const single1 = stepPerformancePosition({ itemIndex: 0, page: 1 }, 1, { items: [] });
  assert.deepEqual(single1, { itemIndex: 0, page: 2, changedSong: false, reachedBoundary: false });

  const singleBack = stepPerformancePosition({ itemIndex: 0, page: 2 }, -1, { items: [] });
  assert.deepEqual(singleBack, { itemIndex: 0, page: 1, changedSong: false, reachedBoundary: false });

  const singleBoundary = stepPerformancePosition({ itemIndex: 0, page: 1 }, -1, { items: [] });
  assert.deepEqual(singleBoundary, { itemIndex: 0, page: 1, changedSong: false, reachedBoundary: true });
});

test("stepPerformancePosition avança e recua por dupla de páginas (2-up) e suporta última dupla ímpar", () => {
  const library = {
    songs: [
      { id: "chart-3p" },
      { id: "chart-2p" },
    ],
  };
  const items = [{ songId: "chart-3p" }, { songId: "chart-2p" }];
  const chartPageCount = (entry) => (entry.id === "chart-3p" ? 3 : 2);
  const chartPageSpan = () => 2;
  const ctx = { items, library, chartPageCount, chartPageSpan };

  // Em 2-up, páginas 1-2 estão visíveis; avançar leva à página 3 (última dupla incompleta)
  const spread2 = stepPerformancePosition({ itemIndex: 0, page: 1 }, 1, ctx);
  assert.deepEqual(spread2, { itemIndex: 0, page: 3, changedSong: false, reachedBoundary: false });

  // Avançar da página 3 passa para a próxima música na página 1 (mostrando 1-2)
  const nextSong = stepPerformancePosition(spread2, 1, ctx);
  assert.deepEqual(nextSong, { itemIndex: 1, page: 1, changedSong: true, reachedBoundary: false });

  // Como chart-2p tem 2 páginas e ambas estão visíveis em 2-up (1-2 de 2), já está no limite final
  assert.equal(canStepPerformance(nextSong, 1, ctx), false);

  // Recuar da música 2 volta para o início da última dupla da música 1 (página 3)
  const backToOddSpread = stepPerformancePosition(nextSong, -1, ctx);
  assert.deepEqual(backToOddSpread, { itemIndex: 0, page: 3, changedSong: true, reachedBoundary: false });

  // Recuar da página 3 volta para o início da primeira dupla (página 1)
  const backToFirstSpread = stepPerformancePosition(backToOddSpread, -1, ctx);
  assert.deepEqual(backToFirstSpread, { itemIndex: 0, page: 1, changedSong: false, reachedBoundary: false });
});
