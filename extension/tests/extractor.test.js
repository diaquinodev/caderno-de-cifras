import test from "node:test";
import assert from "node:assert/strict";
import { extractCanonicalCifra } from "../extractor.js";
import { parseCifraSource, verifyCifraSourceInvariants } from "../../caderno/js/source.js";

test("round-trip preserva metadados, seções, acordes invertidos e tablatura", () => {
  /** @type {Parameters<typeof extractCanonicalCifra>[0]} */
  const snapshot = {
    metadata: {
      title: "Canção de Teste",
      artist: "Artista de Teste",
      key: "D",
    },
    blocks: [
      {
        label: "Intro",
        kind: "section",
        lines: [{ type: "chords", chords: ["D", "A/C#", "Bm7", "G"] }],
      },
      {
        label: "Tab - Ponte",
        kind: "tab",
        lines: [
          { type: "tab", raw: "e|---5---5---|" },
          { type: "tab", raw: "B|---5---5---|" },
          { type: "tab", raw: "G|---4---4---|" },
          { type: "tab", raw: "D|---4---4---|" },
        ],
      },
      {
        label: "Refrão",
        kind: "section",
        lines: [{ type: "chords", chords: ["Em7", "A7", "D"] }],
      },
    ],
  };

  const extracted = extractCanonicalCifra(snapshot);
  assert.equal(extracted.ok, true);
  if (!extracted.ok) return;

  const source = parseCifraSource(extracted.text, { sourceFormat: "plain" });
  assert.equal(source.metadata.title, snapshot.metadata.title);
  assert.equal(source.metadata.artist, snapshot.metadata.artist);
  assert.equal(source.metadata.key, snapshot.metadata.key);
  assert.deepEqual(source.allChords.map((chord) => chord.raw), ["D", "A/C#", "Bm7", "G", "Em7", "A7", "D"]);
  assert.deepEqual(source.blocks.map((block) => [block.label, block.kind]), [
    ["Intro", "section"],
    ["Tab - Ponte", "tab"],
    ["Refrão", "section"],
  ]);
  assert.equal(source.blocks[1].lines.filter((line) => line.type === "tab").length, 4);
  assert.deepEqual(verifyCifraSourceInvariants(source), { valid: true, errors: [] });
});

test("seção e tom ausentes geram bloco anônimo sem inventar metadados", () => {
  const extracted = extractCanonicalCifra({
    metadata: { title: "Mapa sem Seção", artist: "Artista" },
    blocks: [
      {
        label: null,
        kind: "anonymous",
        lines: [{ type: "chords", chords: ["C/G", "F#7(9)"] }],
      },
    ],
  });

  assert.equal(extracted.ok, true);
  if (!extracted.ok) return;
  assert.doesNotMatch(extracted.text, /^Tom:/m);

  const source = parseCifraSource(extracted.text, { sourceFormat: "plain" });
  assert.equal(source.metadata.key, "");
  assert.equal(source.blocks.length, 1);
  assert.equal(source.blocks[0].kind, "anonymous");
  assert.equal(source.blocks[0].label, null);
  assert.deepEqual(source.allChords.map((chord) => chord.raw), ["C/G", "F#7(9)"]);
});

test("alterações numéricas separadas por barra preservam acordes compostos e inversões", () => {
  const extracted = extractCanonicalCifra({
    metadata: { title: "Extensões numéricas", artist: "Artista" },
    blocks: [
      {
        label: "Intro",
        kind: "section",
        lines: [{ type: "chords", chords: ["E7(4/9)", "G7(9/11)/B"] }],
      },
    ],
  });

  assert.equal(extracted.ok, true);
  if (!extracted.ok) return;

  const source = parseCifraSource(extracted.text, { sourceFormat: "plain" });
  assert.deepEqual(source.allChords.map((chord) => chord.raw), ["E7(4/9)", "G7(9/11)/B"]);
  assert.equal(extracted.chordCount, 2);
});

test("texto desconhecido e metadados multilinha não deixam letra atravessar o extrator", () => {
  const snapshot = /** @type {any} */ ({
    metadata: {
      title: "Título\ninjetado",
      artist: "Artista",
      key: "C",
    },
    blocks: [
      {
        label: "Parte",
        kind: "section",
        lines: [
          { type: "text", raw: "trecho de letra que não pode sair" },
          { type: "chords", chords: ["C", "G/B"] },
        ],
      },
    ],
  });

  const extracted = extractCanonicalCifra(snapshot);
  assert.equal(extracted.ok, true);
  if (!extracted.ok) return;
  assert.match(extracted.text, /^Título: Título injetado$/m);
  assert.doesNotMatch(extracted.text, /trecho de letra/);
  assert.match(extracted.text, /^C G\/B$/m);
});

test("acorde inválido interrompe a extração em vez de gerar conteúdo parcial", () => {
  const extracted = extractCanonicalCifra({
    metadata: { title: "Acorde Inválido" },
    blocks: [
      {
        label: null,
        kind: "anonymous",
        lines: [{ type: "chords", chords: ["C", "Amor", "G/B"] }],
      },
    ],
  });

  assert.deepEqual(extracted, {
    ok: false,
    error: "INVALID_CHORD",
    message: "A página contém um acorde que não pôde ser reconhecido com segurança.",
  });
});

test("tablatura inválida interrompe a extração sem copiar texto arbitrário", () => {
  const extracted = extractCanonicalCifra({
    metadata: { title: "Tab Inválida" },
    blocks: [
      {
        label: "Tab - Intro",
        kind: "tab",
        lines: [
          { type: "tab", raw: "isto não é tablatura" },
          { type: "chords", chords: ["C"] },
        ],
      },
    ],
  });

  assert.deepEqual(extracted, {
    ok: false,
    error: "INVALID_TAB",
    message: "A página contém uma linha de tablatura que não pôde ser reconhecida com segurança.",
  });
});

test("zero acordes retorna falha explícita mesmo quando há tablatura", () => {
  const extracted = extractCanonicalCifra({
    metadata: { title: "Somente Tab" },
    blocks: [
      {
        label: "Tab - Intro",
        kind: "tab",
        lines: [{ type: "tab", raw: "e|---5---5---|" }],
      },
    ],
  });

  assert.deepEqual(extracted, {
    ok: false,
    error: "NO_CHORDS",
    message: "Nenhum acorde reconhecível foi encontrado na página.",
  });
});
