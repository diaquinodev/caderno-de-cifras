import test from "node:test";
import assert from "node:assert/strict";
import {
  parseCifraSource,
  parseCifraPlainSource,
  parseCifraHtmlSource,
  evaluateChordToken,
  isTabLine,
  detectBlockKind,
  verifyCifraSourceInvariants,
} from "./source.js";
import {
  FIXTURE_SO_EASY,
  FIXTURE_WHATS_GOING_ON,
  FIXTURE_REU_CONFESSO,
  FIXTURE_AGUAS_DE_MARCO,
  FIXTURE_GAROTA_DE_IPANEMA,
  FIXTURE_SAMBA_DE_UMA_NOTA_SO,
  ALL_SIX_FIXTURES,
} from "./fixtures/cifras.js";

test("evaluateChordToken identifica acordes validos e rejeita tokens invalidos com motivo", () => {
  const c7m = evaluateChordToken("C7M");
  assert.ok(c7m.chord);
  assert.equal(c7m.chord.raw, "C7M");
  assert.equal(c7m.chord.normalized, "Cmaj7");

  const fsharp = evaluateChordToken("F#m7(5-)");
  assert.ok(fsharp.chord);
  assert.equal(fsharp.chord.raw, "F#m7(5-)");
  assert.equal(fsharp.chord.normalized, "F#m7b5");

  const slash = evaluateChordToken("Bb/D");
  assert.ok(slash.chord);
  assert.equal(slash.chord.raw, "Bb/D");
  assert.equal(slash.chord.normalized, "Bb/D");

  const numericSlash = evaluateChordToken("E7(4/9)");
  assert.ok(numericSlash.chord);
  assert.equal(numericSlash.chord.raw, "E7(4/9)");

  const numericSlashWithBass = evaluateChordToken("G7(9/11)/B");
  assert.ok(numericSlashWithBass.chord);
  assert.equal(numericSlashWithBass.chord.raw, "G7(9/11)/B");

  const word = evaluateChordToken("Amor");
  assert.equal(word.chord, null);
  assert.ok(word.reason);

  const invalidSlash = evaluateChordToken("C/X");
  assert.equal(invalidSlash.chord, null);
  assert.ok(invalidSlash.reason);

  assert.equal(evaluateChordToken("C//G").chord, null);
  assert.equal(evaluateChordToken("E7(4/x)").chord, null);
});

test("isTabLine identifica linhas de tablatura de guitarra sem confundir com acordes", () => {
  assert.equal(isTabLine("e|---5---5---5---5---|"), true);
  assert.equal(isTabLine("B|---5---5---5---5---|"), true);
  assert.equal(isTabLine("C G/B Am F"), false);
  assert.equal(isTabLine("Título: Águas de Março"), false);
});

test("detectBlockKind classifica seções, tablaturas e anônimos", () => {
  assert.equal(detectBlockKind("Intro"), "section");
  assert.equal(detectBlockKind("Refrão"), "section");
  assert.equal(detectBlockKind("Tab - Intro"), "tab");
  assert.equal(detectBlockKind("Tablatura Solo"), "tab");
  assert.equal(detectBlockKind(null), "anonymous");
});

test("todas as seis fixtures atendem aos invariantes de CifraSource", () => {
  for (const fixture of ALL_SIX_FIXTURES) {
    const source = parseCifraSource(fixture.raw);
    const result = verifyCifraSourceInvariants(source);
    assert.equal(
      result.valid,
      true,
      `Invariante falhou na fixture ${fixture.name}: ${result.errors.join("; ")}`
    );
    assert.equal(source.blocks.length, fixture.expectedBlocks, `Número de blocos incorreto em ${fixture.name}`);
    assert.ok(source.allChords.length > 0, `Nenhum acorde encontrado em ${fixture.name}`);
  }
});

test("caso 1: So Easy (To Fall In Love) preserva ordem literal de acordes e metadados", () => {
  const source = parseCifraPlainSource(FIXTURE_SO_EASY);
  assert.equal(source.metadata.title, "So Easy (To Fall In Love)");
  assert.equal(source.metadata.key, "C");
  assert.equal(source.blocks.length, 3);
  assert.equal(source.blocks[0].label, "Intro");
  assert.equal(source.blocks[1].label, "Primeira Parte");
  assert.equal(source.blocks[2].label, "Refrão");

  // Primeiro e último acorde
  assert.equal(source.allChords[0].raw, "C");
  assert.equal(source.allChords[source.allChords.length - 1].raw, "C");
});

test("caso 2: What's Going On preserva acordes ricos e compositores múltiplos", () => {
  const source = parseCifraPlainSource(FIXTURE_WHATS_GOING_ON);
  assert.equal(source.metadata.title, "What's Going On");
  assert.equal(source.metadata.key, "E");
  assert.equal(source.metadata.composer, "Marvin Gaye / Al Cleveland / Renaldo Benson");
  assert.equal(source.blocks.length, 4);

  const rawChords = source.allChords.map((c) => c.raw);
  assert.ok(rawChords.includes("E7M"));
  assert.ok(rawChords.includes("B7(9)"));
  assert.ok(rawChords.includes("A/B"));
});

