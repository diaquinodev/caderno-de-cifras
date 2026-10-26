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
 * @property {16} cellsPerSystem
 * @property {number} systemCapacity
 * @property {1} pageSpan
 * @property {number} minSheetWidth
 * @property {number} usableSheetWidth
 * @property {number} usableHeight
 */

/**
 * @typedef {Object} ReadingPreferences
 * @property {"auto" | "single" | "spread"} spreadMode
 * @property {"fit" | "manual"} zoomMode
 * @property {number} zoomPercent
 */

/**
 * @typedef {Object} ReadingPresentation
 * @property {1 | 2} pageSpan
 * @property {number} zoomPercent
 * @property {number} sheetWidth
 * @property {null | "forced-single" | "single-page" | "portrait" | "viewport-too-narrow" | "sheet-too-narrow" | "spread-overflow"} fallbackReason
 */

/**
 * @typedef {Object} ReadingSpread
 * @property {number} firstPage
 * @property {1 | 2} pageSpan
 * @property {AdaptiveChartPage[]} visiblePages
 */

export const DEFAULT_MIN_SHEET_WIDTH = 420;
export const DEFAULT_HORIZONTAL_CHROME = 36;
export const DEFAULT_MAX_SHEET_WIDTH = 960;
export const DEFAULT_SPREAD_GAP = 16;
export const DEFAULT_MIN_SPREAD_VIEWPORT_WIDTH = 1200;
export const DEFAULT_READING_ZOOM_PERCENT = 100;
export const MIN_READING_ZOOM_PERCENT = 67;
export const MAX_READING_ZOOM_PERCENT = 150;
export const READING_ZOOM_STEP_PERCENT = 10;
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
  const annotation = String(atom?.measure?.annotation || "").trim();
  return chordTokens.length === 1 &&
    chordText.length <= textLimit &&
    chordTokens[0].length <= tokenLimit &&
    !repeat &&
    !ending &&
    !annotation;
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
 * Resolve o perfil de leitura para uma única superfície musical. A largura
 * acompanha o viewport sem ser limitada pela altura, evitando que o zoom do
 * navegador encolha a cifra novamente para caber em uma folha dupla.
 *
 * @param {Object} [options]
 * @param {number} [options.viewportWidth]
 * @param {number} [options.viewportHeight]
 * @param {number} [options.minSheetWidth]
 * @param {number} [options.horizontalChrome]
 * @returns {ReadingLayoutProfile}
 */
export function resolveReadingLayoutProfile(options = {}) {
  const viewportWidth = positiveInteger(options.viewportWidth, 1024);
  const viewportHeight = positiveInteger(options.viewportHeight, 768);
  const minSheetWidth = positiveInteger(options.minSheetWidth, DEFAULT_MIN_SHEET_WIDTH);
  const horizontalChrome = nonNegativeInteger(options.horizontalChrome, DEFAULT_HORIZONTAL_CHROME);
  const singleSheetWidth = Math.min(
    Math.max(280, viewportWidth - horizontalChrome),
    DEFAULT_MAX_SHEET_WIDTH
  );
  const systemCapacity = viewportHeight < 500 ? 4 : DEFAULT_SYSTEMS_PER_PAGE;

  return {
    cellsPerSystem: DEFAULT_CELLS_PER_SYSTEM,
    systemCapacity,
    pageSpan: 1,
    minSheetWidth,
    usableSheetWidth: singleSheetWidth,
    usableHeight: viewportHeight,
  };
}

/**
 * Decide como as folhas podem ser apresentadas sem alterar a estrutura musical.
 * O modo duplo depende do espaço real disponível e sempre volta para uma folha
 * quando duas superfícies ficariam estreitas demais.
 *
 * @param {Object} [options]
 * @param {number} [options.viewportWidth]
 * @param {number} [options.viewportHeight]
 * @param {number} [options.totalPages]
 * @param {Partial<ReadingPreferences>} [options.preferences]
 * @param {number} [options.minSheetWidth]
 * @param {number} [options.horizontalChrome]
 * @param {number} [options.spreadGap]
 * @param {number} [options.minSpreadViewportWidth]
 * @returns {ReadingPresentation}
 */
