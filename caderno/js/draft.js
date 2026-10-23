import { normalizeKey } from "./chords.js";
import { parseCifraSource } from "./source.js";
import { uid, blankSong } from "./store.js";

/**
 * @typedef {import("./source.js").SourceChord} SourceChord
 * @typedef {import("./source.js").SourceBlock} SourceBlock
 * @typedef {import("./source.js").SourceLine} SourceLine
 * @typedef {import("./source.js").SourceExclusion} SourceExclusion
 * @typedef {import("./source.js").CifraSource} CifraSource
 */

/**
 * @typedef {Object} DraftMeasure
 * @property {string} id
 * @property {string} chords
 * @property {string} [repeat]
 * @property {string} [ending]
 * @property {SourceChord[]} [sourceChords]
 */

/**
 * @typedef {Object} DraftSection
 * @property {string} id
 * @property {string} label
 * @property {"chords" | "tab"} kind
 * @property {string} [tabContent]
 * @property {DraftMeasure[]} measures
 */

/**
 * @typedef {Object} DraftWarning
 * @property {string} code
 * @property {string} message
 * @property {string} [sectionId]
 * @property {string} [measureId]
 */

/**
 * @typedef {Object} ImportDraft
 * @property {string} id
 * @property {string} sourceId
 * @property {string} title
 * @property {string} artist
 * @property {string} composer
 * @property {string} key
 * @property {string} timeSignature
 * @property {number} tempo
 * @property {number} barsPerRow
 * @property {DraftSection[]} sections
 * @property {DraftWarning[]} warnings
 * @property {SourceExclusion[]} exclusions
 * @property {CifraSource} sourceSnapshot
 * @property {RepeatCompaction[]} [repeatCompactions]
 * @property {string[]} [dismissedRepeatCandidateIds]
 */

/**
 * @typedef {Object} MeasureBeatEvaluation
 * @property {number} chordCount
 * @property {number[] | null} beatsPerChord
 * @property {string} summaryLabel
 * @property {boolean} needsReview
 * @property {string} warningMessage
 */

/**
 * @typedef {Object} DraftHistory
 * @property {ImportDraft[]} past
 * @property {number} limit
 */

/**
 * @typedef {Object} RepeatCandidate
 * @property {string} id
 * @property {string} sectionId
 * @property {string} sectionLabel
 * @property {string[]} firstMeasureIds
 * @property {string[]} repeatedMeasureIds
 * @property {number} times
 * @property {number} savedMeasures
 * @property {number} startMeasureNumber
 * @property {number} endMeasureNumber
 * @property {string[]} chordsPreview
 * @property {string} summary
 */

/**
 * @typedef {Object} RepeatCompaction
 * @property {string} id
 * @property {string} sectionId
 * @property {string[]} keptMeasureIds
 * @property {string[]} hiddenMeasureIds
 * @property {number} times
 */

/**
 * @typedef {Object} RepeatSuggestionView
 * @property {string} candidateId
 * @property {string} sectionId
 * @property {string} sectionLabel
 * @property {string} summary
 * @property {string} before
 * @property {string} after
 * @property {number} savedMeasures
 */

/**
 * Avalia a ocupação de tempos de um compasso de acordo com a fórmula de compasso.
 * Em 4/4:
 * - 1 acorde ocupa 4 tempos ([4])
 * - 2 acordes ocupam 2 tempos cada ([2, 2])
 * - 3 ou mais acordes recebem aviso para conferência, sem duração inventada (null)
 *
 * @param {DraftMeasure | { chords?: string, sourceChords?: SourceChord[] }} measure
 * @param {string} [timeSignature]
 * @returns {MeasureBeatEvaluation}
 */
export function evaluateMeasureBeats(measure, timeSignature = "") {
  const normalizedTimeSig = String(timeSignature || "").trim();
  const chordTokens = Array.isArray(measure?.sourceChords) && measure.sourceChords.length > 0
    ? measure.sourceChords.map((c) => c.normalized || c.raw).filter(Boolean)
    : String(measure?.chords || "")
        .trim()
        .split(/\s+/)
        .filter(Boolean);
  const chordCount = chordTokens.length;

  if (normalizedTimeSig !== "4/4" || chordCount === 0) {
    return {
      chordCount,
      beatsPerChord: null,
      summaryLabel: "",
      needsReview: false,
      warningMessage: "",
    };
  }

  if (chordCount === 1) {
    return {
      chordCount: 1,
      beatsPerChord: [4],
      summaryLabel: "4 tempos",
      needsReview: false,
      warningMessage: "",
    };
  }

  if (chordCount === 2) {
    return {
      chordCount: 2,
      beatsPerChord: [2, 2],
      summaryLabel: "2 + 2 tempos",
      needsReview: false,
      warningMessage: "",
    };
  }

  return {
    chordCount,
    beatsPerChord: null,
    summaryLabel: "Conferir divisão",
    needsReview: true,
    warningMessage:
      "Compasso em 4/4 com 3 ou mais acordes: confira a divisão sem duração inventada.",
  };
}

/**
 * Recalcula avisos dependentes dos compassos (como MEASURE_CHORD_COUNT_REVIEW em 4/4),
 * preservando os demais avisos estruturais do rascunho.
 *
 * @param {ImportDraft} draft
 * @returns {ImportDraft}
 */
export function syncDraftMeasureWarnings(draft) {
  if (!draft || typeof draft !== "object") return draft;

  const baseWarnings = Array.isArray(draft.warnings)
    ? draft.warnings.filter((w) => w.code !== "MEASURE_CHORD_COUNT_REVIEW")
    : [];

  const measureWarnings = [];
  if (String(draft.timeSignature || "").trim() === "4/4" && Array.isArray(draft.sections)) {
    for (const sec of draft.sections) {
      if (sec.kind !== "chords" || !Array.isArray(sec.measures)) continue;
      for (let mIdx = 0; mIdx < sec.measures.length; mIdx += 1) {
        const meas = sec.measures[mIdx];
        const evalRes = evaluateMeasureBeats(meas, draft.timeSignature);
        if (evalRes.needsReview) {
          measureWarnings.push({
            code: "MEASURE_CHORD_COUNT_REVIEW",
            message: `Seção '${sec.label}', compasso ${mIdx + 1} (${meas.chords}) possui ${evalRes.chordCount} acordes em 4/4: confira ou divida os acordes.`,
            sectionId: sec.id,
            measureId: meas.id,
          });
        }
      }
    }
  }

  return {
    ...draft,
    warnings: [...baseWarnings, ...measureWarnings],
  };
}

