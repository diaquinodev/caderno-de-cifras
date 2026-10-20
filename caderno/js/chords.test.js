import assert from "node:assert/strict";
import test from "node:test";
import {
  formatCell,
  normalizeKey,
  parseChartText,
  signedInterval,
  spellingFor,
  transposeCell,
} from "./chords.js";

test("transpõe de C para Bb um tom abaixo", () => {
  const spelling = spellingFor("Bb");
  const delta = signedInterval("C", "Bb");
  assert.equal(delta, -2);
  assert.equal(transposeCell("Cmaj7 Dm7 G7", delta, spelling), "Bbmaj7 Cm7 F7");
  assert.equal(transposeCell("C7b9/E", delta, spelling), "Bb7b9/D");
  assert.equal(transposeCell("NC %", delta, spelling), "NC %");
});

test("sobe uma quarta e escreve Cb quando o tom pede", () => {
  const delta = signedInterval("C", "Gb");
  assert.equal(transposeCell("Cmaj7", delta, spellingFor("Gb")), "Gbmaj7");
  assert.equal(transposeCell("Fmaj7", delta, spellingFor("Gb")), "Cbmaj7");
});

test("sobe uma quinta de C para G sem mudar a classe do acorde", () => {
  const delta = signedInterval("C", "G");
  assert.equal(transposeCell("Cmaj7 F#m7b5", delta, spellingFor("G")), "Gmaj7 C#m7b5");
});

test("mostra o acorde na grafia do iReal Pro", () => {
  assert.equal(formatCell("Cmaj7 Dm7 G7"), "CΔ7 D-7 G7");
  assert.equal(formatCell("Bm7b5 E7#9"), "B-7b5 E7#9");
  assert.equal(formatCell("Cmaj7/E"), "CΔ7/E");
  assert.equal(formatCell("GΔ7 B-7"), "GΔ7 B-7");
  assert.equal(formatCell("NC"), "NC");
});

test("normaliza o nome do tom", () => {
  assert.equal(normalizeKey("bbm"), "Bbm");
  assert.equal(normalizeKey("f#"), "F#");
  assert.equal(normalizeKey("dó"), null);
});

test("lê uma cifra colada com seções, casas e repetição", () => {
  const parsed = parseChartText(`Tom: Bb
Estilo: Samba
Andamento: 100
Compasso: 4/4

A
| Cmaj7 | | G7 |
|: Fmaj7 | Em7 :|

B
| [1] Cmaj7 | [2] Bbmaj7 |`);

  assert.equal(parsed.key, "Bb");
  assert.equal(parsed.style, "Samba");
  assert.equal(parsed.tempo, 100);
  assert.equal(parsed.timeSignature, "4/4");
  assert.equal(parsed.sections.length, 2);
  assert.deepEqual(parsed.sections[0].measures.map((measure) => measure.chords), ["Cmaj7", "", "G7", "Fmaj7", "Em7"]);
  assert.equal(parsed.sections[0].measures[3].repeat, "start");
  assert.equal(parsed.sections[0].measures[4].repeat, "end");
  assert.equal(parsed.sections[1].measures[0].ending, "1");
  assert.equal(parsed.sections[1].measures[1].ending, "2");
  assert.equal(parsed.sections[1].label, "B");
});

test("monta a forma curta com repetição no refrão", () => {
  const parsed = parseChartText(`Título: So Easy
Tom: C
Compasso: 4/4
Andamento: 100

Intro
| | | | |

Parte
| | | | | | | | |

Refrão
|: | | | | | | | :|

Parte
| | | | | | | | |

Refrão
| | | | | | | | |

Coda
| | | | |`);

  assert.equal(parsed.title, "So Easy");
  assert.equal(parsed.tempo, 100);
  assert.deepEqual(parsed.sections.map((section) => [section.label, section.measures.length]), [
    ["Intro", 4],
    ["Parte", 8],
    ["Refrão", 8],
    ["Parte", 8],
    ["Refrão", 8],
    ["Coda", 4],
  ]);
  const chorus = parsed.sections[2].measures;
  assert.equal(chorus[0].repeat, "start");
  assert.equal(chorus[7].repeat, "end");
  assert.ok(parsed.sections.every((section) => section.measures.every((measure) => measure.chords === "")));
});
