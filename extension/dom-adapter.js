/**
 * @typedef {import("./extractor.js").ClipperSnapshot} ClipperSnapshot
 * @typedef {import("./extractor.js").ClipperBlock} ClipperBlock
 */

/**
 * @typedef {Object} DomAdapterError
 * @property {"NOT_CHORD_PAGE" | "DOM_STRUCTURE_CHANGED" | "NO_CHORDS"} code
 * @property {string} message
 */

/**
 * @typedef {{ ok: true, snapshot: ClipperSnapshot } | { ok: false, error: DomAdapterError }} DomExtractionResult
 */

/**
 * Reads a Cifra Club DOM document and produces a pure ClipperSnapshot without lyrics.
 * Self-contained so it can be passed directly to `chrome.scripting.executeScript({ func })`
 * or Playwright's `page.evaluate(extractDomSnapshot)`.
 *
 * @param {Document} [doc]
 * @returns {DomExtractionResult}
 */
export function extractDomSnapshot(doc = document) {
  const SECTION_MARKER_GLOBAL = /\[([^[\]]{1,60})]/g;
  const TAB_LINE_PATTERN = /^(?:[eBGDAE]\s*\|[-0-9/\\pbhr~s\s|]+|\|[-0-9/\\pbhr~s\s|]{7,}\|)$/i;

  /** @param {unknown} value */
  const inline = (value) => String(value || "").replace(/\s+/g, " ").trim();

  /** @param {string} text */
  const extractSectionLabels = (text) => {
    const labels = [];
    for (const match of String(text || "").matchAll(SECTION_MARKER_GLOBAL)) {
      const label = inline(match[1]);
      if (label) labels.push(label);
    }
    return labels;
  };

  /** @param {Node} node */
  const textUntilNextChord = (node) => {
    let text = "";
    let cursor = node.nextSibling;
    while (cursor) {
      if (cursor.nodeType === 1 && /** @type {Element} */ (cursor).tagName === "B") {
        break;
      }
      text += cursor.textContent || "";
      cursor = cursor.nextSibling;
    }
    return text;
  };

  const root = doc?.documentElement;
  if (!root || !root.hasAttribute("data-chord-page")) {
    return {
      ok: false,
      error: {
        code: "NOT_CHORD_PAGE",
        message: "A página atual não é uma cifra reconhecida.",
      },
    };
  }

  const container = doc.querySelector("article[data-chord-container]");
  const pre = container ? container.querySelector("pre[data-chord-content]") : null;
  const titleEl = doc.querySelector("div[data-chord-select] > h1");
  const artistEl = doc.querySelector("div[data-chord-select] h2");

  if (!container || !pre || !titleEl || !artistEl) {
    return {
      ok: false,
      error: {
        code: "DOM_STRUCTURE_CHANGED",
        message: "A estrutura da página da cifra mudou ou está incompleta.",
      },
    };
  }

  const title = inline(titleEl.textContent);
  const artist = inline(artistEl.textContent);
  if (!title || !artist) {
    return {
      ok: false,
      error: {
        code: "DOM_STRUCTURE_CHANGED",
        message: "Os metadados essenciais da cifra (título e artista) estão ausentes.",
      },
    };
  }

  const rows = Array.from(pre.children).filter((child) => child.tagName === "DIV");
  if (rows.length === 0) {
    return {
      ok: false,
      error: {
        code: "DOM_STRUCTURE_CHANGED",
        message: "As linhas estruturais da cifra não foram encontradas.",
      },
    };
  }

  const primaryBoldNodes = rows.flatMap((row) =>
    Array.from(row.childNodes).filter(
      (node) => node.nodeType === 1 && /** @type {Element} */ (node).tagName === "B",
    ),
  );
  const hasAnyIndex = primaryBoldNodes.some((node) =>
    /** @type {Element} */ (node).hasAttribute("data-chord-index"),
  );

  for (let i = 0; i < primaryBoldNodes.length; i += 1) {
    const node = /** @type {Element} */ (primaryBoldNodes[i]);
    const attrChord = inline(node.getAttribute("data-chord-name"));
    const textChord = inline(node.textContent);

    if (!attrChord || !textChord || attrChord !== textChord) {
      return {
        ok: false,
        error: {
          code: "DOM_STRUCTURE_CHANGED",
          message: "Um marcador de acorde na página está incompleto ou inconsistente.",
        },
      };
    }

    if (hasAnyIndex) {
      const rawIndex = node.getAttribute("data-chord-index");
      if (rawIndex === null || !/^\d+$/.test(rawIndex) || Number(rawIndex) !== i) {
        return {
          ok: false,
          error: {
            code: "DOM_STRUCTURE_CHANGED",
            message: "A sequência de índices dos acordes foi alterada ou truncada.",
          },
        };
      }
    }
  }

  const configEl = doc.querySelector("[data-chord-config]");
  const configText = inline(configEl?.textContent || "");
  const keyMatch = configText.match(/\bTom\s*:\s*([A-G](?:#|b)?m?)\b/i);
  const key = keyMatch ? keyMatch[1] : "";

  /** @type {ClipperBlock[]} */
  const blocks = [];
  /** @type {ClipperBlock | null} */
  let currentBlock = null;
  let totalChords = 0;

  /**
   * @param {string | null} label
   * @param {"section" | "tab" | "anonymous"} kind
   * @returns {ClipperBlock}
   */
  const openBlock = (label, kind) => {
    const block = { label, kind, lines: [] };
    blocks.push(block);
    currentBlock = block;
    return block;
  };

  /**
   * @param {string[]} pendingChords
   */
  const flushChords = (pendingChords) => {
    if (pendingChords.length === 0) return;
    const target = currentBlock || openBlock(null, "anonymous");
    target.lines.push({
      type: "chords",
      chords: pendingChords.splice(0, pendingChords.length),
    });
  };

  /**
   * @param {string} label
   * @param {string[]} pendingChords
   */
  const handleSectionLabel = (label, pendingChords) => {
    flushChords(pendingChords);
    const kind = /tab/i.test(label) ? "tab" : "section";
    openBlock(label, kind);
  };

  for (const row of rows) {
    const rowBolds = row.querySelectorAll("b[data-chord-name]");
    if (rowBolds.length === 0) {
      const rawLines = String(row.textContent || "").split(/\r?\n/);
      for (const rawLine of rawLines) {
        const trimmed = rawLine.trim();
        if (!trimmed) continue;

        const labels = extractSectionLabels(trimmed);
        if (labels.length > 0) {
          for (const label of labels) {
            handleSectionLabel(label, []);
          }
          continue;
        }

        if (TAB_LINE_PATTERN.test(trimmed)) {
          const target = currentBlock || openBlock("Tablatura", "tab");
          target.lines.push({
            type: "tab",
            raw: trimmed,
          });
        }
      }
      continue;
    }

    /** @type {string[]} */
    const pendingChords = [];
    for (const child of Array.from(row.childNodes)) {
      if (child.nodeType === 1 && /** @type {Element} */ (child).tagName === "B") {
        const element = /** @type {Element} */ (child);
        const chordName = inline(element.getAttribute("data-chord-name"));
        pendingChords.push(chordName);
        totalChords += 1;

        const trailingAttr = element.getAttribute("data-chord-original-trailing") || "";
        const trailingLabels = extractSectionLabels(trailingAttr);
        if (trailingLabels.length > 0) {
          const siblingLabels = extractSectionLabels(textUntilNextChord(element));
          for (const label of trailingLabels) {
            if (!siblingLabels.includes(label)) {
              handleSectionLabel(label, pendingChords);
            }
          }
        }
      } else {
        const labels = extractSectionLabels(child.textContent || "");
        for (const label of labels) {
          handleSectionLabel(label, pendingChords);
        }
      }
    }

    flushChords(pendingChords);
  }

  const nonEmptyBlocks = blocks.filter((block) => block.lines.length > 0);
  if (totalChords === 0 || nonEmptyBlocks.length === 0) {
    return {
      ok: false,
      error: {
        code: "NO_CHORDS",
        message: "Nenhum acorde reconhecível foi encontrado na página.",
      },
    };
  }

  return {
    ok: true,
    snapshot: {
      metadata: key ? { title, artist, key } : { title, artist },
      blocks: nonEmptyBlocks,
    },
  };
}
