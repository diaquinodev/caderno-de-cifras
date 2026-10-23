import test from "node:test";
import assert from "node:assert/strict";

import {
  suggestChart,
  verifyDraftInvariants,
  updateDraftTimeSignature,
  evaluateMeasureBeats,
  splitMeasure,
  splitMeasureAtChord,
  canMoveChordBetweenMeasures,
  moveChordBetweenMeasures,
  mergeMeasures,
  moveMeasure,
  splitSection,
  mergeSections,
  createDraftHistory,
  pushDraftHistoryState,
  undoDraftHistoryState,
  convertDraftToSong,
  validateDraftForConfirmation,
  getMeasureRepeatSignature,
  detectSectionRepeatCandidates,
  detectRepeatCandidates,
  isSectionCompacted,
  getSectionRepeatCompactions,
  getVisibleSectionMeasures,
  applyRepeatCompaction,
  expandRepeatCompaction,
  dismissRepeatCandidate,
} from "./draft.js";
import { parseCifraSource } from "./source.js";
import { ALL_SIX_FIXTURES, longRepeatedChart } from "./fixtures/cifras.js";
import { composeChartLayout } from "./chart-pages.js";

test("suggestChart: timeSignature vazio por padrão gera aviso NO_TIME_SIGNATURE", () => {
  const source = parseCifraSource(`Tom: C
[A]
| Cmaj7 | Dm7 G7 |`);

  const draft = suggestChart(source);

  assert.equal(draft.timeSignature, "");
  assert.equal(draft.title, "Sem título");
  assert.equal(draft.key, "C");
  const noTimeSig = draft.warnings.find((w) => w.code === "NO_TIME_SIGNATURE");
  assert.ok(noTimeSig, "Deve conter aviso NO_TIME_SIGNATURE quando timeSignature não é informado");
});

test("updateDraftTimeSignature: define fórmula de compasso e remove aviso NO_TIME_SIGNATURE", () => {
  const source = parseCifraSource(`Tom: C
[A]
| Cmaj7 | Dm7 G7 |`);

  const draft = suggestChart(source);
  const updated = updateDraftTimeSignature(draft, "4/4");

  assert.equal(updated.timeSignature, "4/4");
  assert.equal(updated.warnings.some((w) => w.code === "NO_TIME_SIGNATURE"), false);
});

test("suggestChart: respeita timeSignature 2/4 distribuindo 1 acorde por compasso", () => {
  const source = parseCifraSource(`Tom: G
[A]
G D7 Em Bm`);

  const draft = suggestChart(source, { timeSignature: "2/4" });

  assert.equal(draft.timeSignature, "2/4");
  assert.equal(draft.sections.length, 1);
  const measures = draft.sections[0].measures;
  assert.equal(measures.length, 4);
  assert.equal(measures[0].chords, "G");
  assert.equal(measures[1].chords, "D7");
  assert.equal(measures[2].chords, "Em");
  assert.equal(measures[3].chords, "Bm");
});

test("suggestChart: blocos anônimos recebem rótulo 'Principal' e aviso ANONYMOUS_SECTION", () => {
  const raw = `Tom: Bb
Bb7M Gm6 Fm7 Bb7
Eb7M Ebm6 Dm7 G7`;
  const source = parseCifraSource(raw);
  assert.equal(source.blocks[0].kind, "anonymous");

  const draft = suggestChart(source);

  assert.equal(draft.sections.length, 1);
  assert.equal(draft.sections[0].label, "Principal");
  const anonWarn = draft.warnings.find((w) => w.code === "ANONYMOUS_SECTION");
  assert.ok(anonWarn, "Deve conter aviso ANONYMOUS_SECTION");

  const inv = verifyDraftInvariants(draft, source);
  assert.equal(inv.valid, true, `Invariantes devem ser válidos: ${inv.errors.join(", ")}`);
});

