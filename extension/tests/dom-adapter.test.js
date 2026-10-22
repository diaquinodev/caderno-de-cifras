import test from "node:test";
import assert from "node:assert/strict";
import { extractDomSnapshot } from "../dom-adapter.js";
import { extractCanonicalCifra } from "../extractor.js";
import { parseCifraSource } from "../../caderno/js/source.js";

/**
 * Creates a minimal DOM node tree for unit testing `extractDomSnapshot` in Node without JSDOM.
 *
 * @param {object} [options]
 * @param {boolean} [options.hasChordPageAttr]
 * @param {boolean} [options.hasContainer]
 * @param {boolean} [options.hasPre]
 * @param {string} [options.title]
 * @param {string} [options.artist]
 * @param {string} [options.keyText]
 * @param {Array<{ nodes: Array<{ type: "b", name?: string, text?: string, index?: string | null, trailing?: string } | { type: "text", text: string }> }>} [options.rows]
 */
function buildMockDocument(options = {}) {
  const {
    hasChordPageAttr = true,
    hasContainer = true,
    hasPre = true,
    title = "Oba Lá Vem Ela",
    artist = "Jorge Ben Jor",
    keyText = "Tom: Bm",
    rows = [
      {
        nodes: [
          { type: "b", name: "Bm7", text: "Bm7", index: "0" },
          { type: "text", text: " " },
          { type: "b", name: "Em7", text: "Em7", index: "1", trailing: "\n\n[Refrão]\n\n" },
          { type: "text", text: "\n[Refrão]" },
        ],
      },
      {
        nodes: [
          { type: "b", name: "A7", text: "A7", index: "2" },
        ],
      },
    ],
  } = options;

  const allBolds = [];
  const rowElements = rows.map((rowSpec) => {
    /** @type {any[]} */
    const childNodes = [];
    /** @type {any[]} */
    const rowBolds = [];

    for (const item of rowSpec.nodes) {
      if (item.type === "b") {
        const attrs = new Map();
        if (item.name !== undefined) attrs.set("data-chord-name", item.name);
        if (item.index !== undefined && item.index !== null) attrs.set("data-chord-index", item.index);
        if (item.trailing !== undefined) attrs.set("data-chord-original-trailing", item.trailing);

        const bNode = {
          nodeType: 1,
          tagName: "B",
          textContent: item.text ?? item.name ?? "",
          nextSibling: null,
          hasAttribute(name) {
            return attrs.has(name);
          },
          getAttribute(name) {
            return attrs.has(name) ? attrs.get(name) : null;
          },
        };
        childNodes.push(bNode);
        allBolds.push(bNode);
        rowBolds.push(bNode);
      } else {
        childNodes.push({
          nodeType: 3,
          textContent: item.text,
          nextSibling: null,
        });
      }
    }

    for (let i = 0; i < childNodes.length - 1; i += 1) {
      childNodes[i].nextSibling = childNodes[i + 1];
    }

    return {
      nodeType: 1,
      tagName: "DIV",
      childNodes,
      textContent: childNodes.map((n) => n.textContent).join(""),
      querySelectorAll(selector) {
        if (selector === "b[data-chord-name]") {
          return rowBolds.filter((b) => b.hasAttribute("data-chord-name"));
        }
        return [];
      },
    };
  });

  const preElement = hasPre
    ? {
        tagName: "PRE",
        children: rowElements,
        querySelectorAll(selector) {
          if (selector === "b") return allBolds;
          return [];
        },
      }
    : null;

  const containerElement = hasContainer
    ? {
        tagName: "ARTICLE",
        querySelector(selector) {
          if (selector === "pre[data-chord-content]") return preElement;
          return null;
        },
      }
    : null;

  return /** @type {any} */ ({
    documentElement: {
      hasAttribute(name) {
        return name === "data-chord-page" && hasChordPageAttr;
      },
    },
    querySelector(selector) {
      if (selector === "article[data-chord-container]") return containerElement;
      if (selector === "div[data-chord-select] > h1") return title !== null ? { textContent: title } : null;
      if (selector === "div[data-chord-select] h2") return artist !== null ? { textContent: artist } : null;
      if (selector === "[data-chord-config]") return keyText ? { textContent: keyText } : null;
      return null;
    },
  });
}