/**
 * Gera uma sugestão musical editável (ImportDraft) a partir de uma CifraSource literal.
 * Não inventa fórmula de compasso se ela não foi informada na fonte.
 *
 * @param {CifraSource | string} sourceInput
 * @param {Object} [options]
 * @param {string} [options.timeSignature]
 * @param {number} [options.tempo]
 * @param {number} [options.barsPerRow]
 * @returns {ImportDraft}
 */
export function suggestChart(sourceInput, options = {}) {
  const source = typeof sourceInput === "string" ? parseCifraSource(sourceInput) : sourceInput;
  if (!source || !Array.isArray(source.blocks)) {
    throw new Error("Fonte inválida para sugestão musical: CifraSource esperado.");
  }

  const warnings = [];
  const timeSignature = options.timeSignature || "";
  if (!timeSignature) {
    warnings.push({
      code: "NO_TIME_SIGNATURE",
      message: "Fórmula de compasso não informada na fonte. Escolha 4/4, 2/4 ou outra antes de finalizar.",
    });
  }

  const sections = [];

  for (const block of source.blocks) {
    const sectionId = uid();

    if (block.kind === "tab") {
      const tabContent = block.lines.map((l) => l.raw).join("\n");
      sections.push({
        id: sectionId,
        label: block.label || "Tab",
        kind: "tab",
        tabContent,
        measures: [],
      });
      warnings.push({
        code: "TABLATURE_PRESERVED",
        message: `Tablatura '${block.label || "Tab"}' preservada como anotação, sem acordes inventados.`,
        sectionId,
      });
      continue;
    }

    const isAnonymous = block.kind === "anonymous";
    const label = isAnonymous ? "Principal" : (block.label || "A");

    if (isAnonymous) {
      warnings.push({
        code: "ANONYMOUS_SECTION",
        message: "A fonte não continha nomes de seções; agrupado como 'Principal'.",
        sectionId,
      });
    }

    // Processa linhas de acordes do bloco
    const chordLines = block.lines.filter((l) => l.type === "chords" && l.chords.length > 0);
    const hasBarDividers = chordLines.some((l) => l.raw.includes("|"));

    const measures = [];

    if (hasBarDividers) {
      // Processa com base nas barras explícitas
      for (const line of chordLines) {
        const rawSegments = line.raw.split("|");
        // Remove segmento vazio no início ou no fim se for originado de barras externas
        const segments = rawSegments.map((s) => s.trim()).filter((s, idx, arr) => {
          if ((idx === 0 || idx === arr.length - 1) && !s) return false;
          return true;
        });

        let chordPtr = 0;
        for (const seg of segments) {
          let repeat = "";
          let ending = "";
          let cleanSeg = seg;

          if (cleanSeg.startsWith(":")) {
            repeat = "start";
            cleanSeg = cleanSeg.slice(1).trim();
          }
          if (cleanSeg.endsWith(":")) {
            repeat = repeat === "start" ? "both" : "end";
            cleanSeg = cleanSeg.slice(0, -1).trim();
          }

          const endMatch = cleanSeg.match(/^\[([1-9])\]/);
          if (endMatch) {
            ending = endMatch[1];
            cleanSeg = cleanSeg.slice(endMatch[0].length).trim();
          }

          // Atribui os SourceChords correspondentes da linha
          const segTokens = cleanSeg.split(/\s+/).filter(Boolean);
          const matchedChords = [];
          for (let ti = 0; ti < segTokens.length && chordPtr < line.chords.length; ti += 1) {
            matchedChords.push(line.chords[chordPtr]);
            chordPtr += 1;
          }

          measures.push({
            id: uid(),
            chords: matchedChords.map((c) => c.normalized).join(" "),
            repeat,
            ending,
            sourceChords: matchedChords,
          });
        }
      }
    } else {
      // Agrupamento sem barras: preserva cada acorde da linha
      let hadHeuristicGrouping = false;

      if (timeSignature === "2/4") {
        for (const line of chordLines) {
          for (const chord of line.chords) {
            measures.push({
              id: uid(),
              chords: chord.normalized,
              repeat: "",
              ending: "",
              sourceChords: [chord],
            });
          }
        }
      } else {
        for (const line of chordLines) {
          const chords = line.chords;
          if (chords.length === 1) {
            measures.push({
              id: uid(),
              chords: chords[0].normalized,
              repeat: "",
              ending: "",
              sourceChords: [chords[0]],
            });
          } else if (chords.length === 2) {
            measures.push({
              id: uid(),
              chords: `${chords[0].normalized} ${chords[1].normalized}`,
              repeat: "",
              ending: "",
              sourceChords: [chords[0], chords[1]],
            });
            hadHeuristicGrouping = true;
          } else if (chords.length === 3) {
            measures.push({
              id: uid(),
              chords: chords[0].normalized,
              repeat: "",
              ending: "",
              sourceChords: [chords[0]],
            });
            measures.push({
              id: uid(),
              chords: `${chords[1].normalized} ${chords[2].normalized}`,
              repeat: "",
              ending: "",
              sourceChords: [chords[1], chords[2]],
            });
            hadHeuristicGrouping = true;
          } else {
            for (let idx = 0; idx < chords.length; idx += 2) {
              const pair = chords.slice(idx, idx + 2);
              measures.push({
                id: uid(),
                chords: pair.map((c) => c.normalized).join(" "),
                repeat: "",
                ending: "",
                sourceChords: pair,
              });
              if (pair.length > 1) hadHeuristicGrouping = true;
            }
          }
        }
      }

      if (hadHeuristicGrouping) {
        warnings.push({
          code: "HEURISTIC_MEASURE_SPLIT",
          message: `Compassos sugeridos por heurística para a seção '${label}'. Use dividir/unir para ajustar se necessário.`,
          sectionId,
        });
      }
    }

    sections.push({
      id: sectionId,
      label,
      kind: "chords",
      measures,
    });
  }

  const draft = {
    id: uid(),
    sourceId: source.metadata?.url || uid(),
    title: source.metadata?.title || "Sem título",
    artist: source.metadata?.artist || "",
    composer: source.metadata?.composer || "",
    key: normalizeKey(source.metadata?.key) || "C",
    timeSignature,
    tempo: options.tempo || 120,
    barsPerRow: options.barsPerRow || 4,
    sections,
    warnings,
    exclusions: [...(source.exclusions || [])],
    sourceSnapshot: source,
    repeatCompactions: [],
    dismissedRepeatCandidateIds: [],
  };

  return syncDraftMeasureWarnings(draft);
}

