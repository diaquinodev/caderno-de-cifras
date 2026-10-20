import test from "node:test";
import assert from "node:assert/strict";

import {
  suggestChart,
  verifyDraftInvariants,
  updateDraftTimeSignature,
  splitMeasure,
  mergeMeasures,
  moveMeasure,
  splitSection,
  mergeSections,
  convertDraftToSong,
} from "./draft.js";
import { parseCifraSource } from "./source.js";
import { ALL_SIX_FIXTURES } from "./fixtures/cifras.js";

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