test("suggestChart: tablaturas geram seções com kind tab e aviso TABLATURE_PRESERVED sem acordes inventados", () => {
  const raw = `Tom: D
[Tab - Intro]
e|---5---5---|
B|---5---5---|

[A]
| D7M | Em7 A7 |`;
  const source = parseCifraSource(raw);

  const draft = suggestChart(source);

  assert.equal(draft.sections.length, 2);
  const tabSec = draft.sections.find((s) => s.kind === "tab");
  assert.ok(tabSec, "Seção de tablatura deve existir no rascunho");
  assert.equal(tabSec.measures.length, 0, "Tablatura não deve inventar compassos com acordes");
  assert.ok(tabSec.tabContent.includes("e|---5---5---|"));

  const tabWarn = draft.warnings.find((w) => w.code === "TABLATURE_PRESERVED");
  assert.ok(tabWarn, "Deve conter aviso TABLATURE_PRESERVED");
});

test("invariantes de proveniência: todos os acordes das 6 fixtures são preservados no rascunho", () => {
  for (const fixture of ALL_SIX_FIXTURES) {
    const source = parseCifraSource(fixture.raw);
    const draft = suggestChart(source);

    const inv = verifyDraftInvariants(draft, source);
    assert.equal(
      inv.valid,
      true,
      `Fixture ${fixture.id} falhou nos invariantes de rascunho: ${inv.errors.join("; ")}`
    );

    const chordsInDraft = draft.sections.flatMap((s) => s.measures.flatMap((m) => m.sourceChords || []));
    assert.equal(
      chordsInDraft.length,
      source.allChords.length,
      `Fixture ${fixture.id}: contagem de acordes difere`
    );
  }
});

test("splitMeasure: divide compasso em dois mantendo a proveniência dos acordes", () => {
  const source = parseCifraSource(`Tom: C
[A]
| Dm7 G7 | Cmaj7 |`);
  const draft = suggestChart(source);
  const sec = draft.sections[0];
  const targetMeasId = sec.measures[0].id; // "Dm7 G7"

  const updated = splitMeasure(draft, sec.id, targetMeasId, 1);
  const updatedSec = updated.sections[0];

  assert.equal(updatedSec.measures.length, 3);
  assert.equal(updatedSec.measures[0].chords, "Dm7");
  assert.equal(updatedSec.measures[1].chords, "G7");
  assert.equal(updatedSec.measures[2].chords, "Cmaj7");

  const inv = verifyDraftInvariants(updated, source);
  assert.equal(inv.valid, true, "Invariantes devem se manter após splitMeasure");
});

test("splitMeasureAtChord: usa o acorde selecionado como fronteira para dividir compassos com 2 ou 3 acordes", () => {
  const source = parseCifraSource(`Tom: A
[A]
| D7M C#m7 B | E7 |`);
  const draft = suggestChart(source, { timeSignature: "4/4" });
  const sec = draft.sections[0];
  const firstMeasureId = sec.measures[0].id; // "Dmaj7 C#m7 B"

  // Selecionando o 3º acorde (índice 2 = "B") como fronteira:
  const splitAtThird = splitMeasureAtChord(draft, sec.id, firstMeasureId, 2);
  assert.deepEqual(
    splitAtThird.sections[0].measures.map((m) => m.chords),
    ["Dmaj7 C#m7", "B", "E7"]
  );
  assert.equal(verifyDraftInvariants(splitAtThird, source).valid, true);

  // Selecionando o 1º acorde (índice 0 = "Dmaj7"): separa o 1º dos demais
  const splitAtFirst = splitMeasureAtChord(draft, sec.id, firstMeasureId, 0);
  assert.deepEqual(
    splitAtFirst.sections[0].measures.map((m) => m.chords),
    ["Dmaj7", "C#m7 B", "E7"]
  );
  assert.equal(verifyDraftInvariants(splitAtFirst, source).valid, true);
});