/**
 * Valida os invariantes de um ImportDraft comparando com sua CifraSource.
 * Garante que nenhum acorde foi perdido ou alterado na sequência.
 *
 * @param {ImportDraft} draft
 * @param {CifraSource} [expectedSource]
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function verifyDraftInvariants(draft, expectedSource) {
  const errors = [];
  const source = expectedSource || draft.sourceSnapshot;

  if (!draft || typeof draft !== "object") {
    return { valid: false, errors: ["Draft nulo ou inválido"] };
  }

  if (!Array.isArray(draft.sections)) {
    return { valid: false, errors: ["Draft não contém array de seções"] };
  }

  const collected = [];
  for (const sec of draft.sections) {
    if (sec.kind === "chords" && Array.isArray(sec.measures)) {
      for (const meas of sec.measures) {
        if (Array.isArray(meas.sourceChords)) {
          for (const chord of meas.sourceChords) {
            collected.push(chord);
          }
        }
      }
    }
  }

  if (source && Array.isArray(source.allChords)) {
    if (collected.length !== source.allChords.length) {
      errors.push(
        `Divergência de acordes: fonte tinha ${source.allChords.length}, mas rascunho tem ${collected.length}`
      );
    } else {
      for (let ci = 0; ci < collected.length; ci += 1) {
        const actual = collected[ci];
        const expected = source.allChords[ci];
        const sameChord =
          actual === expected ||
          (Boolean(actual) &&
            Boolean(expected) &&
            actual.raw === expected.raw &&
            actual.normalized === expected.normalized);
        if (!sameChord) {
          errors.push(`Divergência de acorde no índice ${ci}: ${actual?.raw} !== ${expected?.raw}`);
          break;
        }
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Atualiza a fórmula de compasso do rascunho de forma pura.
 * Remove aviso NO_TIME_SIGNATURE quando um valor é definido e recalcula avisos de compasso.
 *
 * @param {ImportDraft} draft
 * @param {string} newTimeSig
 * @returns {ImportDraft}
 */
export function updateDraftTimeSignature(draft, newTimeSig) {
  const timeSignature = String(newTimeSig || "").trim();
  const warnings = draft.warnings.filter((w) => !(w.code === "NO_TIME_SIGNATURE" && timeSignature));

  return syncDraftMeasureWarnings({
    ...draft,
    timeSignature,
    warnings,
  });
}

/**
 * Divide um compasso em dois usando o índice informado como fronteira.
 * Se splitIndex <= 0 em um compasso com múltiplos acordes, usa 1 (separa o primeiro acorde dos demais).
 * Se tiver apenas um acorde ou estiver vazio, mantém no primeiro e cria um compasso vazio como segundo.
 *
 * @param {ImportDraft} draft
 * @param {string} sectionId
 * @param {string} measureId
 * @param {number} [splitIndex=1]
 * @returns {ImportDraft}
 */
export function splitMeasure(draft, sectionId, measureId, splitIndex = 1) {
  if (isSectionCompacted(draft, sectionId)) return draft;
  const sections = draft.sections.map((sec) => {
    if (sec.id !== sectionId) return sec;
    const measureIndex = sec.measures.findIndex((m) => m.id === measureId);
    if (measureIndex === -1) return sec;

    const target = sec.measures[measureIndex];
    const sourceChords = target.sourceChords || [];

    const requestedIndex = Number.isInteger(splitIndex) ? splitIndex : 1;
    const effectiveSplitIndex =
      sourceChords.length > 1
        ? Math.min(Math.max(requestedIndex, 1), sourceChords.length - 1)
        : 1;

    const firstSourceChords = sourceChords.slice(0, effectiveSplitIndex);
    const secondSourceChords = sourceChords.slice(effectiveSplitIndex);

    const firstMeasure = {
      ...target,
      chords: firstSourceChords.map((c) => c.normalized).join(" "),
      sourceChords: firstSourceChords,
      repeat: target.repeat === "both" ? "start" : target.repeat === "start" ? "start" : "",
    };

    const secondMeasure = {
      id: uid(),
      chords: secondSourceChords.map((c) => c.normalized).join(" "),
      repeat: target.repeat === "both" ? "end" : target.repeat === "end" ? "end" : "",
      ending: target.ending || "",
      sourceChords: secondSourceChords,
    };

    const newMeasures = [...sec.measures];
    newMeasures.splice(measureIndex, 1, firstMeasure, secondMeasure);

    return {
      ...sec,
      measures: newMeasures,
    };
  });

  return syncDraftMeasureWarnings({
    ...draft,
    sections,
  });
}

/**
 * Divide um compasso usando o acorde selecionado como fronteira.
 * Quando chordIndex > 0, o acorde selecionado inicia o novo compasso;
 * quando chordIndex === 0, o primeiro acorde permanece no compasso atual e os demais vão para o novo compasso.
 *
 * @param {ImportDraft} draft
 * @param {string} sectionId
 * @param {string} measureId
 * @param {number} [chordIndex=1]
 * @returns {ImportDraft}
 */
