import test from "node:test";
import assert from "node:assert/strict";

import {
  analyzeChordLineSpacing,
  compareSpacingVsLegacy,
  GAP_ANOMALY_RATIO,
} from "./spacing.js";

test("Fase 14: Noite do Prazer distingue | F#m | D7M C#m7 | B | E7 | da heurística cega por pares", () => {
  // Linha real de Noite do Prazer com os espaços típicos da cifra
  const rawLine = "F#m             D7M  C#m7            B             E7";
  const chords = ["F#m", "D7M", "C#m7", "B", "E7"];

  const comparison = compareSpacingVsLegacy(rawLine, chords);

  // A heurística legada junta de dois em dois cegamente:
  assert.deepEqual(comparison.legacyBars, [
    ["F#m", "D7M"],
    ["C#m7", "B"],
    ["E7"],
  ]);

  // A heurística de proximidade relativa mede o gap e detecta D7M C#m7 colados:
  assert.deepEqual(comparison.spacingBars, [
    ["F#m"],
    ["D7M", "C#m7"],
    ["B"],
    ["E7"],
  ]);
});

test("Fase 14: So Easy (To Fall In Love) preserva 4 compassos inteiros em linha com espaçamento regular", () => {
  const rawLine = "C   G/B   Am   F";
  const chords = ["C", "G/B", "Am", "F"];

  const result = analyzeChordLineSpacing(rawLine, chords);

  // Todos os gaps são uniformes (gap 3), nenhum é anomalia:
  assert.equal(result.medianGap, 3);
  assert.equal(result.evidence.every((e) => !e.clustered), true);

  // Produz 4 compassos individuais de 4 tempos, sem compressão indevida:
  assert.deepEqual(result.suggestedBars, [
    ["C"],
    ["G/B"],
    ["Am"],
    ["F"],
  ]);
});

test("Fase 14: Réu Confesso (Tim Maia) preserva compassos em linha de introdução típica", () => {
  const rawLine = "A7M   F#m7   Bm7   E7(9)";
  const chords = ["A7M", "F#m7", "Bm7", "E7(9)"];

  const result = analyzeChordLineSpacing(rawLine, chords);

  assert.deepEqual(result.suggestedBars, [
    ["A7M"],
    ["F#m7"],
    ["Bm7"],
    ["E7(9)"],
  ]);
});

test("Fase 14: Linha com 2 acordes distingue compassos separados (letra) de compasso dividido (turnaround)", () => {
  // Caso A: 2 acordes espaçados sobre versos da letra (gap largo >= 6)
  const lineVerso = "E7M              C#m7";
  const resultVerso = analyzeChordLineSpacing(lineVerso, ["E7M", "C#m7"]);
  assert.deepEqual(resultVerso.suggestedBars, [
    ["E7M"],
    ["C#m7"],
  ]);

  // Caso B: 2 acordes em passagem rápida / turnaround (gap curto <= 3)
  const lineTurnaround = "Dm7  G7";
  const resultTurnaround = analyzeChordLineSpacing(lineTurnaround, ["Dm7", "G7"]);
  assert.deepEqual(resultTurnaround.suggestedBars, [
    ["Dm7", "G7"],
  ]);
});

test("Fase 14: ChordPositionEvidence calcula métricas relativas sem conter letras ou dados protegidos", () => {
  const rawLine = "F#m             D7M  C#m7            B             E7";
  const chords = ["F#m", "D7M", "C#m7", "B", "E7"];

  const result = analyzeChordLineSpacing(rawLine, chords, 1);

  assert.equal(result.chordCount, 5);
  assert.ok(result.medianGap >= 12);

  const c2 = result.evidence[2]; // C#m7
  assert.equal(c2.chordName, "C#m7");
  assert.equal(c2.gapBefore, 2);
  assert.ok(c2.gapRatio < GAP_ANOMALY_RATIO);
  assert.equal(c2.clustered, true);

  // Sanitização: assegura que não há chaves de letra/dados sensíveis
  for (const item of result.evidence) {
    assert.equal("lyrics" in item, false);
    assert.equal("token" in item, false);
    assert.equal("cookie" in item, false);
  }
});
