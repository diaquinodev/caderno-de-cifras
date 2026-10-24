/**
 * @file spacing.js
 * Módulo puro para medição de espaçamento horizontal e prova de evidência de compassos (Fase 14).
 * Analisa as distâncias relativas entre acordes na linha para sugerir divisões de compasso
 * sem transformar pistas visuais em fatos permanentes sem validação.
 */

/**
 * @typedef {Object} ChordPositionEvidence
 * @property {number} chordIndex - Índice global do acorde na linha
 * @property {number} lineIndex - Índice da linha na seção
 * @property {string} chordName - Texto do acorde
 * @property {number} startCol - Coluna inicial na linha de texto
 * @property {number} endCol - Coluna final na linha de texto
 * @property {number} gapBefore - Quantidade de caracteres de espaço antes do acorde
 * @property {number} gapRatio - Razão entre gapBefore e a mediana da linha (0 se primeiro acorde)
 * @property {boolean} clustered - Se o acorde foi agrupado no compasso anterior por proximidade
 */

/**
 * @typedef {Object} SpacingAnalysisResult
 * @property {number} lineIndex
 * @property {string} rawLine
 * @property {number} chordCount
 * @property {number} medianGap
 * @property {ChordPositionEvidence[]} evidence
 * @property {string[][]} suggestedBars - Lista de compassos sugeridos (cada compasso é um array de nomes)
 */

/**
 * Limite de caracteres para considerar dois acordes fisicamente próximos.
 */
export const MAX_CLUSTERED_GAP_CHARS = 3;

/**
 * Limiar de razão de gap em relação à mediana da linha para caracterizar anomalia de proximidade.
 * Se gapBefore < medianGap * GAP_ANOMALY_RATIO, indica que os acordes estão em ritmo acelerado.
 */
export const GAP_ANOMALY_RATIO = 0.5;

/**
 * Localiza a posição de colunas e mede os gaps entre acordes em uma linha de texto.
 *
 * @param {string} rawLine - Linha bruta com os espaços originais
 * @param {Array<{ raw?: string, normalized?: string } | string>} chords - Lista ordenada de acordes
 * @param {number} [lineIndex=0]
 * @returns {SpacingAnalysisResult}
 */
export function analyzeChordLineSpacing(rawLine, chords = [], lineIndex = 0) {
  const lineText = String(rawLine || "");
  const chordList = Array.isArray(chords) ? chords : [];

  if (chordList.length === 0) {
    return {
      lineIndex,
      rawLine: lineText,
      chordCount: 0,
      medianGap: 0,
      evidence: [],
      suggestedBars: [],
    };
  }

  // 1. Identificar posições e gaps de cada acorde
  let searchCursor = 0;
  /** @type {Array<{ chordName: string, startCol: number, endCol: number, gapBefore: number }>} */
  const rawPositions = [];

  for (let i = 0; i < chordList.length; i += 1) {
    const item = chordList[i];
    const chordName = typeof item === "string" ? item : (item.raw || item.normalized || "");
    const foundIndex = chordName ? lineText.indexOf(chordName, searchCursor) : -1;

    if (foundIndex === -1) {
      const startCol = searchCursor;
      const endCol = searchCursor + (chordName.length || 1);
      const gapBefore = i === 0 ? 0 : Math.max(0, startCol - (rawPositions[i - 1]?.endCol || 0));
      rawPositions.push({ chordName, startCol, endCol, gapBefore });
      searchCursor = endCol;
    } else {
      const startCol = foundIndex;
      const endCol = foundIndex + chordName.length;
      const gapBefore = i === 0 ? 0 : Math.max(0, startCol - rawPositions[i - 1].endCol);
      rawPositions.push({ chordName, startCol, endCol, gapBefore });
      searchCursor = endCol;
    }
  }

  // 2. Calcular a mediana dos gaps (excluindo o primeiro acorde que não tem gap anterior)
  const gapsBetween = rawPositions.slice(1).map((p) => p.gapBefore);
  const sortedGaps = [...gapsBetween].sort((a, b) => a - b);
  const medianGap = sortedGaps.length === 0
    ? 0
    : sortedGaps[Math.floor(sortedGaps.length / 2)];

  // 3. Avaliar proximidade relativa e agrupar em compassos
  /** @type {ChordPositionEvidence[]} */
  const evidence = [];
  /** @type {string[][]} */
  const suggestedBars = [];

  for (let i = 0; i < rawPositions.length; i += 1) {
    const pos = rawPositions[i];
    const isFirst = i === 0;
    const gapBefore = pos.gapBefore;
    const gapRatio = !isFirst && medianGap > 0
      ? Number((gapBefore / medianGap).toFixed(2))
      : 0;

    let clustered = false;

    if (!isFirst) {
      if (gapsBetween.length === 1) {
        // Linha com exatamente 2 acordes:
        // Se gap <= 3, assume divisão do mesmo compasso (| C G |)
        // Se gap > 3, assume dois compassos separados sobre a letra (| C | G |)
        clustered = gapBefore <= MAX_CLUSTERED_GAP_CHARS;
      } else {
        // Linha com 3 ou mais acordes:
        // Clustered se for curto (<= 3) E significativamente menor que a mediana da linha
        clustered = gapBefore <= MAX_CLUSTERED_GAP_CHARS
          && (medianGap === 0 || gapBefore < medianGap * GAP_ANOMALY_RATIO);
      }
    }

    evidence.push({
      chordIndex: i,
      lineIndex,
      chordName: pos.chordName,
      startCol: pos.startCol,
      endCol: pos.endCol,
      gapBefore,
      gapRatio,
      clustered,
    });

    if (isFirst || !clustered) {
      suggestedBars.push([pos.chordName]);
    } else {
      const currentBar = suggestedBars[suggestedBars.length - 1];
      currentBar.push(pos.chordName);
    }
  }

  return {
    lineIndex,
    rawLine: lineText,
    chordCount: rawPositions.length,
    medianGap,
    evidence,
    suggestedBars,
  };
}

/**
 * Compara a heurística de espaçamento com a heurística legada de agrupamento por pares.
 *
 * @param {string} rawLine
 * @param {Array<{ raw?: string, normalized?: string } | string>} chords
 * @returns {{ legacyBars: string[][], spacingBars: string[][], matchesMusicalIntent: boolean }}
 */
export function compareSpacingVsLegacy(rawLine, chords) {
  const spacingResult = analyzeChordLineSpacing(rawLine, chords);
  const chordNames = spacingResult.evidence.map((e) => e.chordName);

  // Heurística legada (pares cegos)
  const legacyBars = [];
  if (chordNames.length === 1) {
    legacyBars.push([chordNames[0]]);
  } else if (chordNames.length === 2) {
    legacyBars.push([chordNames[0], chordNames[1]]);
  } else if (chordNames.length === 3) {
    legacyBars.push([chordNames[0]]);
    legacyBars.push([chordNames[1], chordNames[2]]);
  } else {
    for (let i = 0; i < chordNames.length; i += 2) {
      legacyBars.push(chordNames.slice(i, i + 2));
    }
  }

  return {
    legacyBars,
    spacingBars: spacingResult.suggestedBars,
    matchesMusicalIntent: false, // preenchido pelo teste com a expectativa real
  };
}