export function splitMeasureAtChord(draft, sectionId, measureId, chordIndex = 1) {
  const boundary = Number.isInteger(chordIndex) && chordIndex > 0 ? chordIndex : 1;
  return splitMeasure(draft, sectionId, measureId, boundary);
}

/**
 * Verifica se o acorde selecionado pode ser movido isoladamente para o compasso adjacente
 * sem alterar a ordem linear da música.
 *
 * @param {ImportDraft} draft
 * @param {string} sectionId
 * @param {string} measureId
 * @param {number} chordIndex
 * @param {-1 | 1 | number} direction
 * @returns {boolean}
 */
export function canMoveChordBetweenMeasures(draft, sectionId, measureId, chordIndex, direction) {
  if (!draft || !Array.isArray(draft.sections)) return false;
  if (isSectionCompacted(draft, sectionId)) return false;
  if (direction !== -1 && direction !== 1) return false;

  const sec = draft.sections.find((s) => s.id === sectionId);
  if (!sec || !Array.isArray(sec.measures)) return false;

  const measureIndex = sec.measures.findIndex((m) => m.id === measureId);
  if (measureIndex === -1) return false;

  const target = sec.measures[measureIndex];
  const sourceChords = target.sourceChords || [];
  if (!Number.isInteger(chordIndex) || chordIndex < 0 || chordIndex >= sourceChords.length) {
    return false;
  }

  const targetMeasureIndex = measureIndex + direction;
  if (targetMeasureIndex < 0 || targetMeasureIndex >= sec.measures.length) {
    return false;
  }

  if (direction === -1) {
    return chordIndex === 0;
  }

  return chordIndex === sourceChords.length - 1;
}

/**
 * Move isoladamente o acorde selecionado para o compasso anterior (direction = -1)
 * ou seguinte (direction = 1), preservando a ordem global e a proveniência dos acordes.
 * Se o compasso de origem tinha apenas 1 acorde, ele é absorvido na fronteira adjacente.
 *
 * @param {ImportDraft} draft
 * @param {string} sectionId
 * @param {string} measureId
 * @param {number} chordIndex
 * @param {-1 | 1 | number} direction
 * @returns {ImportDraft}
 */
export function moveChordBetweenMeasures(draft, sectionId, measureId, chordIndex, direction) {
  if (!canMoveChordBetweenMeasures(draft, sectionId, measureId, chordIndex, direction)) {
    return draft;
  }

  const sections = draft.sections.map((sec) => {
    if (sec.id !== sectionId) return sec;

    const measureIndex = sec.measures.findIndex((m) => m.id === measureId);
    const neighborIndex = measureIndex + direction;
    const currentMeasure = sec.measures[measureIndex];
    const neighborMeasure = sec.measures[neighborIndex];

    const currentChords = [...(currentMeasure.sourceChords || [])];
    const [movedChord] = currentChords.splice(chordIndex, 1);
    const neighborChords =
      direction === -1
        ? [...(neighborMeasure.sourceChords || []), movedChord]
        : [movedChord, ...(neighborMeasure.sourceChords || [])];

    const updatedNeighbor = {
      ...neighborMeasure,
      chords: neighborChords.map((c) => c.normalized).join(" "),
      sourceChords: neighborChords,
    };

    const newMeasures = [...sec.measures];
    newMeasures[neighborIndex] = updatedNeighbor;

    if (currentChords.length === 0) {
      // Preserva marcadores de repetição/casa se o compasso esvaziado os possuía
      if (currentMeasure.repeat === "start" && !updatedNeighbor.repeat) {
        newMeasures[neighborIndex] = { ...updatedNeighbor, repeat: "start" };
      } else if (currentMeasure.repeat === "end" && !updatedNeighbor.repeat) {
        newMeasures[neighborIndex] = { ...updatedNeighbor, repeat: "end" };
      }
      if (currentMeasure.ending && !updatedNeighbor.ending) {
        newMeasures[neighborIndex] = { ...newMeasures[neighborIndex], ending: currentMeasure.ending };
      }
      newMeasures.splice(measureIndex, 1);
    } else {
      newMeasures[measureIndex] = {
        ...currentMeasure,
        chords: currentChords.map((c) => c.normalized).join(" "),
        sourceChords: currentChords,
      };
    }

    return {
      ...sec,
      measures: newMeasures,
    };
  });

  return syncDraftMeasureWarnings({
    ...draft,
    sections,
  });
}

/**
 * Une dois compassos adjacentes em um único compasso.
 *
 * @param {ImportDraft} draft
 * @param {string} sectionId
 * @param {string} measureId1
 * @param {string} measureId2
 * @returns {ImportDraft}
 */
export function mergeMeasures(draft, sectionId, measureId1, measureId2) {
  if (isSectionCompacted(draft, sectionId)) return draft;
  const sections = draft.sections.map((sec) => {
    if (sec.id !== sectionId) return sec;

    const idx1 = sec.measures.findIndex((m) => m.id === measureId1);
    const idx2 = sec.measures.findIndex((m) => m.id === measureId2);
    if (idx1 === -1 || idx2 === -1) return sec;

    const m1 = sec.measures[idx1];
    const m2 = sec.measures[idx2];

    const mergedSourceChords = [...(m1.sourceChords || []), ...(m2.sourceChords || [])];
    const mergedChords = mergedSourceChords.map((c) => c.normalized).join(" ");

    let repeat = "";
    if (m1.repeat === "start" || m1.repeat === "both" || m2.repeat === "start") repeat = "start";
    if (m2.repeat === "end" || m2.repeat === "both" || m1.repeat === "end") {
      repeat = repeat === "start" ? "both" : "end";
    }

    const mergedMeasure = {
      ...m1,
      chords: mergedChords,
      repeat,
      ending: m2.ending || m1.ending || "",
      sourceChords: mergedSourceChords,
    };

    const newMeasures = [...sec.measures];
    const minIdx = Math.min(idx1, idx2);
    const maxIdx = Math.max(idx1, idx2);
    newMeasures.splice(maxIdx, 1);
    newMeasures.splice(minIdx, 1, mergedMeasure);

    return {
      ...sec,
      measures: newMeasures,
    };
  });

  return syncDraftMeasureWarnings({
    ...draft,
    sections,
  });
}

