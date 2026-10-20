import assert from "node:assert/strict";
import test from "node:test";
import { formatCell } from "./chords.js";
import { chartFromCifraHtml, chartFromCifraPlain, cifraClubUrl, isCifraClubUrl, linesToBars, pastedCifraLink } from "./cifra.js";

function div(chords, labelAfter = "", labelBefore = "") {
  const marks = chords.map((chord) => `<b data-chord-name="${chord}" data-chord-original-trailing="lyric Central Park">${chord}</b>`).join("");
  return `<div>${labelBefore}${marks}${labelAfter}</div>`;
}

const soEasy = `<h1>So Easy (To Fall In Love)</h1>
<span>Tom<!-- -->: </span> <button>Eb</button>
<p>Composição: Gang Wolf, John Henry Ryan, Olivia Dean e Amy Rose Allen Essa informação está errada?</p>
<pre>
${div(["Fm7", "Gm7"], "", "[Intro] ")}
<div class="tabs"><div><span>[Tab - Intro]</span> ${div(["Fm7", "Gm7"]).replace(/^<div>|<\/div>$/g, "")} [Primeira Parte]</div></div>
${div(["Bb7(4)"])}
${div(["Eb7M", "Em7(5-)"])}
${div(["Bb7(4)"])}
${div(["Eb7M"])}
${div(["Em7(5-)"])}
${div(["Bb7(4)"])}
${div(["Eb7M"])}
${div(["Em7(5-)"])}
${div(["Bb7(4)"])}
${div(["Eb7M"], " [Refrão]")}
${div(["Em7(5-)", "Fm7", "Bb7", "Cm7"])}
${div(["C7", "Fm7"])}
${div(["Bb7", "Cm7"])}
${div(["C7", "Fm7"])}
${div(["Bb7"])}
${div(["Cm7", "A°"])}
${div(["Fm7"])}
${div(["Gm7"], " [Segunda Parte]")}
${div(["Bb7(4)"])}
${div(["Eb7M", "Em7(5-)"])}
${div(["Bb7(4)"])}
${div(["Eb7M"])}
${div(["Bb7(4)"])}
${div(["Eb7M", "Em7(5-)"])}
${div(["Bb7(4)"])}
${div(["Eb7M"], " [Refrão]")}
${div(["Em7(5-)", "Fm7", "Bb7", "Cm7"])}
${div(["C7", "Fm7"])}
${div(["Bb7", "Cm7"])}
${div(["C7", "Fm7"])}
${div(["Bb7"])}
${div(["Cm7", "A°"])}
${div(["Fm7"])}
${div(["Gm7"], " [Ponte]")}
${div(["Bb7(4)", "Eb7M", "Em7(5-)"])}
${div(["Bb7(4)", "Eb7M", "Em7(5-)"])}
${div(["Bb7(4)"])}
${div(["Eb7M", "Em7(5-)"])}
${div(["Bb7(4)"])}
${div(["Eb7M", "Em7(5-)"], " [Refrão Final]")}
${div(["Fm7", "Bb7", "Cm7"])}
${div(["C7", "Fm7"])}
${div(["Bb7", "Cm7"])}
${div(["C7", "Fm7"])}
${div(["Bb7"])}
${div(["Cm7", "A°"])}
${div(["Fm7"])}
${div(["Gm7"])}
</pre>`;

function show(chart) {
  return chart.sections.map((section) => ({
    label: section.label,
    bars: section.measures.map((measure) => `${measure.repeat ? `${measure.repeat}:` : ""}${formatCell(measure.chords)}`),
  }));
}

test("rejeita link que não é uma cifra", () => {
  assert.equal(isCifraClubUrl("https://www.cifraclub.com.br/olivia-dean/so-easy-to-fall-in-love/"), true);
  assert.equal(isCifraClubUrl("https://www.cifraclub.com.br/olivia-dean/so-easy-to-fall-in-love/simplificada.html"), true);
  assert.equal(cifraClubUrl("www.cifraclub.com.br/olivia-dean/so-easy-to-fall-in-love/"), "https://www.cifraclub.com.br/olivia-dean/so-easy-to-fall-in-love/");
  assert.equal(cifraClubUrl("http://cifraclub.com.br/olivia-dean/so-easy-to-fall-in-love/"), "https://www.cifraclub.com.br/olivia-dean/so-easy-to-fall-in-love/");
  assert.equal(isCifraClubUrl("https://www.cifraclub.com.br/olivia-dean/so-easy-to-fall-in-love/letra/"), false);
  assert.equal(isCifraClubUrl("https://example.com/olivia-dean/so-easy"), false);
  assert.equal(pastedCifraLink("veja www.cifraclub.com.br/olivia-dean/so-easy-to-fall-in-love/."), "https://www.cifraclub.com.br/olivia-dean/so-easy-to-fall-in-love/");
});

