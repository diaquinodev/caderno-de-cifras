import { test, expect } from "@playwright/test";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { extractDomSnapshot } from "../extension/dom-adapter.js";
import { extractCanonicalCifra } from "../extension/extractor.js";
import { registerActionListener, runClipperForTab } from "../extension/background.js";
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

  test("fase 6: aba errada, fixture quebrada e clipboard negado nunca sobrescrevem o clipboard existente e são idempotentes", async ({
    page,
    context,
  }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    const html = await readFile(fixtureUrl, "utf8");
    await page.goto("http://127.0.0.1:4173/#/musicas");
    await page.evaluate(() => navigator.clipboard.writeText("CONTEUDO_ANTERIOR_PROTEGIDO"));

    const badges = [];
    let allowClipboardCopy = false;

    const chromeBridge = {
      action: {
        async setBadgeText(p) {
          badges.push(p.text);
        },
        async setBadgeBackgroundColor() {},
        async setTitle() {},
      },
      scripting: {
        async executeScript({ func, args }) {
          if (Array.isArray(args)) {
            if (!allowClipboardCopy) {
              return [{ result: { ok: false } }];
            }
            const res = await page.evaluate(func, ...args);
            return [{ result: res }];
          }
          const res = await page.evaluate(func);
          return [{ result: res }];
        },
      },
      tabs: {
        async create() {
          return { id: 202 };
        },
      },
    };

    // 1. Aba que não é cifra
    await page.setContent("<!doctype html><html><body><h1>Home</h1></body></html>");
    const r1 = await runClipperForTab({ id: 77 }, chromeBridge);
    const r2 = await runClipperForTab({ id: 77 }, chromeBridge);
    expect(r1).toEqual(r2);
    expect(r1.ok).toBe(false);
    if (!r1.ok) {
      expect(r1.error.code).toBe("NOT_CHORD_PAGE");
      expect(r1.error.retryable).toBe(false);
    }
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("CONTEUDO_ANTERIOR_PROTEGIDO");

    // 2. Fixture quebrada (DOM_STRUCTURE_CHANGED)
    await page.setContent(html);
    await page.evaluate(() => {
      document.querySelector("pre[data-chord-content]")?.remove();
    });
    const broken = await runClipperForTab({ id: 77 }, chromeBridge);
    expect(broken.ok).toBe(false);
    if (!broken.ok) {
      expect(broken.error.code).toBe("DOM_STRUCTURE_CHANGED");
      expect(broken.error.retryable).toBe(true);
    }
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("CONTEUDO_ANTERIOR_PROTEGIDO");

    // 3. Permissão de clipboard negada
    await page.setContent(html);
    const denied = await runClipperForTab({ id: 77 }, chromeBridge);
    expect(denied.ok).toBe(false);
    if (!denied.ok) {
      expect(denied.error.code).toBe("CLIPBOARD_DENIED");
      expect(denied.error.retryable).toBe(true);
    }
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("CONTEUDO_ANTERIOR_PROTEGIDO");
    expect(badges).toEqual(["ERR", "ERR", "ERR", "ERR"]);
  });

  test("fase 8: jornada completa (extrair -> copiar -> colar -> compassos 2/4 e 4/4 -> criar cifra -> mudar tonalidade) sem requisições ao Cifra Club", async ({
    page,
    context,
  }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    const html = await readFile(fixtureUrl, "utf8");

    const externalOrLegacyRequests = [];
    context.on("request", (req) => {
      const url = req.url();
      if (url.includes("cifraclub.com.br") || url.includes("/api/cifra")) {
        externalOrLegacyRequests.push(url);
      }
    });

    await page.goto("http://127.0.0.1:4173/#/musicas");
    await page.setContent(html);

    /** @type {import("@playwright/test").Page | null} */
    let cadernoPage = null;

    const chromeBridge = {
      action: {
        async setBadgeText() {},
        async setBadgeBackgroundColor() {},
        async setTitle() {},
      },
      scripting: {
        async executeScript({ func, args }) {
          const res = Array.isArray(args)
            ? await page.evaluate(func, ...args)
            : await page.evaluate(func);
          return [{ result: res }];
        },
      },
      tabs: {
        async create({ url }) {
          cadernoPage = await context.newPage();
          await cadernoPage.goto(url);
          return { id: 303, url };
        },
      },
    };

    const clipperResult = await runClipperForTab(
      { id: 301 },
      chromeBridge,
      { destination: "http://127.0.0.1:4173/#/musicas" },
    );
    expect(clipperResult.ok).toBe(true);
    if (!clipperResult.ok || !cadernoPage) return;

    const clipboardText = await page.evaluate(() => navigator.clipboard.readText());
    await cadernoPage.click('[data-action="new-song"]');
    await cadernoPage.click('[data-action="open-paste"]');
    await cadernoPage.fill("#paste-text", clipboardText);
    await cadernoPage.click('[data-action="inspect-source"]');
    await cadernoPage.click('[data-action="open-draft"]');

    // Verifica os 43 compassos sugeridos a partir dos 74 acordes, divisão interativa e desfazer
    await expect(cadernoPage.locator(".modal")).toContainText("8 seção(ões), 43 compasso(s). ✓ Invariantes conferidos");
    const initialMeasures = await cadernoPage.locator(".draft-measure-box").count();
    expect(initialMeasures).toBe(43);

    await cadernoPage.locator('[data-action="draft-split-measure"]').first().click();
    expect(await cadernoPage.locator(".draft-measure-box").count()).toBe(44);
    await expect(cadernoPage.locator(".modal")).toContainText("8 seção(ões), 44 compasso(s). ✓ Invariantes conferidos");

    await cadernoPage.click("#btn-draft-undo");
    expect(await cadernoPage.locator(".draft-measure-box").count()).toBe(43);

    await cadernoPage.click('[data-action="draft-set-timesig"][data-timesig="4/4"]');
    await expect(cadernoPage.locator("#selected-timesig")).toHaveText("4/4");

    // Confirma o rascunho e cria a cifra na folha
    const confirmBtn = cadernoPage.locator('.modal [data-action="draft-confirm"]');
    await confirmBtn.scrollIntoViewIfNeeded();
    await confirmBtn.click();
    await expect(cadernoPage.locator("#draft-title")).not.toBeVisible();

    await expect(cadernoPage.locator('input[data-field="title"]')).toHaveValue("Oba Lá Vem Ela");
    await expect(cadernoPage.locator('input[data-field="composer"]')).toHaveValue("Jorge Ben Jor");
    await expect(cadernoPage.locator('select[data-field="key"]')).toHaveValue("Bm");
    await expect(cadernoPage.locator('select[data-field="timeSignature"]')).toHaveValue("4/4");
    await expect(cadernoPage.locator('textarea[data-field="notes"]')).toContainText("Artista: Jorge Ben Jor");

    const paperBody = cadernoPage.locator("#paper-body");
    await expect(paperBody).toBeVisible();
    await expect(cadernoPage.getByLabel("Compasso 1", { exact: true })).toHaveValue("B-7 E-7");
    await expect(cadernoPage.getByLabel("Compasso 4", { exact: true })).toHaveValue("B-7");
    await expect(cadernoPage.getByLabel("Compasso 18", { exact: true })).toHaveValue("A7");

    // Testa mudança de tonalidade: 1) pré-visualização ("Ver em" Dm = +3 semitons de Bm)
    await cadernoPage.selectOption("select[data-preview-key]", "Dm");
    await expect(cadernoPage.locator("#preview-banner")).toBeVisible();
    await expect(cadernoPage.locator("#preview-banner")).toContainText(
      "Visualização em Dm. A cifra salva continua em Bm.",
    );
    await expect(paperBody).toContainText("D-7");
    await expect(paperBody).toContainText("G-7");
    await expect(paperBody).toContainText("C7");
    await expect(cadernoPage.locator('select[data-field="key"]')).toHaveValue("Bm");

    // 2) Gravar definitivamente no novo tom ("Gravar neste tom")
    await cadernoPage.click('[data-action="commit-key"]');
    await expect(cadernoPage.locator('select[data-field="key"]')).toHaveValue("Dm");
    await expect(cadernoPage.locator("#preview-banner")).toBeHidden();
    await expect(cadernoPage.getByLabel("Compasso 1", { exact: true })).toHaveValue("D-7 G-7");
    await expect(cadernoPage.getByLabel("Compasso 4", { exact: true })).toHaveValue("D-7");
    await expect(cadernoPage.getByLabel("Compasso 18", { exact: true })).toHaveValue("C7");

    // Confirma ausência total de chamadas de rede ao Cifra Club ou à rota removida /api/cifra
    expect(externalOrLegacyRequests).toEqual([]);
    await cadernoPage.close();
  });
});

