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
 */

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
  };

  return draft;
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
        if (collected[ci] !== source.allChords[ci]) {
          errors.push(`Divergência de acorde no índice ${ci}: ${collected[ci]?.raw} !== ${source.allChords[ci]?.raw}`);
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
 * Remove aviso NO_TIME_SIGNATURE quando um valor é definido.
 *
 * @param {ImportDraft} draft
 * @param {string} newTimeSig
 * @returns {ImportDraft}
 */
export function updateDraftTimeSignature(draft, newTimeSig) {
  const timeSignature = String(newTimeSig || "").trim();
  const warnings = draft.warnings.filter((w) => !(w.code === "NO_TIME_SIGNATURE" && timeSignature));

  return {
    ...draft,
    timeSignature,
    warnings,
  };
}

/**
 * Divide um compasso em dois.
 * Se o compasso tiver mais de um acorde, divide a lista de acordes no splitIndex.
 * Se tiver apenas um acorde ou estiver vazio, mantém no primeiro e cria um compasso vazio como segundo.
 *
 * @param {ImportDraft} draft
 * @param {string} sectionId
 * @param {string} measureId
 * @param {number} [splitIndex=1]
 * @returns {ImportDraft}
 */
export function splitMeasure(draft, sectionId, measureId, splitIndex = 1) {
  const sections = draft.sections.map((sec) => {
    if (sec.id !== sectionId) return sec;
    const measureIndex = sec.measures.findIndex((m) => m.id === measureId);
    if (measureIndex === -1) return sec;

    const target = sec.measures[measureIndex];
    const sourceChords = target.sourceChords || [];

    const firstSourceChords = sourceChords.slice(0, splitIndex);
    const secondSourceChords = sourceChords.slice(splitIndex);

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

  return {
    ...draft,
    sections,
  };
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

  return {
    ...draft,
    sections,
  };
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

  return {
    ...draft,
    sections,
  };
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

  return {
    ...draft,
    sections,
  };
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

  return {
    ...draft,
    sections,
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

  const finalSections = chordSections.length > 0
    ? chordSections.map((s) => ({
        id: uid(),
        label: s.label || "A",
        measures: s.measures.map((m) => ({
          id: uid(),
          chords: m.chords || "",
          repeat: m.repeat || "",
          ending: m.ending || "",
        })),
      }))
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