test("três acordes ocupam dois compassos e um par conhecido se junta", () => {
  assert.deepEqual(linesToBars([["Bb7sus4", "Ebmaj7", "Em7b5"]]), [["Bb7sus4"], ["Ebmaj7", "Em7b5"]]);
  assert.deepEqual(
    linesToBars([["Ebmaj7", "Em7b5"], ["Ebmaj7"], ["Em7b5"]]),
    [["Ebmaj7", "Em7b5"], ["Ebmaj7", "Em7b5"]],
  );
});

test("monta So Easy com a repetição em volta da parte e do refrão", () => {
  const chart = chartFromCifraHtml(soEasy);
  assert.equal(chart.title, "So Easy (To Fall In Love)");
  assert.equal(chart.key, "Eb");
  assert.equal(chart.composer, "Gang Wolf, John Henry Ryan, Olivia Dean e Amy Rose Allen");
  assert.equal(chart.notes.includes("Central Park"), false);
  assert.equal(chart.notes.includes("A repetição toca a Parte e o Refrão duas vezes."), true);
  assert.equal(chart.notes.includes("o 4º compasso fica só em EbΔ7"), true);
  const shown = show(chart);
  assert.deepEqual(shown.map((section) => [section.label, section.bars.length]), [
    ["Intro", 4],
    ["Parte", 8],
    ["Refrão", 8],
    ["Ponte", 8],
    ["Refrão final", 8],
  ]);
  assert.deepEqual(shown[0].bars, ["F-7 G-7", "F-7 G-7", "F-7 G-7", "F-7 G-7"]);
  assert.equal(shown[1].bars[0], "start:Bb7sus4");
  assert.equal(shown[1].bars[3], "EbΔ7 E-7b5");
  assert.equal(shown[1].bars[7], "EbΔ7");
  assert.equal(shown[2].bars[0], "E-7b5 F-7");
  assert.equal(shown[2].bars[7], "end:F-7 G-7");
  assert.equal(shown[2].bars.some((bar) => bar.startsWith("start:")), false);
  assert.equal(shown[3].bars[7], "EbΔ7 E-7b5");
  assert.equal(shown[4].bars[0], "F-7");
  assert.equal(shown[4].bars[1], "Bb7 C-7");
  assert.equal(shown[4].bars[7], "F-7 G-7");
  assert.equal(JSON.stringify(shown).includes("Central Park"), false);
});

test("uma parte só não ganha repetição", () => {
  const html = `<h1>Samba de Teste</h1><p>Tom: C</p><pre>
  ${div(["C7M"], "", "[Intro] ")}
  ${div(["Dm7", "G7"], "", "[Parte] ")}
  ${div(["C7M"], "", "[Refrão] ")}
  </pre>`;
  const chart = chartFromCifraHtml(html);
  assert.deepEqual(show(chart).map((section) => [section.label, section.bars]), [
    ["Intro", ["CΔ7"]],
    ["Parte", ["D-7 G7"]],
    ["Refrão", ["CΔ7"]],
  ]);
  assert.equal(chart.notes.includes("repetição"), false);
});

test("lê acordes colados e ignora a letra", () => {
  const chart = chartFromCifraPlain(`Tom: Eb
[Intro] Fm7 Gm7
[Tab - Intro] Fm7 Gm7
uma frase qualquer
[Primeira Parte]
Bb7(4)
Eb7M Em7(5-) Central
[Refrão]
Fm7 Bb7`);
  const shown = show(chart);
  assert.equal(chart.key, "Eb");
  assert.deepEqual(shown.map((section) => section.label), ["Intro", "Parte", "Refrão"]);
  assert.deepEqual(shown[0].bars, ["F-7 G-7", "F-7 G-7", "F-7 G-7", "F-7 G-7"]);
  assert.equal(shown[1].bars[0], "Bb7sus4");
  assert.equal(shown[1].bars[1], "EbΔ7 E-7b5");
  assert.equal(shown[2].bars[0], "F-7 Bb7");
  assert.equal(JSON.stringify(shown).includes("Central"), false);
  assert.equal(JSON.stringify(shown).includes("frase"), false);
});
