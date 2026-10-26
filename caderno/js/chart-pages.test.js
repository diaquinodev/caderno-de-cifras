import test from "node:test";
import assert from "node:assert/strict";
import {
  canUseCompactMeasure,
  composeChartLayout,
  composeReadingSpread,
  composeChartSystems,
  findChartPageByMeasureId,
  flattenChartMeasures,
  paginateChartSystems,
  normalizeReadingSpreadPage,
  resolveReadingLayoutProfile,
  resolveReadingPresentation,
  updateReadingZoomPreferences,
} from "./chart-pages.js";
import { transposeSections } from "./chords.js";

function song(sectionSizes, barsPerRow = 4) {
  let measureIndex = 0;
  return {
    barsPerRow,
    sections: sectionSizes.map((size, sectionIndex) => ({
      id: `section-${sectionIndex + 1}`,
      label: `Seção ${sectionIndex + 1}`,
      measures: Array.from({ length: size }, () => {
        measureIndex += 1;
        return { id: `measure-${measureIndex}`, chords: `C${measureIndex}` };
      }),
    })),
  };
}

function adaptiveMeasureIds(layout) {
  return layout.pages.flatMap((page) =>
    page.systems.flatMap((system) => system.placements.map((placement) => placement.atom.measureId))
  );
}

test("flattenChartMeasures preserva ordem e separa seções legadas com IDs repetidos", () => {
  const chart = song([2, 2]);
  chart.sections[0].id = "repetido";
  chart.sections[1].id = "repetido";

  const atoms = flattenChartMeasures(chart);

  assert.deepEqual(atoms.map((atom) => atom.measureId), ["measure-1", "measure-2", "measure-3", "measure-4"]);
  assert.deepEqual(atoms.map((atom) => atom.globalMeasureIndex), [1, 2, 3, 4]);
  assert.notEqual(atoms[0].sectionKey, atoms[2].sectionKey);
  assert.deepEqual(atoms.map((atom) => atom.startsSection), [true, false, true, false]);
});

test("composeChartSystems usa 16 células e mantém sistemas normais legíveis", () => {
  const atoms = flattenChartMeasures(song([6, 6]));
  const systems = composeChartSystems(atoms);

  assert.equal(systems.length, 3);
  assert.deepEqual(systems.map((system) => system.cellsUsed), [16, 16, 16]);
  assert.ok(systems.every((system) => system.cellsUsed <= 16));
  assert.deepEqual(
    systems[1].placements.map((placement) => [placement.atom.measureId, placement.atom.startsSection]),
    [["measure-5", false], ["measure-6", false], ["measure-7", true], ["measure-8", false]]
  );
});

test("compasso compacto exige exatamente um acorde curto sem repetição nem casa", () => {
  const chart = song([1]);
  const atom = flattenChartMeasures(chart)[0];

  atom.measure.chords = "Cmaj7";
  assert.equal(canUseCompactMeasure(atom), true);

  atom.measure.chords = "D-7(9) A-7(9)";
  assert.equal(canUseCompactMeasure(atom), false);

  atom.measure.chords = "Cmaj7(add9add13)";
  assert.equal(canUseCompactMeasure(atom), false);

  atom.measure.chords = "";
  assert.equal(canUseCompactMeasure(atom), false);

  atom.measure.chords = "C7";
  atom.measure.repeat = "start";
  assert.equal(canUseCompactMeasure(atom), false);
  atom.measure.repeat = "";
  atom.measure.ending = "1";
  assert.equal(canUseCompactMeasure(atom), false);
  atom.measure.ending = "";
  atom.measure.annotation = "Solo";
  assert.equal(canUseCompactMeasure(atom), false);
  atom.measure.annotation = "";
  assert.equal(canUseCompactMeasure(atom), true);
});

test("paginateChartSystems limita cada página a no máximo 12 sistemas", () => {
  const chart = song([52]);
  chart.sections[0].measures.forEach((measure) => { measure.chords = "C7 G7"; });
  const atoms = flattenChartMeasures(chart);
  const systems = composeChartSystems(atoms);
  const pages = paginateChartSystems(systems, { systemCapacity: 99, maxSystemsPerPage: 99 });

  assert.deepEqual(pages.map((page) => page.systemCount), [12, 1]);
  assert.ok(pages.every((page) => page.systemCount <= 12));
});

