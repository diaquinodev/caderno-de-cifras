/**
 * @typedef {Object} ChartMeasureAtom
 * @property {any} measure
 * @property {string} measureId
 * @property {number} globalMeasureIndex
 * @property {string} sectionKey
 * @property {string} sectionId
 * @property {string} sectionLabel
 * @property {boolean} startsSection
 */

/**
 * @typedef {Object} MeasurePlacement
 * @property {ChartMeasureAtom} atom
 * @property {number} cellStart
 * @property {number} cellSpan
 */

/**
 * @typedef {Object} ChartSystem
 * @property {number} index
 * @property {number} cellsUsed
 * @property {MeasurePlacement[]} placements
 */

/**
 * @typedef {Object} AdaptiveChartPage
 * @property {number} index
 * @property {number} systemCount
 * @property {ChartSystem[]} systems
 */

/**
 * @typedef {Object} AdaptiveChartLayout
 * @property {"normal" | "compact"} density
 * @property {boolean} compactEligible
 * @property {16} cellsPerSystem
 * @property {number} systemCapacity
 * @property {number} totalSystems
 * @property {ChartMeasureAtom[]} atoms
 * @property {ChartSystem[]} systems
 * @property {AdaptiveChartPage[]} pages
 */

/**
 * @typedef {Object} ReadingLayoutProfile
 * @property {number} systemCapacity
 * @property {number} [pageSpan]
 * @property {number} minSheetWidth
 * @property {number} usableSheetWidth
 */

/**
 * @typedef {Object} ReadingSpread
 * @property {number} firstPage
 * @property {number} pageSpan
 * @property {AdaptiveChartPage[]} visiblePages
 */

export const DEFAULT_MIN_SHEET_WIDTH = 420;
export const DEFAULT_SPREAD_GAP = 16;
export const DEFAULT_HORIZONTAL_CHROME = 36;
export const DEFAULT_VERTICAL_CHROME = 136;
export const DEFAULT_CELLS_PER_SYSTEM = 16;
export const DEFAULT_MAX_SYSTEMS_PER_PAGE = 12;
export const DEFAULT_SYSTEMS_PER_PAGE = 8;
export const NORMAL_MEASURE_CELL_SPAN = 4;
export const COMPACT_MEASURE_CELL_SPAN = 2;
export const DEFAULT_COMPACT_CHORD_TEXT_LIMIT = 16;
export const DEFAULT_COMPACT_CHORD_TOKEN_LIMIT = 10;

/**
 * Achata a música em uma sequência canônica de compassos. A chave da seção
 * inclui sua posição para que IDs legados repetidos nunca fundam duas seções.
 *
 * @param {any} song
 * @returns {ChartMeasureAtom[]}
 */
export function flattenChartMeasures(song) {
  const sections = Array.isArray(song?.sections) ? song.sections : [];
  const atoms = [];
  let globalMeasureIndex = 0;

  for (const [sectionIndex, section] of sections.entries()) {
    const measures = Array.isArray(section?.measures) ? section.measures : [];
    const sectionId = String(section?.id || `section-${sectionIndex + 1}`);
    const sectionKey = `${sectionIndex + 1}:${sectionId}`;
    const sectionLabel = String(section?.label || "");

    for (const [measureIndex, measure] of measures.entries()) {
      globalMeasureIndex += 1;
      atoms.push({
        measure,
        measureId: String(measure?.id || `measure-${globalMeasureIndex}`),
        globalMeasureIndex,
        sectionKey,
        sectionId,
        sectionLabel,
        startsSection: measureIndex === 0,
      });
    }
  }

  return atoms;
}

/**
 * Restringe a densidade compacta a compassos com no máximo dois acordes e
 * rótulos curtos o bastante para a futura célula visual. Não altera a fonte.
 *
 * @param {ChartMeasureAtom[]} atoms
 * @param {Object} [options]
 * @param {number} [options.chordTextLimit]
 * @param {number} [options.chordTokenLimit]
 * @returns {boolean}
 */
export function canUseCompactDensity(atoms, options = {}) {
  if (!Array.isArray(atoms) || atoms.length === 0) return false;
  const textLimit = positiveInteger(options.chordTextLimit, DEFAULT_COMPACT_CHORD_TEXT_LIMIT);
  const tokenLimit = positiveInteger(options.chordTokenLimit, DEFAULT_COMPACT_CHORD_TOKEN_LIMIT);

  return atoms.every((atom) => {
    const chordText = String(atom?.measure?.chords || "").trim();
    const chordTokens = chordText ? chordText.split(/\s+/).filter(Boolean) : [];
    return chordTokens.length <= 2 &&
      chordText.length <= textLimit &&
      chordTokens.every((token) => token.length <= tokenLimit);
  });
}