export function resolveReadingPresentation(options = {}) {
  const viewportWidth = positiveInteger(options.viewportWidth, 1024);
  const viewportHeight = positiveInteger(options.viewportHeight, 768);
  const totalPages = positiveInteger(options.totalPages, 1);
  const minSheetWidth = positiveInteger(options.minSheetWidth, DEFAULT_MIN_SHEET_WIDTH);
  const horizontalChrome = nonNegativeInteger(options.horizontalChrome, DEFAULT_HORIZONTAL_CHROME);
  const spreadGap = nonNegativeInteger(options.spreadGap, DEFAULT_SPREAD_GAP);
  const minSpreadViewportWidth = positiveInteger(
    options.minSpreadViewportWidth,
    DEFAULT_MIN_SPREAD_VIEWPORT_WIDTH
  );
  const spreadMode = ["auto", "single", "spread"].includes(options.preferences?.spreadMode)
    ? options.preferences.spreadMode
    : "auto";
  const zoomMode = ["fit", "manual"].includes(options.preferences?.zoomMode)
    ? options.preferences.zoomMode
    : "fit";
  const requestedZoom = Number(options.preferences?.zoomPercent);
  const zoomPercent = zoomMode === "manual"
    ? clampInteger(requestedZoom, MIN_READING_ZOOM_PERCENT, MAX_READING_ZOOM_PERCENT, DEFAULT_READING_ZOOM_PERCENT)
    : DEFAULT_READING_ZOOM_PERCENT;
  const availableWidth = Math.max(280, viewportWidth - horizontalChrome);
  const singleSheetWidth = scaledSheetWidth(
    Math.min(availableWidth, DEFAULT_MAX_SHEET_WIDTH),
    zoomPercent
  );

  const single = (fallbackReason) => ({
    pageSpan: 1,
    zoomPercent,
    sheetWidth: singleSheetWidth,
    fallbackReason,
  });

  if (spreadMode === "single") return single("forced-single");
  if (totalPages < 2) return single("single-page");
  if (viewportWidth <= viewportHeight) return single("portrait");
  if (viewportWidth < minSpreadViewportWidth) return single("viewport-too-narrow");

  const spreadBaseWidth = Math.min(
    Math.floor((availableWidth - spreadGap) / 2),
    DEFAULT_MAX_SHEET_WIDTH
  );
  const spreadSheetWidth = scaledSheetWidth(spreadBaseWidth, zoomPercent);
  if (spreadSheetWidth < minSheetWidth) return single("sheet-too-narrow");
  if ((spreadSheetWidth * 2) + spreadGap > availableWidth) return single("spread-overflow");

  return {
    pageSpan: 2,
    zoomPercent,
    sheetWidth: spreadSheetWidth,
    fallbackReason: null,
  };
}

/**
 * Atualiza somente a preferência de sessão do leitor. `fit` é idempotente e
 * os passos manuais partem do zoom que está realmente resolvido na tela.
 *
 * @param {Partial<ReadingPreferences>} [preferences]
 * @param {"decrease" | "increase" | "fit"} [command]
 * @param {number} [resolvedZoomPercent]
 * @returns {ReadingPreferences}
 */