/**
 * Move um compasso de uma posição/seção para outra.
 *
 * @param {ImportDraft} draft
 * @param {string} sourceSectionId
 * @param {string} measureId
 * @param {string} targetSectionId
 * @param {number} [targetIndex]
 * @returns {ImportDraft}
 */
export function moveMeasure(draft, sourceSectionId, measureId, targetSectionId, targetIndex) {
  if (isSectionCompacted(draft, sourceSectionId) || isSectionCompacted(draft, targetSectionId)) {
    return draft;
  }
  let movedMeasure = null;

  const sectionsWithoutMeasure = draft.sections.map((sec) => {
    if (sec.id !== sourceSectionId) return sec;
    const idx = sec.measures.findIndex((m) => m.id === measureId);
    if (idx === -1) return sec;
    movedMeasure = sec.measures[idx];
    const newMeasures = [...sec.measures];
    newMeasures.splice(idx, 1);
    return { ...sec, measures: newMeasures };
  });

  if (!movedMeasure) return draft;

  const sections = sectionsWithoutMeasure.map((sec) => {
    if (sec.id !== targetSectionId) return sec;
    const newMeasures = [...sec.measures];
    const insertAt = typeof targetIndex === "number" && targetIndex >= 0 && targetIndex <= newMeasures.length
      ? targetIndex
      : newMeasures.length;
    newMeasures.splice(insertAt, 0, movedMeasure);
    return { ...sec, measures: newMeasures };
  });

  return syncDraftMeasureWarnings({
    ...draft,
    sections,
  });
}

/**
 * Divide uma seção em duas no índice indicado de compassos.
 *
 * @param {ImportDraft} draft
 * @param {string} sectionId
 * @param {number} atMeasureIndex
 * @param {string} [newLabel="B"]
 * @returns {ImportDraft}
 */
export function splitSection(draft, sectionId, atMeasureIndex, newLabel = "B") {
  if (isSectionCompacted(draft, sectionId)) return draft;
  const sectionIdx = draft.sections.findIndex((s) => s.id === sectionId);
  if (sectionIdx === -1) return draft;

  const sec = draft.sections[sectionIdx];
  const firstMeasures = sec.measures.slice(0, atMeasureIndex);
  const secondMeasures = sec.measures.slice(atMeasureIndex);

  const sec1 = { ...sec, measures: firstMeasures };
  const sec2 = {
    id: uid(),
    label: newLabel || "B",
    kind: sec.kind,
    measures: secondMeasures,
  };

  const sections = [...draft.sections];
  sections.splice(sectionIdx, 1, sec1, sec2);

  return syncDraftMeasureWarnings({
    ...draft,
    sections,
  });
}

/**
 * Une duas seções adjacentes em uma única.
 *
 * @param {ImportDraft} draft
 * @param {string} sectionId1
 * @param {string} sectionId2
 * @returns {ImportDraft}
 */
export function mergeSections(draft, sectionId1, sectionId2) {
  if (isSectionCompacted(draft, sectionId1) || isSectionCompacted(draft, sectionId2)) {
    return draft;
  }
  const idx1 = draft.sections.findIndex((s) => s.id === sectionId1);
  const idx2 = draft.sections.findIndex((s) => s.id === sectionId2);
  if (idx1 === -1 || idx2 === -1) return draft;

  const s1 = draft.sections[idx1];
  const s2 = draft.sections[idx2];

  const merged = {
    ...s1,
    measures: [...s1.measures, ...s2.measures],
  };

  const sections = [...draft.sections];
  const minIdx = Math.min(idx1, idx2);
  const maxIdx = Math.max(idx1, idx2);
  sections.splice(maxIdx, 1);
  sections.splice(minIdx, 1, merged);

  return syncDraftMeasureWarnings({
    ...draft,
    sections,
  });
}

/**
 * Clona um ImportDraft preservando as referências imutáveis de SourceChord e sourceSnapshot.
 *
 * @param {ImportDraft} draft
 * @returns {ImportDraft}
 */
export function cloneDraftState(draft) {
  if (!draft || typeof draft !== "object") return draft;
  return {
    ...draft,
    sections: Array.isArray(draft.sections)
      ? draft.sections.map((sec) => ({
          ...sec,
          measures: Array.isArray(sec.measures)
            ? sec.measures.map((m) => ({
                ...m,
                sourceChords: Array.isArray(m.sourceChords) ? [...m.sourceChords] : [],
              }))
            : [],
        }))
      : [],
    warnings: Array.isArray(draft.warnings) ? draft.warnings.map((w) => ({ ...w })) : [],
    exclusions: Array.isArray(draft.exclusions) ? draft.exclusions.map((e) => ({ ...e })) : [],
    repeatCompactions: Array.isArray(draft.repeatCompactions)
      ? draft.repeatCompactions.map((c) => ({
          ...c,
          keptMeasureIds: Array.isArray(c.keptMeasureIds) ? [...c.keptMeasureIds] : [],
          hiddenMeasureIds: Array.isArray(c.hiddenMeasureIds) ? [...c.hiddenMeasureIds] : [],
        }))
      : [],
    dismissedRepeatCandidateIds: Array.isArray(draft.dismissedRepeatCandidateIds)
      ? [...draft.dismissedRepeatCandidateIds]
      : [],
    sourceSnapshot: draft.sourceSnapshot,
  };
}

/**
 * Cria uma estrutura pura de histórico de edições do rascunho.
 *
 * @param {number} [limit=25]
 * @returns {DraftHistory}
 */
export function createDraftHistory(limit = 25) {
  return {
    past: [],
    limit: Number.isInteger(limit) && limit > 0 ? limit : 25,
  };
}