test("composeChartSystems decide densidade por sistema sem misturar larguras", () => {
  const chart = song([20]);
  chart.sections[0].measures.forEach((measure) => { measure.chords = "C7"; });
  chart.sections[0].measures.slice(8, 12).forEach((measure) => { measure.chords = "D-7(9) A-7(9)"; });

  const systems = composeChartSystems(flattenChartMeasures(chart));

  assert.deepEqual(systems.map((system) => system.density), ["compact", "normal", "compact"]);
  assert.deepEqual(systems.map((system) => system.placements.length), [8, 4, 8]);
  assert.deepEqual(systems.map((system) => system.cellsUsed), [16, 16, 16]);
  assert.deepEqual(
    systems.map((system) => [...new Set(system.placements.map((placement) => placement.cellSpan))]),
    [[2], [4], [2]]
  );
});

test("compacta apenas blocos completos de oito e protege mudanças de seção intermediárias", () => {
  const complete = song([8]);
  complete.sections[0].measures.forEach((measure) => { measure.chords = "C7"; });
  assert.deepEqual(composeChartSystems(flattenChartMeasures(complete)).map((system) => system.density), ["compact"]);

  const remainder = song([7]);
  remainder.sections[0].measures.forEach((measure) => { measure.chords = "C7"; });
  assert.deepEqual(composeChartSystems(flattenChartMeasures(remainder)).map((system) => system.density), ["normal", "normal"]);

  const sectionBoundary = song([2, 6]);
  sectionBoundary.sections.flatMap((section) => section.measures).forEach((measure) => { measure.chords = "C7"; });
  assert.deepEqual(composeChartSystems(flattenChartMeasures(sectionBoundary)).map((system) => system.density), ["normal", "normal"]);

  const sectionAtStart = song([8]);
  sectionAtStart.sections[0].measures.forEach((measure) => { measure.chords = "C7"; });
  assert.equal(composeChartSystems(flattenChartMeasures(sectionAtStart))[0].density, "compact");
});

test("layout adaptativo preserva integralmente a música e não altera a entrada", () => {
  const chart = song([5, 11, 4]);
  chart.sections[0].measures[0].repeat = "start";
  chart.sections[1].measures[4].repeat = "both";
  chart.sections[1].measures[4].ending = "1";
  chart.sections[2].measures.at(-1).ending = "2";
  const before = structuredClone(chart);
  const layout = composeChartLayout(chart, { systemCapacity: 3 });
  const originalMeasures = before.sections.flatMap((section) => section.measures);

  assert.deepEqual(adaptiveMeasureIds(layout), chart.sections.flatMap((section) => section.measures.map((measure) => measure.id)));
  assert.deepEqual(layout.atoms.map((atom) => atom.measure), originalMeasures);
  assert.deepEqual(chart, before);
  assert.ok(layout.systems.every((system) => new Set(system.placements.map((placement) => placement.cellSpan)).size === 1));
});

test("layout resume densidade mista e pagina sistemas inteiros sem forçar compactação", () => {
  const chart = song([20]);
  chart.sections[0].measures.forEach((measure) => { measure.chords = "C7"; });
  chart.sections[0].measures.slice(8, 12).forEach((measure) => { measure.chords = "D-7(9) A-7(9)"; });
  const layout = composeChartLayout(chart, { systemCapacity: 2 });

  assert.equal(layout.density, "mixed");
  assert.deepEqual(layout.pages.map((page) => page.systemCount), [2, 1]);
  assert.deepEqual(layout.pages.flatMap((page) => page.systems.map((system) => system.density)), ["compact", "normal", "compact"]);
});

test("findChartPageByMeasureId preserva a página do compasso âncora", () => {
  const chart = song([48]);
  chart.sections[0].measures.forEach((measure) => { measure.chords = "C7 G7"; });
  const pages = composeChartLayout(chart, { systemCapacity: 4 }).pages;

  assert.equal(findChartPageByMeasureId(pages, "measure-1"), 1);
  assert.equal(findChartPageByMeasureId(pages, "measure-17"), 2);
  assert.equal(findChartPageByMeasureId(pages, "measure-48"), 3);
  assert.equal(findChartPageByMeasureId(pages, "inexistente", 2), 2);
  assert.equal(findChartPageByMeasureId(pages, "inexistente", 99), 3);
});

