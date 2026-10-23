/**
 * @typedef {Object} ChartRow
 * @property {string} sectionId
 * @property {string} sectionLabel
 * @property {number} rowIndex
 * @property {boolean} startsSection
 * @property {number} measureStart
 * @property {any[]} measures
 */

/**
 * @typedef {Object} ChartPageSection
 * @property {string} sectionId
 * @property {string} label
 * @property {boolean} continued
 * @property {ChartRow[]} rows
 */

/**
 * @typedef {Object} ChartLayoutProfile
 * @property {number} [barsPerRow]
 * @property {number} [rowsPerPage]
 * @property {number} [pageSpan]
 * @property {number} [rowUnits]
 * @property {number} [sectionHeaderUnits]
 * @property {number} [pageUnits]
 */

/**
 * @typedef {Object} ChartPage
 * @property {number} index
 * @property {number} rowCount
 * @property {number} layoutUnits
 * @property {ChartPageSection[]} sections
 */

/**
 * Converte as seções da música em linhas musicais indivisíveis.
 * A função preserva a ordem e não altera a música recebida.
 *
 * @param {any} song
 * @param {Object} [profile]
 * @param {number} [profile.barsPerRow]
 * @returns {ChartRow[]}
 */
export function composeChartRows(song, { barsPerRow } = {}) {
  const columns = positiveInteger(barsPerRow, positiveInteger(song?.barsPerRow, 4));
  const sections = Array.isArray(song?.sections) ? song.sections : [];
  const rows = [];

  for (const [sectionIndex, section] of sections.entries()) {
    const measures = Array.isArray(section?.measures) ? section.measures : [];
    for (let start = 0, rowIndex = 0; start < measures.length; start += columns, rowIndex += 1) {
      rows.push({
        sectionId: String(section?.id || `section-${sectionIndex + 1}`),
        sectionLabel: String(section?.label || ""),
        rowIndex,
        startsSection: rowIndex === 0,
        measureStart: start,
        measures: measures.slice(start, start + columns),
      });
    }
  }

  return rows;
}

/**
 * Compõe páginas sem cortar uma linha musical. Se uma seção atravessa uma
 * página, o fragmento seguinte é marcado como continuação.
 *
 * @param {any} song
 * @param {Object} [profile]
 * @param {number} [profile.barsPerRow]
 * @param {number} [profile.rowsPerPage]
 * @param {number} [profile.rowUnits]
 * @param {number} [profile.sectionHeaderUnits]
 * @param {number} [profile.pageUnits]
 * @returns {ChartPage[]}
 */
export function paginateChart(song, {
  barsPerRow,
  rowsPerPage,
  rowUnits,
  sectionHeaderUnits,
  pageUnits,
} = {}) {
  const rows = composeChartRows(song, { barsPerRow });
  const rowCost = positiveInteger(rowUnits, 2);
  const headerCost = nonNegativeInteger(sectionHeaderUnits, 1);
  const capacity = positiveInteger(pageUnits, positiveInteger(rowsPerPage, 8) * rowCost);
  if (rows.length === 0) return [{ index: 1, rowCount: 0, layoutUnits: 0, sections: [] }];

  const pages = [];
  let pageRows = [];
  let usedUnits = 0;

  const flushPage = () => {
    if (pageRows.length === 0) return;
    pages.push(createPage(pages.length + 1, pageRows, usedUnits));
    pageRows = [];
    usedUnits = 0;
  };

  for (const sectionRows of groupRowsBySection(rows)) {
    const namedHeaderCost = sectionRows[0].sectionLabel.trim().length > 1 ? headerCost : 0;
    const freshSectionCost = sectionRows.length * rowCost;
    const inlineSectionCost = namedHeaderCost + freshSectionCost;

    if (pageRows.length > 0 && freshSectionCost <= capacity && usedUnits + inlineSectionCost > capacity) {
      flushPage();
    }

    for (const row of sectionRows) {
      const startsAdditionalSection = pageRows.length > 0 && pageRows.at(-1)?.sectionId !== row.sectionId;
      let nextCost = rowCost + (startsAdditionalSection ? namedHeaderCost : 0);
      if (pageRows.length > 0 && usedUnits + nextCost > capacity) {
        flushPage();
        nextCost = rowCost;
      }
      pageRows.push(row);
      usedUnits += nextCost;
    }
  }
  flushPage();
  return pages;
}

/**
 * @param {any} song
 * @param {Object} [profile]
 * @param {number} [profile.barsPerRow]
 * @param {number} [profile.rowsPerPage]
 * @returns {number}
 */
export function getChartPageCount(song, profile = {}) {
  return paginateChart(song, profile).length;
}

/**
 * Agrupa páginas já compostas em uma folha simples ou dupla.
 *
 * @param {ChartPage[]} pages
 * @param {number} [activePage]
 * @param {number | ChartLayoutProfile} [spanOrProfile]
 * @returns {{ firstPage: number, pageSpan: number, visiblePages: ChartPage[] }}
 */
export function composePageSpread(pages, activePage = 1, spanOrProfile = 1) {
  const safePages = Array.isArray(pages) ? pages : [];
  const rawSpan = typeof spanOrProfile === "object" && spanOrProfile !== null
    ? spanOrProfile.pageSpan
    : spanOrProfile;
  const span = Math.min(2, positiveInteger(rawSpan, 1));
  const total = Math.max(1, safePages.length);
  const active = Math.min(total, positiveInteger(activePage, 1));
  const firstPage = Math.floor((active - 1) / span) * span + 1;
  return {
    firstPage,
    pageSpan: span,
    visiblePages: safePages.slice(firstPage - 1, firstPage - 1 + span),
  };
}

function createPage(index, rows, layoutUnits) {
  return {
    index,
    rowCount: rows.length,
    layoutUnits,
    sections: groupPageSections(rows),
  };
}

function groupRowsBySection(rows) {
  const groups = [];
  for (const row of rows) {
    const current = groups.at(-1);
    if (!current || current[0].sectionId !== row.sectionId) groups.push([row]);
    else current.push(row);
  }
  return groups;
}

/**
 * @param {ChartRow[]} rows
 * @returns {ChartPageSection[]}
 */
function groupPageSections(rows) {
  const fragments = [];
  for (const row of rows) {
    const current = fragments.at(-1);
    if (!current || current.sectionId !== row.sectionId) {
      fragments.push({
        sectionId: row.sectionId,
        label: row.sectionLabel,
        continued: !row.startsSection,
        rows: [row],
      });
    } else {
      current.rows.push(row);
    }
  }
  return fragments;
}

function positiveInteger(value, fallback) {
  const number = Math.floor(Number(value));
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function nonNegativeInteger(value, fallback) {
  const number = Math.floor(Number(value));
  return Number.isFinite(number) && number >= 0 ? number : fallback;
}