/**
 * Empilha um snapshot do rascunho no histórico antes de uma alteração.
 *
 * @param {DraftHistory} history
 * @param {ImportDraft} draft
 * @returns {DraftHistory}
 */
export function pushDraftHistoryState(history, draft) {
  const safeHistory = history && Array.isArray(history.past) ? history : createDraftHistory();
  if (!draft) return safeHistory;
  const nextPast = [...safeHistory.past, cloneDraftState(draft)];
  if (nextPast.length > safeHistory.limit) {
    nextPast.shift();
  }
  return {
    ...safeHistory,
    past: nextPast,
  };
}

/**
 * Desfaz a última alteração do rascunho a partir do histórico puro.
 *
 * @param {DraftHistory} history
 * @param {ImportDraft} currentDraft
 * @returns {{ draft: ImportDraft, history: DraftHistory, undone: boolean }}
 */
export function undoDraftHistoryState(history, currentDraft) {
  const safeHistory = history && Array.isArray(history.past) ? history : createDraftHistory();
  if (safeHistory.past.length === 0) {
    return {
      draft: currentDraft,
      history: safeHistory,
      undone: false,
    };
  }

  const nextPast = [...safeHistory.past];
  const previousDraft = nextPast.pop();
  return {
    draft: cloneDraftState(previousDraft),
    history: {
      ...safeHistory,
      past: nextPast,
    },
    undone: true,
  };
}

/**
 * Converte um ImportDraft em uma Song válida e estruturada no modelo v2.
 * Somente deve ser chamada após confirmação do usuário.
 *
 * @param {ImportDraft} draft
 * @returns {import("./store.js").Song}
 */
