import test from "node:test";
import assert from "node:assert/strict";
import {
  composeChartRows,
  composePageSpread,
  getChartPageCount,
  normalizeSpreadPage,
  paginateChart,
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

function measureIds(pages) {
  return pages.flatMap((page) => page.sections.flatMap((section) => section.rows.flatMap((row) => row.measures.map((measure) => measure.id))));
}

test("composeChartRows preserva ordem e cria linhas conforme barsPerRow", () => {
  const chart = song([5, 3], 4);
  const rows = composeChartRows(chart);

  assert.deepEqual(rows.map((row) => row.measures.map((measure) => measure.id)), [
    ["measure-1", "measure-2", "measure-3", "measure-4"],
    ["measure-5"],
    ["measure-6", "measure-7", "measure-8"],
  ]);
  assert.deepEqual(rows.map((row) => row.startsSection), [true, false, true]);
});

test("composeChartRows aceita perfis de 2, 4 e 8 compassos por linha", () => {
  const chart = song([8]);
  assert.equal(composeChartRows(chart, { barsPerRow: 2 }).length, 4);
  assert.equal(composeChartRows(chart, { barsPerRow: 4 }).length, 2);
  assert.equal(composeChartRows(chart, { barsPerRow: 8 }).length, 1);
});

test("paginateChart mantém título de seção no mesmo fragmento da primeira linha", () => {
  const pages = paginateChart(song([4, 4]), { rowsPerPage: 1 });

  assert.equal(pages.length, 2);
  assert.equal(pages[0].sections[0].label, "Seção 1");
  assert.equal(pages[0].sections[0].rows[0].startsSection, true);
  assert.equal(pages[1].sections[0].label, "Seção 2");
  assert.equal(pages[1].sections[0].rows[0].startsSection, true);
});

test("seções legadas sem id permanecem separadas", () => {
  const chart = song([4, 4]);
  delete chart.sections[0].id;
  delete chart.sections[1].id;

  const [page] = paginateChart(chart, { rowsPerPage: 8 });

  assert.deepEqual(page.sections.map((section) => section.sectionId), ["section-1", "section-2"]);
});

test("paginateChart marca continuação quando uma seção atravessa a página", () => {
  const pages = paginateChart(song([12]), { rowsPerPage: 2 });

  assert.equal(pages.length, 2);
  assert.equal(pages[0].sections[0].continued, false);
  assert.equal(pages[1].sections[0].continued, true);
  assert.equal(pages[1].sections[0].label, "Seção 1");
});

test("paginateChart cria uma página vazia para cifra sem linhas", () => {
  assert.deepEqual(paginateChart({ sections: [] }), [{ index: 1, rowCount: 0, layoutUnits: 0, sections: [] }]);
  assert.equal(getChartPageCount(null), 1);
});

test("cifra curta e cifra no limite permanecem em uma página", () => {
  assert.equal(getChartPageCount(song([28], 4), { rowsPerPage: 8 }), 1);
  assert.equal(getChartPageCount(song([32], 4), { rowsPerPage: 8 }), 1);
});

test("títulos de seção consomem orçamento vertical", () => {
  const pages = paginateChart(song([4, 4, 4, 4]), { rowsPerPage: 3 });

  assert.deepEqual(pages.map((page) => page.layoutUnits), [5, 5]);
  assert.deepEqual(pages.map((page) => page.rowCount), [2, 2]);
});

test("seção inteira vai para a próxima página quando o corte é evitável", () => {
  const pages = paginateChart(song([8, 8], 4), { rowsPerPage: 3 });

  assert.deepEqual(pages.map((page) => page.rowCount), [2, 2]);
  assert.equal(pages[1].sections[0].continued, false);
});

test("paginação de 16 linhas produz duas páginas de 8", () => {
  const chart = song([64], 4);
  const pages = paginateChart(chart, { rowsPerPage: 8 });

  assert.deepEqual(pages.map((page) => page.rowCount), [8, 8]);
  assert.equal(getChartPageCount(chart, { rowsPerPage: 8 }), 2);
});

test("recompor as páginas preserva toda a sequência musical", () => {
  const chart = song([5, 11, 4], 4);
  const original = chart.sections.flatMap((section) => section.measures.map((measure) => measure.id));
  const pages = paginateChart(chart, { rowsPerPage: 3 });

  assert.deepEqual(measureIds(pages), original);
});

test("compositor não altera a música recebida", () => {
  const chart = song([9], 4);
  const before = structuredClone(chart);

  paginateChart(chart, { barsPerRow: 2, rowsPerPage: 2 });

  assert.deepEqual(chart, before);
});

test("composePageSpread agrupa páginas em 1-up e 2-up", () => {
  const pages = paginateChart(song([48], 4), { rowsPerPage: 4 });

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
  assert.equal(mobileLandscape.rowsPerPage, 4);
  assert.equal(tabletPortrait.pageSpan, 1);

  assert.equal(tabletLandscape.pageSpan, 2);
  assert.ok(tabletLandscape.usableSheetWidth >= tabletLandscape.minSheetWidth);

  assert.equal(notebook1366.pageSpan, 2);
  assert.ok(notebook1366.usableSheetWidth >= notebook1366.minSheetWidth);

  assert.equal(notebook1440.pageSpan, 2);
  assert.ok(notebook1440.usableSheetWidth >= notebook1440.minSheetWidth);

  // Quando a barra é meia (8 compassos por linha), o piso de largura útil por folha sobe para 560px
  const denseTablet = resolveReadingLayoutProfile({ viewportWidth: 1024, viewportHeight: 768, barsPerRow: 8 });
  assert.equal(denseTablet.pageSpan, 1);
});

test("normalizeSpreadPage normaliza posição ao alternar entre 1-up e 2-up e permite última dupla incompleta", () => {
  assert.equal(normalizeSpreadPage(2, 3, 2), 1);
  assert.equal(normalizeSpreadPage(3, 3, 2), 3);
  assert.equal(normalizeSpreadPage(4, 4, 2), 3);
  assert.equal(normalizeSpreadPage(2, 3, 1), 2);
});