test("moveChordBetweenMeasures: transforma | F#m D7M | C#m7 B | E7 | em | F#m | D7M C#m7 | B | E7 | preservando ordem e proveniência", () => {
  const source = parseCifraSource(`Tom: A
[A]
F#m D7M C#m7 B E7`);
  let draft = suggestChart(source, { timeSignature: "4/4" });

  // Heurística inicial de pares produz: | F#m Dmaj7 | C#m7 B | E7 |
  assert.deepEqual(
    draft.sections[0].measures.map((m) => m.chords),
    ["F#m Dmaj7", "C#m7 B", "E7"]
  );

  // Caminho 1: mover D7M (índice 1 do compasso 0) para o compasso seguinte -> | F#m | Dmaj7 C#m7 B | E7 |
  const secId = draft.sections[0].id;
  const m0Id = draft.sections[0].measures[0].id;
  assert.equal(canMoveChordBetweenMeasures(draft, secId, m0Id, 0, 1), false, "Não pode mover F#m pulando D7M");
  assert.equal(canMoveChordBetweenMeasures(draft, secId, m0Id, 1, 1), true, "Pode mover D7M para o compasso seguinte");

  draft = moveChordBetweenMeasures(draft, secId, m0Id, 1, 1);
  assert.deepEqual(
    draft.sections[0].measures.map((m) => m.chords),
    ["F#m", "Dmaj7 C#m7 B", "E7"]
  );
  assert.equal(verifyDraftInvariants(draft, source).valid, true);

  // Compasso 2 agora tem 3 acordes em 4/4 -> deve emitir aviso MEASURE_CHORD_COUNT_REVIEW
  assert.equal(
    draft.warnings.some((w) => w.code === "MEASURE_CHORD_COUNT_REVIEW"),
    true,
    "Compasso com 3 acordes em 4/4 deve gerar aviso para conferência"
  );

  // Dividir no acorde B (índice 2 do compasso 1) -> | F#m | Dmaj7 C#m7 | B | E7 |
  const m1Id = draft.sections[0].measures[1].id;
  draft = splitMeasureAtChord(draft, secId, m1Id, 2);
  assert.deepEqual(
    draft.sections[0].measures.map((m) => m.chords),
    ["F#m", "Dmaj7 C#m7", "B", "E7"]
  );
  assert.equal(verifyDraftInvariants(draft, source).valid, true);
  assert.equal(
    draft.warnings.some((w) => w.code === "MEASURE_CHORD_COUNT_REVIEW"),
    false,
    "Aviso de 3+ acordes deve desaparecer quando todos os compassos têm 1 ou 2 acordes"
  );
});

test("moveChordBetweenMeasures: suporta mover o primeiro acorde para o compasso anterior e absorver compasso unitário", () => {
  const source = parseCifraSource(`Tom: A
[A]
F#m D7M C#m7 B E7`);
  let draft = suggestChart(source, { timeSignature: "4/4" });
  const secId = draft.sections[0].id;

  // Caminho 2: dividir | F#m Dmaj7 | no acorde Dmaj7 -> | F#m | Dmaj7 | C#m7 B | E7 |
  draft = splitMeasureAtChord(draft, secId, draft.sections[0].measures[0].id, 1);
  assert.deepEqual(
    draft.sections[0].measures.map((m) => m.chords),
    ["F#m", "Dmaj7", "C#m7 B", "E7"]
  );

  // Mover C#m7 (índice 0 do compasso 2) para o compasso anterior (| Dmaj7 |) -> | F#m | Dmaj7 C#m7 | B | E7 |
  const m2Id = draft.sections[0].measures[2].id;
  assert.equal(canMoveChordBetweenMeasures(draft, secId, m2Id, 0, -1), true);
  assert.equal(canMoveChordBetweenMeasures(draft, secId, m2Id, 1, -1), false, "Não pode mover B pulando C#m7");

  draft = moveChordBetweenMeasures(draft, secId, m2Id, 0, -1);
  assert.deepEqual(
    draft.sections[0].measures.map((m) => m.chords),
    ["F#m", "Dmaj7 C#m7", "B", "E7"]
  );
  assert.equal(verifyDraftInvariants(draft, source).valid, true);

  // Se mover B (único acorde do compasso 2) para o compasso seguinte (| E7 |), o compasso vazio é removido:
  const mBId = draft.sections[0].measures[2].id;
  draft = moveChordBetweenMeasures(draft, secId, mBId, 0, 1);
  assert.deepEqual(
    draft.sections[0].measures.map((m) => m.chords),
    ["F#m", "Dmaj7 C#m7", "B E7"]
  );
  assert.equal(verifyDraftInvariants(draft, source).valid, true);
});