export function convertDraftToSong(draft) {
  const base = blankSong();
  const now = new Date().toISOString();

  const tabNotes = draft.sections
    .filter((s) => s.kind === "tab" && s.tabContent)
    .map((s) => `[Tablatura - ${s.label}]:\n${s.tabContent}`)
    .join("\n\n");

  const chordSections = draft.sections.filter((s) => s.kind === "chords" || s.measures.length > 0);
  const compactions = Array.isArray(draft.repeatCompactions) ? draft.repeatCompactions : [];

  const finalSections = chordSections.length > 0
    ? chordSections.map((s) => {
        const secCompactions = compactions.filter((c) => c && c.sectionId === s.id);
        const hiddenIds = new Set(secCompactions.flatMap((c) => c.hiddenMeasureIds || []));
        const startIds = new Set(secCompactions.map((c) => c.keptMeasureIds?.[0]).filter(Boolean));
        const endIds = new Set(secCompactions.map((c) => c.keptMeasureIds?.at(-1)).filter(Boolean));

        const visibleMeasures = s.measures.filter((m) => !hiddenIds.has(m.id));
        return {
          id: uid(),
          label: s.label || "A",
          measures: visibleMeasures.map((m) => {
            let repeat = m.repeat || "";
            const isStart = startIds.has(m.id);
            const isEnd = endIds.has(m.id);
            if (isStart && isEnd) {
              repeat = "both";
            } else if (isStart) {
              repeat = repeat === "end" || repeat === "both" ? "both" : "start";
            } else if (isEnd) {
              repeat = repeat === "start" || repeat === "both" ? "both" : "end";
            }
            return {
              id: uid(),
              chords: m.chords || "",
              repeat,
              ending: m.ending || "",
            };
          }),
        };
      })
    : base.sections;

  return {
    ...base,
    id: uid(),
    title: draft.title || "Sem título",
    composer: draft.composer || draft.artist || "",
    key: draft.key || "C",
    tempo: draft.tempo || 120,
    timeSignature: draft.timeSignature || "4/4",
    barsPerRow: draft.barsPerRow || 4,
    notes: tabNotes ? (draft.artist ? `Artista: ${draft.artist}\n\n${tabNotes}` : tabNotes) : (draft.artist ? `Artista: ${draft.artist}` : ""),
    sourceSnapshot: draft.sourceSnapshot || null,
    sections: finalSections,
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Valida se um rascunho atende a todos os requisitos para ser confirmado e salvo na biblioteca.
 * Exige escolha explícita da fórmula de compasso (Don Norman: restrições e prevenção de erro).
 *
 * @param {ImportDraft} draft
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validateDraftForConfirmation(draft) {
  const errors = [];
  if (!draft) {
    return { valid: false, errors: ["Rascunho inexistente."] };
  }
  if (!draft.timeSignature || !draft.timeSignature.trim()) {
    errors.push("Escolha uma fórmula de compasso (ex.: 4/4, 2/4, 3/4, 6/8) antes de confirmar a música.");
  }
  if (!draft.title || !draft.title.trim()) {
    errors.push("A música precisa de um título.");
  }
  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Extrai a assinatura normalizada de um compasso para comparação conservadora de repetição.
 * Retorna null se o compasso possuir barra de repetição, casa de final, estiver vazio ou contiver apenas NC.
 *
 * @param {DraftMeasure | { chords?: string, repeat?: string, ending?: string, sourceChords?: SourceChord[] }} measure
 * @returns {{ signature: string, tokens: string[] } | null}
 */
export function getMeasureRepeatSignature(measure) {
  if (!measure || typeof measure !== "object") return null;
  if (String(measure.repeat || "").trim() || String(measure.ending || "").trim()) {
    return null;
  }

  const tokens = Array.isArray(measure.sourceChords) && measure.sourceChords.length > 0
    ? measure.sourceChords.map((c) => String(c?.normalized || c?.raw || "").trim()).filter(Boolean)
    : String(measure.chords || "")
        .trim()
        .split(/\s+/)
        .filter(Boolean);

  if (tokens.length === 0 || tokens.every((t) => t === "NC")) {
    return null;
  }

  return {
    signature: tokens.join(" "),
    tokens,
  };
}

function matchesSignatureRange(sigs, firstStart, secondStart, length) {
  for (let offset = 0; offset < length; offset += 1) {
    const a = sigs[firstStart + offset];
    const b = sigs[secondStart + offset];
    if (!a || !b || a.signature !== b.signature) return false;
  }
  return true;
}

function isPrimitiveSignatureBlock(sigs, start, length) {
  for (let period = 1; period < length; period += 1) {
    if (length % period !== 0) continue;
    let allMatch = true;
    for (let offset = period; offset < length; offset += period) {
      if (!matchesSignatureRange(sigs, start, start + offset, period)) {
        allMatch = false;
        break;
      }
    }
    if (allMatch) return false;
  }
  return true;
}

/**
 * Detecta candidatos conservadores de repetição (2x consecutivos, >= 2 compassos por bloco)
 * dentro de uma única seção musical, sem mutar a seção.
 *
 * @param {DraftSection} section
 * @param {Set<string>} [excludedMeasureIds]
 * @returns {RepeatCandidate[]}
 */
export function detectSectionRepeatCandidates(section, excludedMeasureIds = new Set()) {
  if (!section || section.kind !== "chords" || !Array.isArray(section.measures)) {
    return [];
  }
  const measures = section.measures;
  const n = measures.length;
  if (n < 4) return [];

  const sigs = measures.map((m) => (excludedMeasureIds.has(m?.id) ? null : getMeasureRepeatSignature(m)));
  const rawCandidates = [];

  for (let length = Math.floor(n / 2); length >= 2; length -= 1) {
    for (let start = 0; start <= n - 2 * length; start += 1) {
      if (!matchesSignatureRange(sigs, start, start + length, length)) continue;

      const distinctChords = new Set();
      for (let offset = 0; offset < length; offset += 1) {
        for (const token of sigs[start + offset].tokens) {
          distinctChords.add(token);
        }
      }
      if (distinctChords.size < 2) continue;

      if (!isPrimitiveSignatureBlock(sigs, start, length)) continue;

      const hasPrecedingOccurrence =
        start >= length && matchesSignatureRange(sigs, start - length, start, length);
      const hasFollowingOccurrence =
        start + 3 * length <= n && matchesSignatureRange(sigs, start, start + 2 * length, length);
      const hasImmediatePrefixOverlap =
        start > 0 && sigs[start - 1]?.signature === sigs[start + length - 1]?.signature;
      const hasImmediateSuffixOverlap =
        start + 2 * length < n && sigs[start]?.signature === sigs[start + 2 * length]?.signature;
      if (
        hasPrecedingOccurrence ||
        hasFollowingOccurrence ||
        hasImmediatePrefixOverlap ||
        hasImmediateSuffixOverlap
      ) {
        continue;
      }

      rawCandidates.push({ start, length });
    }
  }

  rawCandidates.sort((a, b) => b.length - a.length || a.start - b.start);

  const selected = [];
  for (const cand of rawCandidates) {
    const candEnd = cand.start + 2 * cand.length - 1;
    const overlaps = selected.some((sel) => {
      const selEnd = sel.start + 2 * sel.length - 1;
      return cand.start <= selEnd && candEnd >= sel.start;
    });
    if (!overlaps) {
      selected.push(cand);
    }
  }

  selected.sort((a, b) => a.start - b.start);

  return selected.map(({ start, length }) => {
    const firstMeasures = measures.slice(start, start + length);
    const repeatedMeasures = measures.slice(start + length, start + 2 * length);
    const firstMeasureIds = firstMeasures.map((m) => m.id);
    const repeatedMeasureIds = repeatedMeasures.map((m) => m.id);
    const firstStartNum = start + 1;
    const firstEndNum = start + length;
    const secondStartNum = start + length + 1;
    const secondEndNum = start + 2 * length;
    const chordsPreview = sigs.slice(start, start + length).map((s) => s.signature);
    return {
      id: `${section.id}:${firstMeasureIds.join(",")}=>${repeatedMeasureIds.join(",")}`,
      sectionId: section.id,
      sectionLabel: section.label || "A",
      firstMeasureIds,
      repeatedMeasureIds,
      times: 2,
      savedMeasures: length,
      startMeasureNumber: firstStartNum,
      endMeasureNumber: secondEndNum,
      chordsPreview,
      summary: `Compassos ${firstStartNum}–${firstEndNum} repetem em ${secondStartNum}–${secondEndNum} (economia de ${length} compassos).`,
    };
  });
}

/**
 * Encontra progressões consecutivas exatamente repetidas em todas as seções elegíveis
 * do rascunho, sem mutar o rascunho.
 *
 * @param {ImportDraft} draft
 * @returns {RepeatCandidate[]}
 */
export function detectRepeatCandidates(draft) {
  if (!draft || !Array.isArray(draft.sections)) return [];
  const compactions = Array.isArray(draft.repeatCompactions) ? draft.repeatCompactions : [];
  const dismissedIds = new Set(
    Array.isArray(draft.dismissedRepeatCandidateIds) ? draft.dismissedRepeatCandidateIds : []
  );
  const compactedSectionIds = new Set(compactions.map((c) => c.sectionId));
  const excludedMeasureIds = new Set(
    compactions.flatMap((c) => [...(c.keptMeasureIds || []), ...(c.hiddenMeasureIds || [])])
  );

  const candidates = [];
  for (const section of draft.sections) {
    if (compactedSectionIds.has(section.id)) continue;
    const secCandidates = detectSectionRepeatCandidates(section, excludedMeasureIds);
    for (const cand of secCandidates) {
      if (!dismissedIds.has(cand.id)) {
        candidates.push(cand);
      }
    }
  }
  return candidates;
}

export const findConsecutiveRepeatCandidates = detectRepeatCandidates;

/**
 * Verifica se uma seção possui ao menos uma compactação ativa de repetição.
 *
 * @param {ImportDraft} draft
 * @param {string} sectionId
 * @returns {boolean}
 */
export function isSectionCompacted(draft, sectionId) {
  if (!draft || !Array.isArray(draft.repeatCompactions)) return false;
  return draft.repeatCompactions.some((c) => c && c.sectionId === sectionId);
}

/**
 * Retorna a lista de compactações ativas pertencentes a uma seção.
 *
 * @param {ImportDraft} draft
 * @param {string} sectionId
 * @returns {RepeatCompaction[]}
 */
export function getSectionRepeatCompactions(draft, sectionId) {
  if (!draft || !Array.isArray(draft.repeatCompactions)) return [];
  return draft.repeatCompactions.filter((c) => c && c.sectionId === sectionId);
}

/**
 * Retorna os compassos visíveis de uma seção no editor de rascunho,
 * ocultando os compassos da segunda ocorrência de compactações ativas e
 * projetando `repeat` ("start"/"end"/"both") nos compassos mantidos.
 *
 * @param {ImportDraft} draft
 * @param {DraftSection} section
 * @returns {DraftMeasure[]}
 */
export function getVisibleSectionMeasures(draft, section) {
  if (!section || !Array.isArray(section.measures)) return [];
  const secCompactions = getSectionRepeatCompactions(draft, section.id);
  if (secCompactions.length === 0) return section.measures;

  const hiddenIds = new Set(secCompactions.flatMap((c) => c.hiddenMeasureIds || []));
  const startIds = new Set(secCompactions.map((c) => c.keptMeasureIds?.[0]).filter(Boolean));
  const endIds = new Set(secCompactions.map((c) => c.keptMeasureIds?.at(-1)).filter(Boolean));

  return section.measures
    .filter((m) => !hiddenIds.has(m.id))
    .map((m) => {
      let repeat = m.repeat || "";
      const isStart = startIds.has(m.id);
      const isEnd = endIds.has(m.id);
      if (isStart && isEnd) {
        repeat = "both";
      } else if (isStart) {
        repeat = repeat === "end" || repeat === "both" ? "both" : "start";
      } else if (isEnd) {
        repeat = repeat === "start" || repeat === "both" ? "both" : "end";
      }
      if (repeat === (m.repeat || "")) return m;
      return {
        ...m,
        repeat,
      };
    });
}

/**
 * Aplica uma compactação reversível a partir de um candidato de repetição válido.
 * Preserva todos os compassos canônicos em `section.measures` e todos os invariantes de proveniência.
 *
 * @param {ImportDraft} draft
 * @param {string | RepeatCandidate} candidateOrId
 * @returns {ImportDraft}
 */
export function applyRepeatCompaction(draft, candidateOrId) {
  if (!draft || !Array.isArray(draft.sections)) return draft;
  const targetId = typeof candidateOrId === "string" ? candidateOrId : candidateOrId?.id;
  if (!targetId) return draft;

  const candidates = detectRepeatCandidates(draft);
  const candidate = candidates.find((c) => c.id === targetId);
  if (!candidate) return draft;

  const existingCompactions = Array.isArray(draft.repeatCompactions) ? draft.repeatCompactions : [];
  if (existingCompactions.some((c) => c.id === candidate.id || c.sectionId === candidate.sectionId)) {
    return draft;
  }

  /** @type {RepeatCompaction} */
  const compaction = {
    id: candidate.id,
    sectionId: candidate.sectionId,
    keptMeasureIds: [...candidate.firstMeasureIds],
    hiddenMeasureIds: [...candidate.repeatedMeasureIds],
    times: candidate.times || 2,
  };

  return {
    ...draft,
    repeatCompactions: [...existingCompactions, compaction],
  };
}

/**
 * Expande uma compactação reversível (por id da compactação ou id da seção),
 * restaurando a visualização literal completa da seção.
 *
 * @param {ImportDraft} draft
 * @param {string} compactionOrSectionId
 * @returns {ImportDraft}
 */
export function expandRepeatCompaction(draft, compactionOrSectionId) {
  if (!draft || !Array.isArray(draft.repeatCompactions) || !compactionOrSectionId) {
    return draft;
  }
  const nextCompactions = draft.repeatCompactions.filter(
    (c) => c.id !== compactionOrSectionId && c.sectionId !== compactionOrSectionId
  );
  if (nextCompactions.length === draft.repeatCompactions.length) {
    return draft;
  }
  return {
    ...draft,
    repeatCompactions: nextCompactions,
  };
}

/**
 * Registra que o usuário escolheu "Manter completo" para um candidato de repetição,
 * ocultando a sugestão sem alterar os compassos da seção.
 *
 * @param {ImportDraft} draft
 * @param {string} candidateId
 * @returns {ImportDraft}
 */
export function dismissRepeatCandidate(draft, candidateId) {
  if (!draft || !candidateId) return draft;
  const existing = Array.isArray(draft.dismissedRepeatCandidateIds)
    ? draft.dismissedRepeatCandidateIds
    : [];
  if (existing.includes(candidateId)) return draft;
  return {
    ...draft,
    dismissedRepeatCandidateIds: [...existing, candidateId],
  };
}

/**
 * Constrói uma visão amigável de sugestão de repetição para exibição no editor de rascunho.
 *
 * @param {RepeatCandidate} candidate
 * @returns {RepeatSuggestionView}
 */
export function buildRepeatSuggestionView(candidate) {
  const blockPreview = Array.isArray(candidate?.chordsPreview)
    ? candidate.chordsPreview.join(" | ")
    : "";
  return {
    candidateId: candidate.id,
    sectionId: candidate.sectionId,
    sectionLabel: candidate.sectionLabel || "A",
    summary: candidate.summary,
    before: `| ${blockPreview} | ${blockPreview} |`,
    after: `|: ${blockPreview} :| (2x)`,
    savedMeasures: candidate.savedMeasures,
  };
}

/**
 * Retorna as sugestões de repetição formatadas para uma seção específica do rascunho.
 *
 * @param {ImportDraft} draft
 * @param {string} sectionId
 * @returns {RepeatSuggestionView[]}
 */
export function getSectionRepeatSuggestionViews(draft, sectionId) {
  if (!draft || !sectionId) return [];
  return detectRepeatCandidates(draft)
    .filter((c) => c.sectionId === sectionId)
    .map(buildRepeatSuggestionView);
}