test("resolveReadingLayoutProfile mantém uma superfície larga em todos os viewports", () => {
  const mobilePortrait = resolveReadingLayoutProfile({ viewportWidth: 390, viewportHeight: 844 });
  const mobileLandscape = resolveReadingLayoutProfile({ viewportWidth: 844, viewportHeight: 390 });
  const tabletPortrait = resolveReadingLayoutProfile({ viewportWidth: 768, viewportHeight: 1024 });
  const tabletLandscape = resolveReadingLayoutProfile({ viewportWidth: 1024, viewportHeight: 768 });
  const notebook1366 = resolveReadingLayoutProfile({ viewportWidth: 1366, viewportHeight: 768 });
  const notebook1440 = resolveReadingLayoutProfile({ viewportWidth: 1440, viewportHeight: 900 });

  assert.equal(mobilePortrait.pageSpan, 1);
  assert.equal(mobileLandscape.pageSpan, 1);
  assert.equal(mobileLandscape.systemCapacity, 4);
  assert.equal(tabletPortrait.pageSpan, 1);
  assert.equal(tabletLandscape.pageSpan, 1);
  assert.equal(notebook1366.pageSpan, 1);
  assert.equal(notebook1440.pageSpan, 1);
  assert.equal(tabletLandscape.cellsPerSystem, 16);
  assert.equal(tabletLandscape.usableHeight, 768);
  assert.equal(tabletLandscape.usableSheetWidth, 960);
  assert.equal(notebook1366.usableSheetWidth, 960);
  assert.equal(notebook1440.usableSheetWidth, 960);

  assert.ok(mobilePortrait.systemCapacity <= 12);
  assert.ok(tabletPortrait.systemCapacity <= 12);
});

test("resolveReadingPresentation mantém celular e tablet em uma folha e libera notebook largo", () => {
  const viewports = [
    { name: "celular retrato", width: 390, height: 844, expectedSpan: 1 },
    { name: "celular horizontal", width: 844, height: 390, expectedSpan: 1 },
    { name: "tablet retrato", width: 768, height: 1024, expectedSpan: 1 },
    { name: "tablet horizontal", width: 1024, height: 768, expectedSpan: 1 },
    { name: "notebook 1366", width: 1366, height: 768, expectedSpan: 2 },
    { name: "notebook 1440", width: 1440, height: 900, expectedSpan: 2 },
  ];

  for (const viewport of viewports) {
    const presentation = resolveReadingPresentation({
      viewportWidth: viewport.width,
      viewportHeight: viewport.height,
      totalPages: 4,
    });
    assert.equal(presentation.pageSpan, viewport.expectedSpan, viewport.name);
  }
});

test("resolveReadingPresentation limita o zoom manual e trata 67% como preferência, não zoom global", () => {
  const minimum = resolveReadingPresentation({
    viewportWidth: 1366,
    viewportHeight: 768,
    totalPages: 4,
    preferences: { zoomMode: "manual", zoomPercent: 10 },
  });
  const maximum = resolveReadingPresentation({
    viewportWidth: 1366,
    viewportHeight: 768,
    totalPages: 4,
    preferences: { zoomMode: "manual", zoomPercent: 999 },
  });
  const fit = resolveReadingPresentation({
    viewportWidth: 1366,
    viewportHeight: 768,
    totalPages: 4,
    preferences: { zoomMode: "fit", zoomPercent: 67 },
  });

  assert.equal(minimum.zoomPercent, 67);
  assert.equal(maximum.zoomPercent, 150);
  assert.equal(maximum.pageSpan, 1);
  assert.equal(maximum.fallbackReason, "spread-overflow");
  assert.equal(fit.zoomPercent, 100);
});

test("updateReadingZoomPreferences aplica passos, limites e Ajustar idempotente sem persistência", () => {
  let preferences = updateReadingZoomPreferences({}, "decrease", 100);
  assert.deepEqual(preferences, { spreadMode: "auto", zoomMode: "manual", zoomPercent: 90 });

  for (let index = 0; index < 10; index += 1) {
    preferences = updateReadingZoomPreferences(preferences, "decrease", preferences.zoomPercent);
  }
  assert.equal(preferences.zoomPercent, 67);

  for (let index = 0; index < 20; index += 1) {
    preferences = updateReadingZoomPreferences(preferences, "increase", preferences.zoomPercent);
  }
  assert.equal(preferences.zoomPercent, 150);

  const fit = updateReadingZoomPreferences(preferences, "fit", preferences.zoomPercent);
  assert.deepEqual(fit, { spreadMode: "auto", zoomMode: "fit", zoomPercent: 100 });
  assert.deepEqual(updateReadingZoomPreferences(fit, "fit", 100), fit);
});