/**
 * Empacota compassos sequenciais em sistemas de células sem cortar compassos
 * nem reiniciar a linha quando começa uma nova seção.
 *
 * @param {ChartMeasureAtom[]} atoms
 * @param {"normal" | "compact"} [density]
 * @returns {ChartSystem[]}
 */
export function composeChartSystems(atoms, density = "normal") {
  const cellSpan = density === "compact" ? COMPACT_MEASURE_CELL_SPAN : NORMAL_MEASURE_CELL_SPAN;
  const safeAtoms = Array.isArray(atoms) ? atoms : [];
  const systems = [];
  let placements = [];
  let cellsUsed = 0;

  const flushSystem = () => {
    if (placements.length === 0) return;
    systems.push({ index: systems.length + 1, cellsUsed, placements });
    placements = [];
    cellsUsed = 0;
  };

  for (const atom of safeAtoms) {
    if (placements.length > 0 && cellsUsed + cellSpan > DEFAULT_CELLS_PER_SYSTEM) flushSystem();
    placements.push({ atom, cellStart: cellsUsed, cellSpan });
    cellsUsed += cellSpan;
  }
  flushSystem();

  return systems;
}

/**
 * Divide sistemas inteiros em páginas. A capacidade nunca ultrapassa os 12
 * sistemas observáveis no modelo de referência.
 *
 * @param {ChartSystem[]} systems
 * @param {Object} [profile]
 * @param {number} [profile.systemCapacity]
 * @param {number} [profile.maxSystemsPerPage]
 * @returns {AdaptiveChartPage[]}
 */
export function paginateChartSystems(systems, profile = {}) {
  const maxSystems = Math.min(
    DEFAULT_MAX_SYSTEMS_PER_PAGE,
    positiveInteger(profile.maxSystemsPerPage, DEFAULT_MAX_SYSTEMS_PER_PAGE)
  );
  const systemCapacity = Math.min(maxSystems, positiveInteger(profile.systemCapacity, maxSystems));
  const safeSystems = Array.isArray(systems) ? systems : [];
  if (safeSystems.length === 0) return [{ index: 1, systemCount: 0, systems: [] }];

  const pages = [];
  for (let start = 0; start < safeSystems.length; start += systemCapacity) {
    const pageSystems = safeSystems.slice(start, start + systemCapacity);
    pages.push({ index: pages.length + 1, systemCount: pageSystems.length, systems: pageSystems });
  }
  return pages;
}

/**
 * Compõe os candidatos normal e compacto e escolhe a densidade que reduz o
 * número de páginas. O modo normal vence empates para preservar conforto.
 *
 * @param {any} song
 * @param {Object} [profile]
 * @param {number} [profile.systemCapacity]
 * @param {number} [profile.maxSystemsPerPage]
 * @param {"auto" | "normal" | "compact"} [profile.density]
 * @param {number} [profile.compactChordTextLimit]
 * @param {number} [profile.compactChordTokenLimit]
 * @returns {AdaptiveChartLayout}
 */
export function composeChartLayout(song, profile = {}) {
  const maxSystemsPerPage = Math.min(
    DEFAULT_MAX_SYSTEMS_PER_PAGE,
    positiveInteger(profile.maxSystemsPerPage, DEFAULT_MAX_SYSTEMS_PER_PAGE)
  );
  const systemCapacity = Math.min(
    maxSystemsPerPage,
    positiveInteger(profile.systemCapacity, maxSystemsPerPage)
  );
  const atoms = flattenChartMeasures(song);
  const compactEligible = canUseCompactDensity(atoms, {
    chordTextLimit: profile.compactChordTextLimit,
    chordTokenLimit: profile.compactChordTokenLimit,
  });
  const normalSystems = composeChartSystems(atoms, "normal");
  const normalPages = paginateChartSystems(normalSystems, { systemCapacity, maxSystemsPerPage });
  const requestedDensity = ["normal", "compact"].includes(profile.density) ? profile.density : "auto";

  let density = "normal";
  let systems = normalSystems;
  let pages = normalPages;

  if (compactEligible && requestedDensity !== "normal") {
    const compactSystems = composeChartSystems(atoms, "compact");
    const compactPages = paginateChartSystems(compactSystems, { systemCapacity, maxSystemsPerPage });
    if (requestedDensity === "compact" || compactPages.length < normalPages.length) {
      density = "compact";
      systems = compactSystems;
      pages = compactPages;
    }
  }

  return {
    density,
    compactEligible,
    cellsPerSystem: DEFAULT_CELLS_PER_SYSTEM,
    systemCapacity,
    totalSystems: systems.length,
    atoms,
    systems,
    pages,
  };
}

