import test from "node:test";
import assert from "node:assert/strict";
import {
  canUseCompactMeasure,
  composeChartLayout,
  composeChartSystems,
  findChartPageByMeasureId,
  flattenChartMeasures,
  paginateChartSystems,
  resolveReadingLayoutProfile,
} from "./chart-pages.js";

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