test("resolveReadingPresentation usa uma folha para cifra curta e preserva spread em paginação ímpar", () => {
  const shortChart = resolveReadingPresentation({
    viewportWidth: 1440,
    viewportHeight: 900,
    totalPages: 1,
  });
  const oddLastPage = resolveReadingPresentation({
    viewportWidth: 1440,
    viewportHeight: 900,
    totalPages: 3,
  });

  assert.equal(shortChart.pageSpan, 1);
  assert.equal(shortChart.fallbackReason, "single-page");
  assert.equal(oddLastPage.pageSpan, 2);
  assert.equal(oddLastPage.fallbackReason, null);
});

test("resolveReadingPresentation respeita escolha de uma folha e recua quando o spread fica ilegível", () => {
  const forcedSingle = resolveReadingPresentation({
    viewportWidth: 1440,
    viewportHeight: 900,
    totalPages: 4,
    preferences: { spreadMode: "single" },
  });
  const illegibleSpread = resolveReadingPresentation({
    viewportWidth: 1366,
    viewportHeight: 768,
    totalPages: 4,
    minSheetWidth: 500,
    preferences: { spreadMode: "spread", zoomMode: "manual", zoomPercent: 67 },
  });

  assert.equal(forcedSingle.pageSpan, 1);
  assert.equal(forcedSingle.fallbackReason, "forced-single");
  assert.equal(illegibleSpread.pageSpan, 1);
  assert.equal(illegibleSpread.fallbackReason, "sheet-too-narrow");
  assert.ok(illegibleSpread.sheetWidth >= 280);
});

test("resolveReadingPresentation nunca devolve duas folhas maiores que a largura disponível", () => {
  for (const viewportWidth of [1200, 1366]) {
    const presentation = resolveReadingPresentation({
      viewportWidth,
      viewportHeight: 700,
      totalPages: 4,
      preferences: { spreadMode: "spread", zoomMode: "manual", zoomPercent: 150 },
    });

    assert.equal(presentation.pageSpan, 1);
    assert.equal(presentation.fallbackReason, "spread-overflow");
  }
});

test("composeReadingSpread mantém ordem nas duplas inicial, intermediária e final", () => {
  const pages = Array.from({ length: 6 }, (_, index) => ({
    index: index + 1,
    systemCount: 0,
    systems: [],
  }));

  assert.deepEqual(composeReadingSpread(pages, 1, 2).visiblePages.map((page) => page.index), [1, 2]);
  assert.deepEqual(composeReadingSpread(pages, 4, 2).visiblePages.map((page) => page.index), [3, 4]);
  assert.deepEqual(composeReadingSpread(pages, 6, { pageSpan: 2 }).visiblePages.map((page) => page.index), [5, 6]);
});

test("composeReadingSpread preserva a última página ímpar e normaliza a troca 1↔2 folhas", () => {
  const pages = Array.from({ length: 5 }, (_, index) => ({
    index: index + 1,
    systemCount: 0,
    systems: [],
  }));

  assert.equal(normalizeReadingSpreadPage(2, 5, 2), 1);
  assert.equal(normalizeReadingSpreadPage(5, 5, 2), 5);
  assert.equal(normalizeReadingSpreadPage(2, 5, 1), 2);
  assert.deepEqual(composeReadingSpread(pages, 5, 2).visiblePages.map((page) => page.index), [5]);
});

test("fase 6 / item 62: compasso anotado impede compactação e transposição preserva anotação", () => {
  const chart = song([8]);
  chart.sections[0].measures.forEach((measure) => {
    measure.chords = "C7";
  });
  // Bloco de 8 sem anotação pode ser compactado
  const normalSystems = composeChartSystems(flattenChartMeasures(chart));
  assert.equal(normalSystems[0].density, "compact");

  // Adiciona anotação a um dos compassos -> impede compactação e mantém densidade normal (4 compassos por linha)
  chart.sections[0].measures[2].annotation = "Breque";
  const systemsWithAnnotation = composeChartSystems(flattenChartMeasures(chart));
  assert.equal(systemsWithAnnotation[0].density, "normal");
  assert.equal(systemsWithAnnotation[0].placements.length, 4);

  // Transposição de tom preserva o campo annotation intacto
  const transposed = transposeSections(chart.sections, "C", "F");
  assert.equal(transposed[0].measures[2].chords, "F7");
  assert.equal(transposed[0].measures[2].annotation, "Breque");
});