test("evaluateMeasureBeats: calcula tempos em 4/4 (1 acorde = 4t, 2 acordes = 2+2t, 3+ acordes = aviso sem duração inventada)", () => {
  const m1 = { id: "m1", chords: "F#m" };
  const m2 = { id: "m2", chords: "Dmaj7 C#m7" };
  const m3 = { id: "m3", chords: "Dmaj7 C#m7 B" };

  const eval1 = evaluateMeasureBeats(m1, "4/4");
  assert.equal(eval1.chordCount, 1);
  assert.deepEqual(eval1.beatsPerChord, [4]);
  assert.equal(eval1.summaryLabel, "4 tempos");
  assert.equal(eval1.needsReview, false);

  const eval2 = evaluateMeasureBeats(m2, "4/4");
  assert.equal(eval2.chordCount, 2);
  assert.deepEqual(eval2.beatsPerChord, [2, 2]);
  assert.equal(eval2.summaryLabel, "2 + 2 tempos");
  assert.equal(eval2.needsReview, false);

  const eval3 = evaluateMeasureBeats(m3, "4/4");
  assert.equal(eval3.chordCount, 3);
  assert.equal(eval3.beatsPerChord, null);
  assert.equal(eval3.needsReview, true);
  assert.ok(eval3.warningMessage.includes("3 ou mais acordes"));

  // Fora de 4/4 não inventa tempos de 4/4
  const eval24 = evaluateMeasureBeats(m2, "2/4");
  assert.equal(eval24.beatsPerChord, null);
  assert.equal(eval24.needsReview, false);
});

test("histórico puro (undo): desfaz cada alteração preservando ordem e proveniência", () => {
  const source = parseCifraSource(`Tom: A
[A]
F#m D7M C#m7 B E7`);
  let draft = suggestChart(source, { timeSignature: "4/4" });
  let history = createDraftHistory();

  const secId = draft.sections[0].id;

  // Passo 1: mover D7M para o compasso seguinte
  history = pushDraftHistoryState(history, draft);
  draft = moveChordBetweenMeasures(draft, secId, draft.sections[0].measures[0].id, 1, 1);
  assert.deepEqual(
    draft.sections[0].measures.map((m) => m.chords),
    ["F#m", "Dmaj7 C#m7 B", "E7"]
  );

  // Passo 2: dividir no acorde B
  history = pushDraftHistoryState(history, draft);
  draft = splitMeasureAtChord(draft, secId, draft.sections[0].measures[1].id, 2);
  assert.deepEqual(
    draft.sections[0].measures.map((m) => m.chords),
    ["F#m", "Dmaj7 C#m7", "B", "E7"]
  );

  // Desfazer Passo 2 -> volta para | F#m | Dmaj7 C#m7 B | E7 |
  const undo1 = undoDraftHistoryState(history, draft);
  assert.equal(undo1.undone, true);
  draft = undo1.draft;
  history = undo1.history;
  assert.deepEqual(
    draft.sections[0].measures.map((m) => m.chords),
    ["F#m", "Dmaj7 C#m7 B", "E7"]
  );
  assert.equal(verifyDraftInvariants(draft, source).valid, true);

  // Desfazer Passo 1 -> volta para | F#m Dmaj7 | C#m7 B | E7 |
  const undo2 = undoDraftHistoryState(history, draft);
  assert.equal(undo2.undone, true);
  draft = undo2.draft;
  history = undo2.history;
  assert.deepEqual(
    draft.sections[0].measures.map((m) => m.chords),
    ["F#m Dmaj7", "C#m7 B", "E7"]
  );
  assert.equal(verifyDraftInvariants(draft, source).valid, true);

  // Desfazer com histórico vazio mantém o rascunho intacto
  const undoEmpty = undoDraftHistoryState(history, draft);
  assert.equal(undoEmpty.undone, false);
  assert.equal(undoEmpty.draft, draft);
});

test("mergeMeasures: une dois compassos adjacentes preservando a ordem dos acordes", () => {
  const source = parseCifraSource(`Tom: C
[A]
| Dm7 | G7 | Cmaj7 |`);
  const draft = suggestChart(source);
  const sec = draft.sections[0];
  const m1Id = sec.measures[0].id; // "Dm7"
  const m2Id = sec.measures[1].id; // "G7"

  const updated = mergeMeasures(draft, sec.id, m1Id, m2Id);
  const updatedSec = updated.sections[0];

  assert.equal(updatedSec.measures.length, 2);
  assert.equal(updatedSec.measures[0].chords, "Dm7 G7");
  assert.equal(updatedSec.measures[1].chords, "Cmaj7");

  const inv = verifyDraftInvariants(updated, source);
  assert.equal(inv.valid, true, "Invariantes devem se manter após mergeMeasures");
});

