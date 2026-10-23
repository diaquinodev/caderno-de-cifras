import test from "node:test";
import assert from "node:assert/strict";
import {
  canUseCompactDensity,
  composeChartLayout,
  composePageSpread,
  composeChartSystems,
  flattenChartMeasures,
  normalizeSpreadPage,
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

test("composeChartSystems usa 16 células sem reiniciar na troca de seção", () => {
  const atoms = flattenChartMeasures(song([6, 6]));
  const systems = composeChartSystems(atoms, "normal");

  assert.equal(systems.length, 3);
  assert.deepEqual(systems.map((system) => system.cellsUsed), [16, 16, 16]);
  assert.ok(systems.every((system) => system.cellsUsed <= 16));
  assert.deepEqual(
    systems[1].placements.map((placement) => [placement.atom.measureId, placement.atom.startsSection]),
    [["measure-5", false], ["measure-6", false], ["measure-7", true], ["measure-8", false]]
  );
});

test("densidade compacta aceita até dois acordes curtos e recusa compassos densos ou rótulos longos", () => {
  const eligible = song([4]);
  eligible.sections[0].measures[0].chords = "Cmaj7 G7";
  assert.equal(canUseCompactDensity(flattenChartMeasures(eligible)), true);

  const threeChords = structuredClone(eligible);
  threeChords.sections[0].measures[0].chords = "Cmaj7 Dm7 G7";
  assert.equal(canUseCompactDensity(flattenChartMeasures(threeChords)), false);

  const longChord = structuredClone(eligible);
  longChord.sections[0].measures[0].chords = "Cmaj7(add9add13)";
  assert.equal(canUseCompactDensity(flattenChartMeasures(longChord)), false);
});

test("paginateChartSystems limita cada página a no máximo 12 sistemas", () => {
  const atoms = flattenChartMeasures(song([52]));
  const systems = composeChartSystems(atoms, "normal");
  const pages = paginateChartSystems(systems, { systemCapacity: 99, maxSystemsPerPage: 99 });

  assert.deepEqual(pages.map((page) => page.systemCount), [12, 1]);
  assert.ok(pages.every((page) => page.systemCount <= 12));
});

test("composeChartLayout mantém normal até 48 compassos e compacta 49 e 96 elegíveis", () => {
  const normal = composeChartLayout(song([48]));
  const compact49 = composeChartLayout(song([49]));
  const compact96 = composeChartLayout(song([96]));
  const compact97 = composeChartLayout(song([97]));

  assert.equal(normal.density, "normal");
  assert.equal(normal.totalSystems, 12);
  assert.equal(normal.pages.length, 1);
  assert.equal(compact49.density, "compact");
  assert.equal(compact49.totalSystems, 7);
  assert.equal(compact49.pages.length, 1);
  assert.equal(compact96.density, "compact");
  assert.equal(compact96.totalSystems, 12);
  assert.equal(compact96.pages.length, 1);
  assert.equal(compact97.density, "compact");
  assert.equal(compact97.totalSystems, 13);
  assert.deepEqual(compact97.pages.map((page) => page.systemCount), [12, 1]);
});

test("composeChartLayout respeita capacidade menor, preferência explícita e fallback de legibilidade", () => {
  const chart = song([40]);
  const auto = composeChartLayout(chart, { systemCapacity: 6 });
  const forcedNormal = composeChartLayout(chart, { systemCapacity: 6, density: "normal" });

  assert.equal(auto.density, "compact");
  assert.equal(auto.pages.length, 1);
  assert.equal(forcedNormal.density, "normal");
  assert.equal(forcedNormal.pages.length, 2);

  chart.sections[0].measures[0].chords = "Cmaj7 Dm7 G7";
  const ineligible = composeChartLayout(chart, { systemCapacity: 6, density: "compact" });
  assert.equal(ineligible.compactEligible, false);
  assert.equal(ineligible.density, "normal");
  assert.equal(ineligible.pages.length, 2);
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
});

test("grade musical mantém 16 células em qualquer densidade", () => {
  const atoms = flattenChartMeasures(song([12]));
  const normal = composeChartSystems(atoms, "normal");
  const compact = composeChartSystems(atoms, "compact");

  assert.ok(normal.every((system) => system.cellsUsed <= 16));
  assert.ok(compact.every((system) => system.cellsUsed <= 16));
  assert.ok(normal.flatMap((system) => system.placements).every((placement) => placement.cellSpan === 4));
  assert.ok(compact.flatMap((system) => system.placements).every((placement) => placement.cellSpan === 2));
});

test("composePageSpread agrupa páginas em 1-up e 2-up", () => {
  const pages = composeChartLayout(song([48]), { systemCapacity: 4, density: "normal" }).pages;

  assert.deepEqual(composePageSpread(pages, 2, 1).visiblePages.map((page) => page.index), [2]);
  assert.deepEqual(composePageSpread(pages, 2, 2).visiblePages.map((page) => page.index), [1, 2]);
  assert.deepEqual(composePageSpread(pages, 3, { pageSpan: 2 }).visiblePages.map((page) => page.index), [3]);
});

test("resolveReadingLayoutProfile usa largura útil de cada folha e mantém 1-up em celular e retrato", () => {
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

  assert.equal(tabletLandscape.pageSpan, 2);
  assert.ok(tabletLandscape.usableSheetWidth >= tabletLandscape.minSheetWidth);

  assert.equal(notebook1366.pageSpan, 2);
  assert.ok(notebook1366.usableSheetWidth >= notebook1366.minSheetWidth);

  assert.equal(notebook1440.pageSpan, 2);
  assert.ok(notebook1440.usableSheetWidth >= notebook1440.minSheetWidth);

  assert.ok(mobilePortrait.systemCapacity <= 12);
  assert.ok(tabletPortrait.systemCapacity <= 12);
});

test("normalizeSpreadPage normaliza posição ao alternar entre 1-up e 2-up e permite última dupla incompleta", () => {
  assert.equal(normalizeSpreadPage(2, 3, 2), 1);
  assert.equal(normalizeSpreadPage(3, 3, 2), 3);
  assert.equal(normalizeSpreadPage(4, 4, 2), 3);
  assert.equal(normalizeSpreadPage(2, 3, 1), 2);
});
