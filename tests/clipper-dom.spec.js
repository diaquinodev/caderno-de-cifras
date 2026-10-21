import { test, expect } from "@playwright/test";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { extractDomSnapshot } from "../extension/dom-adapter.js";
import { extractCanonicalCifra } from "../extension/extractor.js";
import { registerActionListener } from "../extension/background.js";
import { parseCifraSource, verifyCifraSourceInvariants } from "../caderno/js/source.js";

const fixtureUrl = new URL("./fixtures/cifraclub-oba-la-vem-ela.sanitized.html", import.meta.url);
const evidenceUrl = new URL("./fixtures/cifraclub-oba-la-vem-ela.evidence.json", import.meta.url);

function evidenceFor(document, field) {
  return document.evidence.find((item) => item.field === field);
}

test.describe("Caderno Clipper - DOM, Extensão e Entrega ao Caderno", () => {
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

  test("fases 4 e 5: clique na extensão copia cifra canônica, abre o Caderno e gera rascunho preservando os 74 acordes", async ({
    page,
    context,
  }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    const html = await readFile(fixtureUrl, "utf8");
    await page.goto("http://127.0.0.1:4173/#/musicas");
    await page.setContent(html);

    let clickedHandler = null;
    let scriptExecutions = 0;
    const openedUrls = [];
    /** @type {import("@playwright/test").Page | null} */
    let cadernoPage = null;

    const chromeBridge = {
      action: {
        onClicked: {
          addListener(fn) {
            clickedHandler = fn;
          },
        },
        async setBadgeText() {},
        async setBadgeBackgroundColor() {},
        async setTitle() {},
      },
      scripting: {
        async executeScript({ target, func, args }) {
          scriptExecutions += 1;
          expect(target.tabId).toBe(101);
          const result = Array.isArray(args)
            ? await page.evaluate(func, ...args)
            : await page.evaluate(func);
          return [{ result }];
        },
      },
      tabs: {
        async create({ url }) {
          openedUrls.push(url);
          cadernoPage = await context.newPage();
          await cadernoPage.goto(url);
          return { id: 102, url };
        },
      },
    };

    registerActionListener(chromeBridge, { destination: "http://127.0.0.1:4173/#/musicas" });
    expect(scriptExecutions).toBe(0);

    const clipperResult = await clickedHandler({ id: 101 });
    expect(scriptExecutions).toBe(2);
    expect(clipperResult.ok).toBe(true);
    if (!clipperResult.ok || !cadernoPage) return;

    expect(clipperResult.chordCount).toBe(74);
    expect(clipperResult.receipt.destination).toBe("http://127.0.0.1:4173/#/musicas");
    expect(clipperResult.receipt.confirmationMessage).toContain("Oba Lá Vem Ela (74 acordes)");
    expect(openedUrls).toEqual(["http://127.0.0.1:4173/#/musicas"]);

    const clipboardText = await page.evaluate(() => navigator.clipboard.readText());
    expect(clipboardText.replace(/\r\n/g, "\n")).toBe(clipperResult.text);

    // Na aba aberta do Caderno, cola o texto do clipboard, inspeciona a fonte e gera o rascunho
    await cadernoPage.click('[data-action="new-song"]');
    await cadernoPage.click('[data-action="open-paste"]');
    await cadernoPage.fill("#paste-text", clipboardText);
    await cadernoPage.click('[data-action="inspect-source"]');

    const preview = cadernoPage.locator("#source-preview");
    await expect(preview).toBeVisible();
    await expect(preview).toContainText("Oba Lá Vem Ela");
    await expect(preview).toContainText("Jorge Ben Jor");
    await expect(preview).toContainText("Tom: Bm");
    await expect(preview).toContainText("Total: 8 bloco(s), 74 acorde(s) literais.");

    await cadernoPage.click('[data-action="open-draft"]');
    await expect(cadernoPage.locator("#draft-title")).toBeVisible();
    await expect(cadernoPage.locator(".modal")).toContainText("Oba Lá Vem Ela");
    await expect(cadernoPage.locator(".modal")).toContainText("Tom: Bm");
    await cadernoPage.close();
  });
});