test("moveMeasure: move compasso para outra posição ou seção", () => {
  const source = parseCifraSource(`Tom: C
[A]
| Cmaj7 | Dm7 |

[B]
| G7 | C6 |`);
  const draft = suggestChart(source);
  const secA = draft.sections[0];
  const secB = draft.sections[1];
  const mToMove = secA.measures[1].id; // "Dm7"

  const updated = moveMeasure(draft, secA.id, mToMove, secB.id, 0);

  assert.equal(updated.sections[0].measures.length, 1);
  assert.equal(updated.sections[0].measures[0].chords, "Cmaj7");

  assert.equal(updated.sections[1].measures.length, 3);
  assert.equal(updated.sections[1].measures[0].chords, "Dm7");
  assert.equal(updated.sections[1].measures[1].chords, "G7");
  assert.equal(updated.sections[1].measures[2].chords, "C6");

  const totalChords = updated.sections.flatMap((s) => s.measures.flatMap((m) => m.sourceChords || []));
  assert.equal(totalChords.length, source.allChords.length);
});

test("splitSection e mergeSections: divide e une seções preservando a integridade", () => {
  const source = parseCifraSource(`Tom: C
[A]
| Cmaj7 | Dm7 | G7 | C6 |`);
  const draft = suggestChart(source);
  const secA = draft.sections[0];

  const withSplit = splitSection(draft, secA.id, 2, "B");
  assert.equal(withSplit.sections.length, 2);
  assert.equal(withSplit.sections[0].label, "A");
  assert.equal(withSplit.sections[0].measures.length, 2);
  assert.equal(withSplit.sections[1].label, "B");
  assert.equal(withSplit.sections[1].measures.length, 2);

  const withMerge = mergeSections(withSplit, withSplit.sections[0].id, withSplit.sections[1].id);
  assert.equal(withMerge.sections.length, 1);
  assert.equal(withMerge.sections[0].measures.length, 4);

  const inv = verifyDraftInvariants(withMerge, source);
  assert.equal(inv.valid, true);
});

test("convertDraftToSong: gera Song válida (modelo v2) com seções, notas de tablatura e metadados", () => {
  const raw = `Título: Samba Teste
Artista: Compositor Famoso
Tom: D
[Tab - Intro]
e|---5---|

[A]
| D7M | Em7 A7 |`;
  const source = parseCifraSource(raw);
  const draft = suggestChart(source);
  const withTimeSig = updateDraftTimeSignature(draft, "2/4");

  const song = convertDraftToSong(withTimeSig);

  assert.ok(song.id, "Song deve ter ID");
  assert.equal(song.title, "Samba Teste");
  assert.equal(song.composer, "Compositor Famoso");
  assert.equal(song.key, "D");
  assert.equal(song.timeSignature, "2/4");
  assert.equal(song.sections.length, 1, "Tablatura não vira seção musical, mas entra em notas");
  assert.equal(song.sections[0].label, "A");
  assert.equal(song.sections[0].measures.length, 2);
  assert.equal(song.sections[0].measures[0].chords, "Dmaj7");
  assert.equal(song.sections[0].measures[1].chords, "Em7 A7");
  assert.ok(song.notes.includes("[Tablatura - Tab - Intro]"));
  assert.ok(song.notes.includes("e|---5---|"));
  assert.ok(song.sourceSnapshot !== null, "Deve reter o snapshot da fonte");
});

test("validateDraftForConfirmation: recusa rascunho sem fórmula de compasso e sem título", () => {
  const source = parseCifraSource(`[A]
| C | G |`);
  const draft = suggestChart(source);
  // Por padrão timeSignature é vazio
  const res1 = validateDraftForConfirmation(draft);
  assert.equal(res1.valid, false);
  assert.ok(res1.errors.some((e) => e.includes("fórmula de compasso")));

  // Sem título
  const noTitleDraft = { ...draft, timeSignature: "4/4", title: "" };
  const res2 = validateDraftForConfirmation(noTitleDraft);
  assert.equal(res2.valid, false);
  assert.ok(res2.errors.some((e) => e.includes("título")));
});

test("validateDraftForConfirmation: aceita rascunho com fórmula de compasso e título válidos", () => {
  const source = parseCifraSource(`Tom: D\n[A]\n| D | A |`);
  const draft = suggestChart(source);
  const updated = updateDraftTimeSignature(draft, "4/4");
  const res = validateDraftForConfirmation(updated);
  assert.equal(res.valid, true);
  assert.equal(res.errors.length, 0);
});

