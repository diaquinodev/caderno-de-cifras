import { test, expect } from "@playwright/test";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { extractDomSnapshot } from "../extension/dom-adapter.js";
import { extractCanonicalCifra } from "../extension/extractor.js";
import { parseCifraSource, verifyCifraSourceInvariants } from "../caderno/js/source.js";

const fixtureUrl = new URL("./fixtures/cifraclub-oba-la-vem-ela.sanitized.html", import.meta.url);
const evidenceUrl = new URL("./fixtures/cifraclub-oba-la-vem-ela.evidence.json", import.meta.url);

function evidenceFor(document, field) {
  return document.evidence.find((item) => item.field === field);
}

test.describe("Caderno Clipper - Fase 3: Adaptador do DOM", () => {
  test("carrega a fixture sanitizada no navegador e confirma metadados, blocos e acordes", async ({ page }) => {
    const [html, evidenceDoc] = await Promise.all([
      readFile(fixtureUrl, "utf8"),
      readFile(evidenceUrl, "utf8").then((raw) => JSON.parse(raw)),
    ]);

    await page.setContent(html);
    const domResult = await page.evaluate(extractDomSnapshot);

    expect(domResult.ok).toBe(true);
    if (!domResult.ok) return;

    expect(domResult.snapshot.metadata).toEqual({
      title: evidenceFor(evidenceDoc, "title").observed,
      artist: evidenceFor(evidenceDoc, "artist").observed,
      key: evidenceFor(evidenceDoc, "key").observed,
    });

    const observedSections = evidenceFor(evidenceDoc, "sections").observed;
    expect(domResult.snapshot.blocks.map((block) => [block.kind, block.label])).toEqual([
      ["anonymous", null],
      ...observedSections.map((label) => ["section", label]),
    ]);

    const rowCounts = domResult.snapshot.blocks.flatMap((block) =>
      block.lines.map((line) => (line.type === "chords" ? line.chords.length : 0)),
    );
    expect(rowCounts).toEqual(evidenceFor(evidenceDoc, "rows").observed.chordCounts);

    const extracted = extractCanonicalCifra(domResult.snapshot);
    expect(extracted.ok).toBe(true);
    if (!extracted.ok) return;

    const source = parseCifraSource(extracted.text, { sourceFormat: "plain" });
    const chordEvidence = evidenceFor(evidenceDoc, "chords").observed;

    expect(source.allChords.length).toBe(chordEvidence.count);
    const sequenceHash = createHash("sha256")
      .update(source.allChords.map((chord) => chord.raw).join(chordEvidence.sequenceSeparator))
      .digest("hex");
    expect(sequenceHash).toBe(chordEvidence.sequenceSha256);
    expect(verifyCifraSourceInvariants(source)).toEqual({ valid: true, errors: [] });
  });

  test("falhas de página não-cifra, seletor ausente e HTML parcialmente alterado não geram saída parcial", async ({ page }) => {
    const html = await readFile(fixtureUrl, "utf8");

    await page.setContent("<!doctype html><html><body><h1>Outra página</h1></body></html>");
    const notChordPage = await page.evaluate(extractDomSnapshot);
    expect(notChordPage).toEqual({
      ok: false,
      error: {
        code: "NOT_CHORD_PAGE",
        message: "A página atual não é uma cifra reconhecida.",
      },
    });

    await page.setContent(html);
    await page.evaluate(() => {
      const target = document.querySelector('b[data-chord-index="10"]');
      if (target) target.removeAttribute("data-chord-name");
    });
    const partialTamper = await page.evaluate(extractDomSnapshot);
    expect(partialTamper.ok).toBe(false);
    if (!partialTamper.ok) {
      expect(partialTamper.error.code).toBe("DOM_STRUCTURE_CHANGED");
    }
    expect("snapshot" in partialTamper).toBe(false);

    await page.evaluate(() => {
      const pre = document.querySelector("pre[data-chord-content]");
      if (pre) pre.remove();
    });
    const missingSelector = await page.evaluate(extractDomSnapshot);
    expect(missingSelector.ok).toBe(false);
    if (!missingSelector.ok) {
      expect(missingSelector.error.code).toBe("DOM_STRUCTURE_CHANGED");
    }
    expect("snapshot" in missingSelector).toBe(false);
  });
});