export function updateReadingZoomPreferences(
  preferences = {},
  command = "fit",
  resolvedZoomPercent = DEFAULT_READING_ZOOM_PERCENT
) {
  const spreadMode = ["auto", "single", "spread"].includes(preferences.spreadMode)
    ? preferences.spreadMode
    : "auto";
  if (command === "fit") {
    return {
      spreadMode,
      zoomMode: "fit",
      zoomPercent: DEFAULT_READING_ZOOM_PERCENT,
    };
  }

  const currentZoom = preferences.zoomMode === "manual"
    ? clampInteger(
      preferences.zoomPercent,
      MIN_READING_ZOOM_PERCENT,
      MAX_READING_ZOOM_PERCENT,
      DEFAULT_READING_ZOOM_PERCENT
    )
    : clampInteger(
      resolvedZoomPercent,
      MIN_READING_ZOOM_PERCENT,
      MAX_READING_ZOOM_PERCENT,
      DEFAULT_READING_ZOOM_PERCENT
    );
  const direction = command === "decrease" ? -1 : 1;
  return {
    spreadMode,
    zoomMode: "manual",
    zoomPercent: clampInteger(
      currentZoom + (direction * READING_ZOOM_STEP_PERCENT),
      MIN_READING_ZOOM_PERCENT,
      MAX_READING_ZOOM_PERCENT,
      DEFAULT_READING_ZOOM_PERCENT
    ),
  };
}

/**
 * Normaliza a página ativa para o início da folha simples ou dupla.
 *
 * @param {number} [activePage]
 * @param {number} [totalPages]
 * @param {number | ReadingPresentation} [spanOrPresentation]
 * @returns {number}
 */
export function normalizeReadingSpreadPage(activePage = 1, totalPages = 1, spanOrPresentation = 1) {
  const rawSpan = typeof spanOrPresentation === "object" && spanOrPresentation !== null
    ? spanOrPresentation.pageSpan
    : spanOrPresentation;
  const pageSpan = /** @type {1 | 2} */ (Math.min(2, positiveInteger(rawSpan, 1)));
  const total = Math.max(1, positiveInteger(totalPages, 1));
  const active = Math.min(total, positiveInteger(activePage, 1));
  return Math.floor((active - 1) / pageSpan) * pageSpan + 1;
}

/**
 * Agrupa páginas já compostas na ordem esquerda→direita. Quando o total é
 * ímpar, a última dupla contém somente a página restante.
 *
 * @param {AdaptiveChartPage[]} pages
 * @param {number} [activePage]
 * @param {number | ReadingPresentation} [spanOrPresentation]
 * @returns {ReadingSpread}
 */
export function composeReadingSpread(pages, activePage = 1, spanOrPresentation = 1) {
  const safePages = Array.isArray(pages) && pages.length > 0
    ? pages
    : [{ index: 1, systemCount: 0, systems: [] }];
  const rawSpan = typeof spanOrPresentation === "object" && spanOrPresentation !== null
    ? spanOrPresentation.pageSpan
    : spanOrPresentation;
  const pageSpan = /** @type {1 | 2} */ (Math.min(2, positiveInteger(rawSpan, 1)));
  const firstPage = normalizeReadingSpreadPage(activePage, safePages.length, pageSpan);
  return {
    firstPage,
    pageSpan,
    visiblePages: safePages.slice(firstPage - 1, firstPage - 1 + pageSpan),
  };
}

/**
 * Encontra a página que contém o compasso usado como âncora de leitura.
 *
 * @param {AdaptiveChartPage[]} pages
 * @param {string} measureId
 * @param {number} [fallbackPage]
 * @returns {number}
 */
export function findChartPageByMeasureId(pages, measureId, fallbackPage = 1) {
  const safePages = Array.isArray(pages) ? pages : [];
  const wantedId = String(measureId || "");
  const match = wantedId
    ? safePages.find((page) => page.systems.some((system) =>
      system.placements.some((placement) => placement.atom.measureId === wantedId)
    ))
    : null;
  const total = Math.max(1, safePages.length);
  return match?.index || Math.min(total, positiveInteger(fallbackPage, 1));
}

function positiveInteger(value, fallback) {
  const number = Math.floor(Number(value));
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function nonNegativeInteger(value, fallback) {
  const number = Math.floor(Number(value));
  return Number.isFinite(number) && number >= 0 ? number : fallback;
}

function clampInteger(value, minimum, maximum, fallback) {
  const number = Math.round(Number(value));
  if (!Number.isFinite(number)) return fallback;
  return Math.min(maximum, Math.max(minimum, number));
}

function scaledSheetWidth(width, zoomPercent) {
  return Math.max(280, Math.floor(width * zoomPercent / 100));
}