test("detectRepeatCandidates: detecta bloco consecutivo 2x com >= 2 compassos e preserva rascunho intacto", () => {
  const source = parseCifraSource(`Tom: C
[A]
| Cmaj7 | Dm7 G7 | Em7 A7 | Dm7 G7 |
| Cmaj7 | Dm7 G7 | Em7 A7 | Dm7 G7 |`);
  const draft = suggestChart(source, { timeSignature: "4/4" });
  const beforeJson = JSON.stringify(draft);

  const candidates = detectRepeatCandidates(draft);
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].sectionId, draft.sections[0].id);
  assert.equal(candidates[0].sectionLabel, "A");
  assert.equal(candidates[0].times, 2);
  assert.equal(candidates[0].savedMeasures, 4);
  assert.equal(candidates[0].startMeasureNumber, 1);
  assert.equal(candidates[0].endMeasureNumber, 8);
  assert.equal(candidates[0].firstMeasureIds.length, 4);
  assert.equal(candidates[0].repeatedMeasureIds.length, 4);
  assert.deepEqual(candidates[0].chordsPreview, ["Cmaj7", "Dm7 G7", "Em7 A7", "Dm7 G7"]);
  assert.match(candidates[0].summary, /Compassos 1–4 repetem em 5–8/);

  // Imutabilidade
  assert.equal(JSON.stringify(draft), beforeJson);
  assert.equal(verifyDraftInvariants(draft, source).valid, true);
});

test("detectRepeatCandidates: rejeita diferença de acorde, vamp de 1 acorde isolado e 3+ ocorrências consecutivas", () => {
  // Diferença de acorde no último compasso
  const diffDraft = suggestChart(
    parseCifraSource(`Tom: C\n[A]\n| Cmaj7 | Dm7 G7 | Cmaj7 | Dm7 G7b9 |`),
    { timeSignature: "4/4" }
  );
  assert.equal(detectRepeatCandidates(diffDraft).length, 0);

  // Vamp de 1 acorde isolado repetido (| C | C | C | C |)
  const vampDraft = suggestChart(
    parseCifraSource(`Tom: C\n[A]\n| Cmaj7 | Cmaj7 | Cmaj7 | Cmaj7 |`),
    { timeSignature: "4/4" }
  );
  assert.equal(detectRepeatCandidates(vampDraft).length, 0);

  // 3 ocorrências consecutivas (A B | A B | A B) -> não pode ser compactado como 2x ambíguo
  const tripleDraft = suggestChart(
    parseCifraSource(`Tom: C\n[A]\n| Cmaj7 | Dm7 G7 | Cmaj7 | Dm7 G7 | Cmaj7 | Dm7 G7 |`),
    { timeSignature: "4/4" }
  );
  assert.equal(detectRepeatCandidates(tripleDraft).length, 0);
});

test("detectRepeatCandidates: escolhe candidato maximal não sobreposto e respeita barreiras estruturais", () => {
  // Seção com 2 candidatos disjuntos: 2 compassos repetidos + ponte + 2 compassos repetidos
  const multiDraft = suggestChart(
    parseCifraSource(`Tom: C
[A]
| Cmaj7 | Dm7 G7 | Cmaj7 | Dm7 G7 | Fmaj7 | Fm6 | Em7 | A7 | Em7 | A7 |`),
    { timeSignature: "4/4" }
  );
  const multiCands = detectRepeatCandidates(multiDraft);
  assert.equal(multiCands.length, 2);
  assert.equal(multiCands[0].startMeasureNumber, 1);
  assert.equal(multiCands[0].endMeasureNumber, 4);
  assert.equal(multiCands[1].startMeasureNumber, 7);
  assert.equal(multiCands[1].endMeasureNumber, 10);

  // Barreira estrutural: compasso já com repeat ou ending não entra em candidato
  const withRepeatDraft = suggestChart(
    parseCifraSource(`Tom: C\n[A]\n| Cmaj7 | Dm7 G7 | Cmaj7 | Dm7 G7 |`),
    { timeSignature: "4/4" }
  );
  withRepeatDraft.sections[0].measures[0].repeat = "start";
  assert.equal(getMeasureRepeatSignature(withRepeatDraft.sections[0].measures[0]), null);
  assert.equal(detectSectionRepeatCandidates(withRepeatDraft.sections[0]).length, 0);

  // Fronteira entre seções: nunca cruza de [A] para [B]
  const crossSectionDraft = suggestChart(
    parseCifraSource(`Tom: C\n[A]\n| Cmaj7 | Dm7 G7 |\n[B]\n| Cmaj7 | Dm7 G7 |`),
    { timeSignature: "4/4" }
  );
  assert.equal(detectRepeatCandidates(crossSectionDraft).length, 0);
});

