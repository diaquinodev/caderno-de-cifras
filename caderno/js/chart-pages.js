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
 * @property {"normal" | "compact"} density
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
 * @property {"normal" | "compact" | "mixed"} density
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
 * Identifica um compasso simples o bastante para ocupar uma célula compacta.
 * Repetições e casas permanecem em células normais para preservar legibilidade.
 *
 * @param {ChartMeasureAtom} atom
 * @param {Object} [options]
 * @param {number} [options.chordTextLimit]
 * @param {number} [options.chordTokenLimit]
 * @returns {boolean}
 */
export function canUseCompactMeasure(atom, options = {}) {
  const textLimit = positiveInteger(options.chordTextLimit, DEFAULT_COMPACT_CHORD_TEXT_LIMIT);
  const tokenLimit = positiveInteger(options.chordTokenLimit, DEFAULT_COMPACT_CHORD_TOKEN_LIMIT);
  const chordText = String(atom?.measure?.chords || "").trim();
  const chordTokens = chordText ? chordText.split(/\s+/).filter(Boolean) : [];
  const repeat = String(atom?.measure?.repeat || "").trim();
  const ending = String(atom?.measure?.ending || "").trim();
  return chordTokens.length === 1 &&
    chordText.length <= textLimit &&
    chordTokens[0].length <= tokenLimit &&
    !repeat &&
    !ending;
}

/**
 * Empacota compassos sequenciais em sistemas uniformes. O compacto só é usado
 * para blocos completos de oito compassos simples, sem seção intermediária.
 *
 * @param {ChartMeasureAtom[]} atoms
 * @param {Object} [options]
 * @param {number} [options.chordTextLimit]
 * @param {number} [options.chordTokenLimit]
 * @returns {ChartSystem[]}
 */
export function composeChartSystems(atoms, options = {}) {
  const safeAtoms = Array.isArray(atoms) ? atoms : [];
  const systems = [];
  let cursor = 0;

  while (cursor < safeAtoms.length) {
    const compactCandidate = safeAtoms.slice(cursor, cursor + 8);
    const canCompact = compactCandidate.length === 8 &&
      compactCandidate.every((atom, index) =>
        canUseCompactMeasure(atom, options) && (index === 0 || !atom.startsSection)
      );
    const density = canCompact ? "compact" : "normal";
    const cellSpan = canCompact ? COMPACT_MEASURE_CELL_SPAN : NORMAL_MEASURE_CELL_SPAN;
    const systemAtoms = safeAtoms.slice(cursor, cursor + (canCompact ? 8 : 4));
    const placements = systemAtoms.map((atom, index) => ({
      atom,
      cellStart: index * cellSpan,
      cellSpan,
    }));
    systems.push({
      index: systems.length + 1,
      density,
      cellsUsed: placements.length * cellSpan,
      placements,
    });
    cursor += systemAtoms.length;
  }

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
 * Compõe uma única sequência de sistemas cuja densidade é decidida localmente
 * pelas regras de legibilidade, sem usar a redução de páginas como critério.
 *
 * @param {any} song
 * @param {Object} [profile]
 * @param {number} [profile.systemCapacity]
 * @param {number} [profile.maxSystemsPerPage]
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
  const systems = composeChartSystems(atoms, {
    chordTextLimit: profile.compactChordTextLimit,
    chordTokenLimit: profile.compactChordTokenLimit,
  });
  const pages = paginateChartSystems(systems, { systemCapacity, maxSystemsPerPage });
  const densities = new Set(systems.map((system) => system.density));
  const density = densities.size > 1 ? "mixed" : (systems[0]?.density || "normal");

  return {
    density,
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
