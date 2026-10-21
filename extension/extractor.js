/**
 * @typedef {Object} ClipperMetadata
 * @property {string} [title]
 * @property {string} [artist]
 * @property {string} [key]
 */

/**
 * @typedef {Object} ClipperChordLine
 * @property {"chords"} type
 * @property {string[]} chords
 */

/**
 * @typedef {Object} ClipperTabLine
 * @property {"tab"} type
 * @property {string} raw
 */

/** @typedef {ClipperChordLine | ClipperTabLine} ClipperLine */

/**
 * @typedef {Object} ClipperBlock
 * @property {string | null} label
 * @property {"section" | "tab" | "anonymous"} kind
 * @property {ClipperLine[]} lines
 */

/**
 * @typedef {Object} ClipperSnapshot
 * @property {ClipperMetadata} metadata
 * @property {ClipperBlock[]} blocks
 */

/**
 * @typedef {{ ok: true, text: string, chordCount: number } |
 *   { ok: false, error: "NO_CHORDS" | "INVALID_CHORD" | "INVALID_TAB", message: string }} ClipperExtractionResult
 */

const CHORD_PATTERN = /^[A-G](?:#|b)?(?:(?:maj|min|dim|aug|sus|add|m|M)|\d|[°ºøØ+()#b-])*(?:\/[A-G](?:#|b)?)?$/;
const TAB_PATTERN = /^(?:[eBGDAE]\s*\|[-0-9/\\pbhr~s\s|]+|\|[-0-9/\\pbhr~s\s|]{7,}\|)$/i;

function inline(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function sectionLabel(block) {
  if (block.kind === "anonymous") return "";

  const label = inline(block.label).replace(/[[\]]/g, "").slice(0, 60);
  if (block.kind === "tab") {
    if (/tab/i.test(label)) return label;
    return label ? `Tab - ${label}` : "Tablatura";
  }
  return label || "Seção";
}

function serializeChordLine(line) {
  if (!Array.isArray(line.chords)) return [];
  return line.chords.map((chord) => inline(chord));
}

function serializeTabLine(line) {
  return String(line.raw || "").trim();
}

/**
 * Converts a lyric-free browser snapshot into the canonical text consumed by the Caderno.
 * Unknown line types are ignored so prose cannot cross this boundary.
 *
 * @param {ClipperSnapshot} snapshot
 * @returns {ClipperExtractionResult}
 */
export function extractCanonicalCifra(snapshot) {
  const groups = [];
  const metadata = snapshot?.metadata || {};
  const metadataLines = [];
  const title = inline(metadata.title);
  const artist = inline(metadata.artist);
  const key = inline(metadata.key);

  if (title) metadataLines.push(`Título: ${title}`);
  if (artist) metadataLines.push(`Artista: ${artist}`);
  if (key) metadataLines.push(`Tom: ${key}`);
  if (metadataLines.length) groups.push(metadataLines.join("\n"));

  let chordCount = 0;
  for (const block of snapshot?.blocks || []) {
    const lines = [];
    const label = sectionLabel(block);
    if (label) lines.push(`[${label}]`);

    for (const line of block.lines || []) {
      if (line.type === "chords") {
        const chords = serializeChordLine(line);
        if (chords.some((chord) => !CHORD_PATTERN.test(chord))) {
          return {
            ok: false,
            error: "INVALID_CHORD",
            message: "A página contém um acorde que não pôde ser reconhecido com segurança.",
          };
        }
        if (chords.length) {
          lines.push(chords.join(" "));
          chordCount += chords.length;
        }
      } else if (line.type === "tab") {
        const tab = serializeTabLine(line);
        if (tab && !TAB_PATTERN.test(tab)) {
          return {
            ok: false,
            error: "INVALID_TAB",
            message: "A página contém uma linha de tablatura que não pôde ser reconhecida com segurança.",
          };
        }
        if (tab) lines.push(tab);
      }
    }

    if (lines.some((line) => !/^\[[^\]]+]$/.test(line))) {
      groups.push(lines.join("\n"));
    }
  }

  if (chordCount === 0) {
    return {
      ok: false,
      error: "NO_CHORDS",
      message: "Nenhum acorde reconhecível foi encontrado na página.",
    };
  }

  return {
    ok: true,
    text: groups.join("\n\n"),
    chordCount,
  };
}