test("caso 3: Réu Confesso preserva progressão soul de Tim Maia", () => {
  const source = parseCifraPlainSource(FIXTURE_REU_CONFESSO);
  assert.equal(source.metadata.title, "Réu Confesso");
  assert.equal(source.metadata.key, "A");
  assert.equal(source.blocks.length, 3);

  const rawChords = source.allChords.map((c) => c.raw);
  assert.ok(rawChords.includes("A7M"));
  assert.ok(rawChords.includes("F#m7"));
  assert.ok(rawChords.includes("E7(9)"));
});

test("caso 4: Águas de Março gera bloco anônimo válido sem tags de seção", () => {
  const source = parseCifraPlainSource(FIXTURE_AGUAS_DE_MARCO);
  assert.equal(source.metadata.title, "Águas de Março");
  assert.equal(source.metadata.key, "Bb");
  assert.equal(source.blocks.length, 1);

  // Bloco deve ser anônimo
  const anonBlock = source.blocks[0];
  assert.equal(anonBlock.kind, "anonymous");
  assert.equal(anonBlock.label, null);

  // Todos os 17 acordes da progressão devem estar presentes
  assert.equal(source.allChords.length, 19);
  assert.equal(source.allChords[0].raw, "Bb");
  assert.equal(source.allChords[source.allChords.length - 1].raw, "Bb");
});

test("caso 5: Garota de Ipanema preserva acordes alterados e tensões", () => {
  const source = parseCifraPlainSource(FIXTURE_GAROTA_DE_IPANEMA);
  assert.equal(source.metadata.title, "Garota de Ipanema");
  assert.equal(source.metadata.key, "F");
  assert.equal(source.blocks.length, 3);

  const rawChords = source.allChords.map((c) => c.raw);
  assert.ok(rawChords.includes("Gb7(11#)"));
  assert.ok(rawChords.includes("C7(9-)"));
});

test("caso 6: Samba de Uma Nota Só identifica e preserva tablatura sem desaparecer", () => {
  const source = parseCifraPlainSource(FIXTURE_SAMBA_DE_UMA_NOTA_SO);
  assert.equal(source.metadata.title, "Samba de Uma Nota Só");
  assert.equal(source.metadata.key, "D");
  assert.equal(source.blocks.length, 3);

  // Primeiro bloco é tablatura
  const tabBlock = source.blocks[0];
  assert.equal(tabBlock.label, "Tab - Intro");
  assert.equal(tabBlock.kind, "tab");
  assert.ok(tabBlock.lines.some((l) => l.type === "tab"));

  // Blocos seguintes contêm os acordes preservados
  const part1 = source.blocks[1];
  assert.equal(part1.label, "Primeira Parte");
  assert.equal(part1.kind, "section");
  assert.ok(part1.lines.some((l) => l.type === "chords"));

  const rawChords = source.allChords.map((c) => c.raw);
  assert.ok(rawChords.includes("Dm7"));
  assert.ok(rawChords.includes("A7(13-)"));
});

test("parseCifraHtmlSource extrai metadados e acordes de HTML do Cifra Club", () => {
  const mockHtml = `
    <html>
      <body>
        <h1 class="t1">Garota de Ipanema</h1>
        <h2 class="t3">Tom Jobim</h2>
        <span id="cifra_tom"><a>F</a></span>
        <pre>
[Intro]
<b data-chord-name="F7M">F7M</b> <b data-chord-name="G7">G7</b>
[Primeira Parte]
<b data-chord-name="Gm7">Gm7</b> <b data-chord-name="Gb7">Gb7</b>
        </pre>
      </body>
    </html>
  `;

  const source = parseCifraHtmlSource(mockHtml, "https://www.cifraclub.com.br/tom-jobim/garota-de-ipanema/");
  assert.equal(source.metadata.title, "Garota de Ipanema");
  assert.equal(source.metadata.artist, "Tom Jobim");
  assert.equal(source.metadata.key, "F");
  assert.equal(source.metadata.url, "https://www.cifraclub.com.br/tom-jobim/garota-de-ipanema/");

  assert.equal(source.blocks.length, 2);
  assert.equal(source.blocks[0].label, "Intro");
  assert.equal(source.blocks[1].label, "Primeira Parte");

  assert.equal(source.allChords.length, 4);
  assert.equal(source.allChords[0].raw, "F7M");
  assert.equal(source.allChords[0].normalized, "Fmaj7");

  const inv = verifyCifraSourceInvariants(source);
  assert.equal(inv.valid, true);
});