test("detectRepeatCandidates: roda com segurança sobre as 6 fixtures reais higienizadas sem mutar o rascunho", () => {
  for (const fixture of ALL_SIX_FIXTURES) {
    const source = parseCifraSource(fixture.raw);
    const draft = suggestChart(source, { timeSignature: "4/4" });
    const snapshot = JSON.stringify(draft);
    const candidates = detectRepeatCandidates(draft);
    assert.ok(Array.isArray(candidates), `Fixture ${fixture.id} deve retornar array de candidatos`);
    for (const cand of candidates) {
      assert.equal(cand.times, 2);
      assert.ok(cand.savedMeasures >= 2);
      assert.equal(cand.firstMeasureIds.length, cand.savedMeasures);
      assert.equal(cand.repeatedMeasureIds.length, cand.savedMeasures);
    }
    assert.equal(JSON.stringify(draft), snapshot, `Fixture ${fixture.id} não pode ser mutada pelo detector`);
  }
});

test("compactação reversível: applyRepeatCompaction e expandRepeatCompaction preservam invariantes, integram com undo e bloqueiam edição estrutural até expandir", () => {
  const source = parseCifraSource(`Tom: C
[A]
| Cmaj7 | Dm7 G7 | Em7 A7 | Dm7 G7 |
| Cmaj7 | Dm7 G7 | Em7 A7 | Dm7 G7 |`);
  let draft = suggestChart(source, { timeSignature: "4/4" });
  let history = createDraftHistory();

  const secId = draft.sections[0].id;
  const candidates = detectRepeatCandidates(draft);
  assert.equal(candidates.length, 1);

  // Compactar como 2x
  history = pushDraftHistoryState(history, draft);
  draft = applyRepeatCompaction(draft, candidates[0].id);

  assert.equal(isSectionCompacted(draft, secId), true);
  assert.equal(getSectionRepeatCompactions(draft, secId).length, 1);
  assert.equal(draft.sections[0].measures.length, 8, "Compassos canônicos permanecem intactos");
  assert.equal(verifyDraftInvariants(draft, source).valid, true);

  const visible = getVisibleSectionMeasures(draft, draft.sections[0]);
  assert.equal(visible.length, 4);
  assert.equal(visible[0].repeat, "start");
  assert.equal(visible[1].repeat, "");
  assert.equal(visible[2].repeat, "");
  assert.equal(visible[3].repeat, "end");

  // Operações estruturais devem ficar bloqueadas na seção compactada
  const m0Id = draft.sections[0].measures[0].id;
  const m1Id = draft.sections[0].measures[1].id;
  assert.equal(splitMeasure(draft, secId, m1Id, 1), draft);
  assert.equal(canMoveChordBetweenMeasures(draft, secId, m1Id, 0, -1), false);
  assert.equal(mergeMeasures(draft, secId, m0Id, m1Id), draft);
  assert.equal(splitSection(draft, secId, 2, "B"), draft);

  // Conversão para Song emite apenas a primeira ocorrência com |: ... :|
  const compactedSong = convertDraftToSong(draft);
  assert.equal(compactedSong.sections[0].measures.length, 4);
  assert.equal(compactedSong.sections[0].measures[0].repeat, "start");
  assert.equal(compactedSong.sections[0].measures[3].repeat, "end");
  assert.deepEqual(
    compactedSong.sections[0].measures.map((m) => m.chords),
    ["Cmaj7", "Dm7 G7", "Em7 A7", "Dm7 G7"]
  );

  // Expandir restaura os 8 compassos visíveis e desbloqueia edição
  history = pushDraftHistoryState(history, draft);
  draft = expandRepeatCompaction(draft, secId);
  assert.equal(isSectionCompacted(draft, secId), false);
  assert.equal(getVisibleSectionMeasures(draft, draft.sections[0]).length, 8);
  assert.equal(verifyDraftInvariants(draft, source).valid, true);

  // Undo volta para o estado compactado
  const undoExpand = undoDraftHistoryState(history, draft);
  assert.equal(undoExpand.undone, true);
  draft = undoExpand.draft;
  history = undoExpand.history;
  assert.equal(isSectionCompacted(draft, secId), true);
  assert.equal(getVisibleSectionMeasures(draft, draft.sections[0]).length, 4);

  // Segundo undo volta para o estado inicial antes de compactar
  const undoCompact = undoDraftHistoryState(history, draft);
  assert.equal(undoCompact.undone, true);
  draft = undoCompact.draft;
  assert.equal(isSectionCompacted(draft, secId), false);
  assert.equal(detectRepeatCandidates(draft).length, 1);
  assert.equal(verifyDraftInvariants(draft, source).valid, true);
});