/**
 * Resolve o perfil de leitura (1-up ou 2-up) pela largura útil de cada folha,
 * mantendo 1 folha em celular/retrato e ativando 2 folhas apenas quando cada
 * folha em orientação horizontal respeitar o piso de legibilidade.
 *
 * @param {Object} [options]
 * @param {number} [options.viewportWidth]
 * @param {number} [options.viewportHeight]
 * @param {number} [options.minSheetWidth]
 * @param {number} [options.spreadGap]
 * @param {number} [options.horizontalChrome]
 * @param {number} [options.verticalChrome]
 * @returns {ReadingLayoutProfile}
 */
export function resolveReadingLayoutProfile(options = {}) {
  const viewportWidth = positiveInteger(options.viewportWidth, 1024);
  const viewportHeight = positiveInteger(options.viewportHeight, 768);
  const minSheetWidth = positiveInteger(options.minSheetWidth, DEFAULT_MIN_SHEET_WIDTH);
  const spreadGap = nonNegativeInteger(options.spreadGap, DEFAULT_SPREAD_GAP);
  const horizontalChrome = nonNegativeInteger(options.horizontalChrome, DEFAULT_HORIZONTAL_CHROME);
  const verticalChrome = nonNegativeInteger(options.verticalChrome, DEFAULT_VERTICAL_CHROME);

  const isLandscape = viewportWidth > viewportHeight;
  const widthPerDualSheet = Math.floor((viewportWidth - horizontalChrome - spreadGap) / 2);
  const heightBoundedWidth = Math.floor(Math.max(320, (viewportHeight - verticalChrome) * 0.68));
  const dualSheetWidth = Math.min(widthPerDualSheet, heightBoundedWidth);
  const canFitDualSheets = isLandscape && viewportHeight >= 560 && dualSheetWidth >= minSheetWidth;
  const pageSpan = canFitDualSheets ? 2 : 1;
  const singleSheetWidth = Math.min(
    Math.max(280, viewportWidth - horizontalChrome),
    Math.floor(Math.max(360, (viewportHeight - verticalChrome) * 0.68)),
    960
  );

  const usableSheetWidth = pageSpan === 2 ? dualSheetWidth : singleSheetWidth;
  const systemCapacity = viewportHeight < 500 ? 4 : DEFAULT_SYSTEMS_PER_PAGE;

  return {
    systemCapacity,
    pageSpan,
    minSheetWidth,
    usableSheetWidth,
  };
}

/**
 * Normaliza o índice da página ativa para o início da folha simples ou dupla.
 *
 * @param {number} [activePage]
 * @param {number} [totalPages]
 * @param {number | ReadingLayoutProfile} [spanOrProfile]
 * @returns {number}
 */
export function normalizeSpreadPage(activePage = 1, totalPages = 1, spanOrProfile = 1) {
  const rawSpan = typeof spanOrProfile === "object" && spanOrProfile !== null
    ? spanOrProfile.pageSpan
    : spanOrProfile;
  const span = Math.min(2, positiveInteger(rawSpan, 1));
  const total = Math.max(1, positiveInteger(totalPages, 1));
  const active = Math.min(total, positiveInteger(activePage, 1));
  return Math.floor((active - 1) / span) * span + 1;
}

/**
 * Agrupa páginas já compostas em uma folha simples ou dupla.
 *
 * @param {AdaptiveChartPage[]} pages
 * @param {number} [activePage]
 * @param {number | ReadingLayoutProfile} [spanOrProfile]
 * @returns {ReadingSpread}
 */
export function composePageSpread(pages, activePage = 1, spanOrProfile = 1) {
  const safePages = Array.isArray(pages) ? pages : [];
  const rawSpan = typeof spanOrProfile === "object" && spanOrProfile !== null
    ? spanOrProfile.pageSpan
    : spanOrProfile;
  const span = Math.min(2, positiveInteger(rawSpan, 1));
  const firstPage = normalizeSpreadPage(activePage, safePages.length, span);
  return {
    firstPage,
    pageSpan: span,
    visiblePages: safePages.slice(firstPage - 1, firstPage - 1 + span),
  };
}

function positiveInteger(value, fallback) {
  const number = Math.floor(Number(value));
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function nonNegativeInteger(value, fallback) {
  const number = Math.floor(Number(value));
  return Number.isFinite(number) && number >= 0 ? number : fallback;
}
