import { normalizeKey } from "./chords.js";
import { normalizeCifraChord } from "./cifra.js";
import { uid } from "./store.js";

/**
 * @typedef {Object} SourceChord
 * @property {string} raw
 * @property {string} normalized
 */

/**
 * @typedef {Object} SourceLine
 * @property {"chords" | "tab" | "text"} type
 * @property {string} raw
 * @property {SourceChord[]} chords
 */

/**
 * @typedef {Object} SourceBlock
 * @property {string} id
 * @property {string | null} label
 * @property {"section" | "tab" | "anonymous"} kind
 * @property {SourceLine[]} lines
 */

/**
 * @typedef {Object} SourceMetadata
 * @property {string} title
 * @property {string} artist
 * @property {string} composer
 * @property {string} key
 * @property {string} url
 */

/**
 * @typedef {Object} SourceExclusion
 * @property {string} raw
 * @property {string} reason
 * @property {string} [line]
 */

/**
 * @typedef {Object} CifraSource
 * @property {SourceMetadata} metadata
 * @property {SourceBlock[]} blocks
 * @property {SourceChord[]} allChords
 * @property {SourceExclusion[]} exclusions
 */

const CHORD_REST = /^(?:maj|min|dim|aug|sus|add|m|M|b|#|\d|°|º|ø|Ø|\+|-|\(|\)|\/(?=\d))*$/i;

/**
 * Evaluates whether a token represents a musical chord.
 * Returns the chord object or null with exclusion reason if rejected.
 *
 * @param {string} token
 * @returns {{ chord: SourceChord | null, reason?: string }}
 */
export function evaluateChordToken(token) {
  const clean = String(token || "").replace(/^[,;[\]]+|[,.;:[\]]+$/g, "");
  if (!clean) return { chord: null, reason: "Token vazio ou pontuação" };

  const slash = clean.match(/^(.*?)(?:\/([A-G](?:#|b)?))?$/);
  if (!slash) return { chord: null, reason: "Formato de baixo inválido" };

  const match = slash[1].match(/^([A-G](?:#|b)?)(.*)$/);
  if (!match) return { chord: null, reason: "Não inicia com nota musical (A-G)" };

  if (!CHORD_REST.test(match[2])) {
    return { chord: null, reason: "Caracteres não reconhecidos na extensão do acorde" };
  }

  const rest = match[2].replace(/maj|min|dim|aug|sus|add/gi, "");
  if (/[a-z]{2,}/i.test(rest)) {
    return { chord: null, reason: "Palavra de texto não musical após a nota" };
  }

  return {
    chord: {
      raw: clean,
      normalized: normalizeCifraChord(clean),
    },
  };
}

/**
 * Determines whether a line is a guitar tab line.
 *
 * @param {string} line
 * @returns {boolean}
 */
export function isTabLine(line) {
  const text = String(line || "").trim();
  if (/^[eBGDAE]\s*\|[-0-9/\\pbhr~s\s|]+$/i.test(text)) return true;
  if (/^\|[-0-9/\\pbhr~s\s|]+\|$/.test(text) && text.length > 8) return true;
  if (text.includes("---") && /[-0-9|]{6,}/.test(text)) return true;
  return false;
}

function fold(text) {
  return String(text || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

/**
 * Categorizes a section label into block kind.
 *
 * @param {string | null} label
 * @returns {"section" | "tab" | "anonymous"}
 */
export function detectBlockKind(label) {
  if (!label) return "anonymous";
  const name = fold(label);
  if (name.includes("tab")) return "tab";
  return "section";
}

function decodeAttr(value) {
  return String(value || "")
    .replace(/&deg;|&#176;/g, "°")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"');
}

function textOf(fragment) {
  return String(fragment || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Parses a plain text input into a literal CifraSource.
 *
 * @param {string} text
 * @param {string} [url]
 * @returns {CifraSource}
 */
export function parseCifraPlainSource(text, url = "") {
  const source = String(text || "");
  const lines = source.split(/\r?\n/);

  // 1. Extract metadata
  const title = source.match(/^(?:título|title)\s*:\s*(.+)$/im)?.[1]?.trim() || "";
  const artist = source.match(/^(?:artista|artist)\s*:\s*(.+)$/im)?.[1]?.trim() || "";
  const composer = source.match(/^(?:compositor|composer|composição)\s*:\s*(.+)$/im)?.[1]?.trim() || "";
  const rawKey = source.match(/\bTom\s*:\s*([A-G](?:#|b)?m?)\b/i)?.[1] || "";
  const key = normalizeKey(rawKey) || rawKey;

  const blocks = [];
  const allChords = [];
  const exclusions = [];

  let currentBlock = null;

  const ensureBlock = (label) => {
    const kind = detectBlockKind(label);
    const newBlock = {
      id: uid(),
      label: label || null,
      kind,
      lines: [],
    };
    blocks.push(newBlock);
    currentBlock = newBlock;
    return newBlock;
  };

  for (const rawLine of lines) {
    let line = rawLine.trim();
    if (!line) continue;

    // Ignore metadata header lines
    if (/^(?:título|title|artista|artist|compositor|composer|composição|tom|estilo|andamento|tempo|bpm|compasso)\s*:/i.test(line)) {
      continue;
    }

    // Check for section headers [Intro], [Refrão], [Tab - Intro]
    let sectionHeaderMatch = false;
    while (line) {
      const labelMatch = line.match(/^\[([^[\]]{1,60})]\s*/);
      if (!labelMatch) break;
      ensureBlock(labelMatch[1].trim());
      line = line.slice(labelMatch[0].length).trim();
      sectionHeaderMatch = true;
    }

    if (!line && sectionHeaderMatch) continue;

    // If chords appear before any section, create an anonymous block
    if (!currentBlock) {
      ensureBlock(null);
    }

    // Check if line is a tab
    if (isTabLine(line)) {
      currentBlock.lines.push({
        type: "tab",
        raw: rawLine,
        chords: [],
      });
      continue;
    }

    // Check tokens on line for chords
    const tokens = line.split(/\s+/).filter(Boolean);
    const lineChords = [];

    for (const token of tokens) {
      const evalResult = evaluateChordToken(token);
      if (evalResult.chord) {
        lineChords.push(evalResult.chord);
      } else {
        exclusions.push({
          raw: token,
          reason: evalResult.reason || "Não elegível",
          line: rawLine,
        });
      }
    }

    if (lineChords.length > 0) {
      currentBlock.lines.push({
        type: "chords",
        raw: rawLine,
        chords: lineChords,
      });
      allChords.push(...lineChords);
    } else {
      currentBlock.lines.push({
        type: "text",
        raw: rawLine,
        chords: [],
      });
    }
  }

  // Filter out completely empty blocks
  const validBlocks = blocks.filter((b) => b.lines.length > 0);

  return {
    metadata: {
      title,
      artist,
      composer,
      key,
      url,
    },
    blocks: validBlocks,
    allChords,
    exclusions,
  };
}

/**
 * Parses Cifra Club HTML into a literal CifraSource.
 *
 * @param {string} html
 * @param {string} [url]
 * @returns {CifraSource}
 */
export function parseCifraHtmlSource(html, url = "") {
  const content = String(html || "");

  // Metadata extraction
  const titleMatch = content.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1] || "";
  const title = textOf(titleMatch);

  const artistMatch = content.match(/<h2\b[^>]*>([\s\S]*?)<\/h2>/i)?.[1] || "";
  const artist = textOf(artistMatch);

  const composerMatch = content.match(/Composição\s*:?\s*(.{3,200}?)(?:\s+Essa informa|\s+Envio por|<|$)/i)?.[1] || "";
  const composer = textOf(composerMatch);

  const keyMatch = content.match(/\bTom\s*:\s*([A-G](?:#|b)?m?)\b/i)?.[1] ||
    content.match(/<span[^>]*id="cifra_tom"[^>]*>[\s\S]*?<a[^>]*>([A-G](?:#|b)?m?)<\/a>/i)?.[1] || "";
  const key = normalizeKey(keyMatch) || keyMatch;

  const pre = content.match(/<pre\b[^>]*>([\s\S]*?)<\/pre>/i)?.[1] || content;

  // We split the pre content into lines or top-level elements
  const blocks = [];
  const allChords = [];
  const exclusions = [];

  let currentBlock = null;

  const ensureBlock = (label) => {
    const kind = detectBlockKind(label);
    const newBlock = {
      id: uid(),
      label: label || null,
      kind,
      lines: [],
    };
    blocks.push(newBlock);
    currentBlock = newBlock;
    return newBlock;
  };

  // Split lines inside pre tag
  const rawLines = pre.split(/\r?\n/);

  for (const rawLine of rawLines) {
    const trimmed = rawLine.trim();
    if (!trimmed) continue;

    // Check for section headers: [Intro], [Tab - Intro], [Refrão], etc.
    const plainLine = textOf(trimmed);
    const labelMatch = plainLine.match(/^\[([^[\]]{1,60})]$/);

    if (labelMatch) {
      ensureBlock(labelMatch[1].trim());
      continue;
    }

    if (!currentBlock) {
      ensureBlock(null);
    }

    if (isTabLine(plainLine)) {
      currentBlock.lines.push({
        type: "tab",
        raw: rawLine,
        chords: [],
      });
      continue;
    }

    // Extract chords from HTML (data-chord-name attributes or <b> tags)
    const chordsOnLine = [];
    const chordTagMatches = [...rawLine.matchAll(/<b\b([^>]*)>([\s\S]*?)<\/b>/gi)];

    if (chordTagMatches.length > 0) {
      for (const m of chordTagMatches) {
        const attrMatch = m[1].match(/data-chord-name="([^"]+)"/i);
        const chordRaw = attrMatch ? decodeAttr(attrMatch[1]) : textOf(m[2]);

        const evalResult = evaluateChordToken(chordRaw);
        if (evalResult.chord) {
          chordsOnLine.push(evalResult.chord);
        } else {
          exclusions.push({
            raw: chordRaw,
            reason: evalResult.reason || "Acorde rejeitado na tag <b>",
            line: rawLine,
          });
        }
      }
    } else {
      // Line without <b> tags: check if it's a plain chord line
      const words = plainLine.split(/\s+/).filter(Boolean);
      for (const word of words) {
        const evalResult = evaluateChordToken(word);
        if (evalResult.chord) {
          chordsOnLine.push(evalResult.chord);
        }
      }
    }

    if (chordsOnLine.length > 0) {
      currentBlock.lines.push({
        type: "chords",
        raw: rawLine,
        chords: chordsOnLine,
      });
      allChords.push(...chordsOnLine);
    } else {
      currentBlock.lines.push({
        type: "text",
        raw: rawLine,
        chords: [],
      });
    }
  }

  const validBlocks = blocks.filter((b) => b.lines.length > 0);

  return {
    metadata: {
      title,
      artist,
      composer,
      key,
      url,
    },
    blocks: validBlocks,
    allChords,
    exclusions,
  };
}

/**
 * Universal entry point to parse a literal CifraSource from either HTML or plain text.
 *
 * @param {string} input
 * @param {{ url?: string, sourceFormat?: "auto" | "html" | "plain" }} [options]
 * @returns {CifraSource}
 */
export function parseCifraSource(input, options = {}) {
  const format = options.sourceFormat || "auto";
  const url = options.url || "";
  const text = String(input || "");

  if (format === "html" || (format === "auto" && (text.includes("<pre") || text.includes("<html") || text.includes("<h1")))) {
    return parseCifraHtmlSource(text, url);
  }
  return parseCifraPlainSource(text, url);
}

/**
 * Verifies that a CifraSource conforms strictly to all architectural invariants.
 *
 * @param {CifraSource} source
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function verifyCifraSourceInvariants(source) {
  const errors = [];

  if (!source || typeof source !== "object") {
    return { valid: false, errors: ["CifraSource deve ser um objeto válido"] };
  }

  if (!source.metadata || typeof source.metadata !== "object") {
    errors.push("Metadados ausentes em CifraSource");
  }

  if (!Array.isArray(source.blocks)) {
    errors.push("CifraSource.blocks deve ser um array");
  } else {
    for (let bi = 0; bi < source.blocks.length; bi += 1) {
      const block = source.blocks[bi];
      if (!block.id) errors.push(`Bloco ${bi} sem id`);
      if (!["section", "tab", "anonymous"].includes(block.kind)) {
        errors.push(`Bloco ${bi} com kind inválido: ${block.kind}`);
      }
      if (block.kind === "anonymous" && block.label !== null) {
        errors.push(`Bloco anônimo ${bi} deve ter label nulo`);
      }
      if (!Array.isArray(block.lines) || block.lines.length === 0) {
        errors.push(`Bloco ${bi} vazio`);
      }
    }
  }

  if (!Array.isArray(source.allChords)) {
    errors.push("CifraSource.allChords deve ser um array");
  } else {
    // Invariant: allChords must match exact concatenation of all block chords
    const collected = [];
    for (const block of source.blocks || []) {
      for (const line of block.lines || []) {
        for (const chord of line.chords || []) {
          collected.push(chord);
        }
      }
    }
    if (collected.length !== source.allChords.length) {
      errors.push(
        `Divergência na contagem de acordes: allChords tem ${source.allChords.length}, mas blocos somam ${collected.length}`
      );
    } else {
      for (let ci = 0; ci < collected.length; ci += 1) {
        if (collected[ci] !== source.allChords[ci]) {
          errors.push(`Divergência de sequência em allChords no índice ${ci}`);
          break;
        }
      }
    }

    for (let ci = 0; ci < source.allChords.length; ci += 1) {
      const chord = source.allChords[ci];
      if (!chord.raw || typeof chord.raw !== "string") {
        errors.push(`Acorde ${ci} sem raw string`);
      }
      if (!chord.normalized || typeof chord.normalized !== "string") {
        errors.push(`Acorde ${ci} sem normalized string`);
      }
    }
  }

  if (Array.isArray(source.exclusions)) {
    for (let xi = 0; xi < source.exclusions.length; xi += 1) {
      const ex = source.exclusions[xi];
      if (!ex.raw || !ex.reason) {
        errors.push(`Exclusão ${xi} sem raw ou reason`);
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