test("extractDomSnapshot converte estrutura válida em ClipperSnapshot e integra com extractCanonicalCifra", () => {
  const doc = buildMockDocument();
  const result = extractDomSnapshot(doc);

  assert.equal(result.ok, true);
  if (!result.ok) return;

  assert.deepEqual(result.snapshot.metadata, {
    title: "Oba Lá Vem Ela",
    artist: "Jorge Ben Jor",
    key: "Bm",
  });
  assert.equal(result.snapshot.blocks.length, 2);
  assert.deepEqual(result.snapshot.blocks[0], {
    label: null,
    kind: "anonymous",
    lines: [{ type: "chords", chords: ["Bm7", "Em7"] }],
  });
  assert.deepEqual(result.snapshot.blocks[1], {
    label: "Refrão",
    kind: "section",
    lines: [{ type: "chords", chords: ["A7"] }],
  });

  const canonical = extractCanonicalCifra(result.snapshot);
  assert.equal(canonical.ok, true);
  if (!canonical.ok) return;

  const source = parseCifraSource(canonical.text, { sourceFormat: "plain" });
  assert.deepEqual(
    source.allChords.map((chord) => chord.raw),
    ["Bm7", "Em7", "A7"],
  );
});

test("extractDomSnapshot rejeita página que não possui data-chord-page", () => {
  const doc = buildMockDocument({ hasChordPageAttr: false });
  const result = extractDomSnapshot(doc);

  assert.deepEqual(result, {
    ok: false,
    error: {
      code: "NOT_CHORD_PAGE",
      message: "A página atual não é uma cifra reconhecida.",
    },
  });
});

test("extractDomSnapshot rejeita seletor estrutural ausente sem produzir saída parcial", () => {
  const noPre = buildMockDocument({ hasPre: false });
  assert.equal(extractDomSnapshot(noPre).ok, false);
  if (!extractDomSnapshot(noPre).ok) {
    assert.equal(/** @type {any} */ (extractDomSnapshot(noPre)).error.code, "DOM_STRUCTURE_CHANGED");
  }

  const emptyTitle = buildMockDocument({ title: "   " });
  const emptyTitleResult = extractDomSnapshot(emptyTitle);
  assert.equal(emptyTitleResult.ok, false);
  if (!emptyTitleResult.ok) {
    assert.equal(emptyTitleResult.error.code, "DOM_STRUCTURE_CHANGED");
  }
});

test("extractDomSnapshot rejeita HTML parcialmente alterado em atributo ou índice de acorde", () => {
  const mismatchedText = buildMockDocument({
    rows: [
      {
        nodes: [
          { type: "b", name: "Bm7", text: "Em7", index: "0" },
        ],
      },
    ],
  });
  const mismatchResult = extractDomSnapshot(mismatchedText);
  assert.equal(mismatchResult.ok, false);
  if (!mismatchResult.ok) {
    assert.equal(mismatchResult.error.code, "DOM_STRUCTURE_CHANGED");
  }

  const brokenIndex = buildMockDocument({
    rows: [
      {
        nodes: [
          { type: "b", name: "Bm7", text: "Bm7", index: "0" },
          { type: "b", name: "Em7", text: "Em7", index: "2" },
        ],
      },
    ],
  });
  const brokenIndexResult = extractDomSnapshot(brokenIndex);
  assert.equal(brokenIndexResult.ok, false);
  if (!brokenIndexResult.ok) {
    assert.equal(brokenIndexResult.error.code, "DOM_STRUCTURE_CHANGED");
  }
});

test("extractDomSnapshot preserva tablatura e seção quando marcador está apenas em data-chord-original-trailing", () => {
  const doc = buildMockDocument({
    rows: [
      {
        nodes: [
          { type: "b", name: "Dm7", text: "Dm7", index: "0", trailing: "\n[Tab - Intro]\n" },
        ],
      },
      {
        nodes: [
          { type: "text", text: "e|---5---5---|" },
        ],
      },
    ],
  });

  const result = extractDomSnapshot(doc);
  assert.equal(result.ok, true);
  if (!result.ok) return;

  assert.equal(result.snapshot.blocks.length, 2);
  assert.equal(result.snapshot.blocks[1].kind, "tab");
  assert.equal(result.snapshot.blocks[1].label, "Tab - Intro");
  assert.deepEqual(result.snapshot.blocks[1].lines, [{ type: "tab", raw: "e|---5---5---|" }]);
});

test("extractDomSnapshot retorna NO_CHORDS quando linhas não possuem acordes", () => {
  const doc = buildMockDocument({
    rows: [
      {
        nodes: [{ type: "text", text: "[Intro]" }],
      },
    ],
  });

  const result = extractDomSnapshot(doc);
  assert.deepEqual(result, {
    ok: false,
    error: {
      code: "NO_CHORDS",
      message: "Nenhum acorde reconhecível foi encontrado na página.",
    },
  });
});