test("dismissRepeatCandidate: oculta sugestão ('Manter completo') mantendo compassos literais e suporta undo", () => {
  const source = parseCifraSource(`Tom: C
[A]
| Cmaj7 | Dm7 G7 | Cmaj7 | Dm7 G7 |`);
  let draft = suggestChart(source, { timeSignature: "4/4" });
  let history = createDraftHistory();

  const [cand] = detectRepeatCandidates(draft);
  assert.ok(cand);

  history = pushDraftHistoryState(history, draft);
  draft = dismissRepeatCandidate(draft, cand.id);
  assert.equal(detectRepeatCandidates(draft).length, 0);
  assert.equal(getVisibleSectionMeasures(draft, draft.sections[0]).length, 4);

  const undone = undoDraftHistoryState(history, draft);
  assert.equal(undone.undone, true);
  assert.equal(detectRepeatCandidates(undone.draft).length, 1);
});

test("fase 21 (longRepeatedChart): expansão da cifra compactada equivale à sequência original e reduz páginas sem omitir conteúdo", () => {
  const source = parseCifraSource(longRepeatedChart);
  let draft = suggestChart(source, { timeSignature: "4/4" });
  const uncompactedSong = convertDraftToSong(draft);

  const candidates = detectRepeatCandidates(draft);
  assert.ok(candidates.length >= 3, "longRepeatedChart deve ter múltiplos candidatos de repetição");

  for (const cand of candidates) {
    draft = applyRepeatCompaction(draft, cand.id);
  }
  assert.equal(verifyDraftInvariants(draft, source).valid, true);

  const compactedSong = convertDraftToSong(draft);
  const expandSongMeasures = (song) => {
    const out = [];
    for (const sec of song.sections) {
      let repeatStartIdx = -1;
      for (let i = 0; i < sec.measures.length; i += 1) {
        const m = sec.measures[i];
        if (m.repeat === "start" || m.repeat === "both") {
          repeatStartIdx = i;
        }
        out.push(`${sec.label}:${m.chords}`);
        if (m.repeat === "end" || m.repeat === "both") {
          const from = repeatStartIdx >= 0 ? repeatStartIdx : i;
          for (let j = from; j <= i; j += 1) {
            out.push(`${sec.label}:${sec.measures[j].chords}`);
          }
          repeatStartIdx = -1;
        }
      }
    }
    return out;
  };

  assert.deepEqual(
    expandSongMeasures(compactedSong),
    expandSongMeasures(uncompactedSong),
    "A execução expandida da cifra compactada deve ser 100% idêntica à cifra por extenso"
  );

  const uncompactedMeasures = uncompactedSong.sections.reduce((acc, s) => acc + s.measures.length, 0);
  const compactedMeasures = compactedSong.sections.reduce((acc, s) => acc + s.measures.length, 0);
  assert.ok(compactedMeasures < uncompactedMeasures, "Compactação deve reduzir compassos escritos");

  const uncompactedPages = composeChartLayout(uncompactedSong, { systemCapacity: 5, density: "normal" }).pages.length;
  const compactedPages = composeChartLayout(compactedSong, { systemCapacity: 5, density: "normal" }).pages.length;
  assert.ok(compactedPages < uncompactedPages, "Compactação deve aumentar a densidade por página");
});
