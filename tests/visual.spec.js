import fs from "node:fs";
import path from "node:path";
import { test, expect } from "@playwright/test";
import { VIEWPORT_CASES } from "./fixtures/library.js";
import { setupPage, gotoRoute } from "./helpers.js";
import { TWELVE_PAGE_PDF_BASE64 } from "./fixtures/pdf.js";
import { longRepeatedChart } from "../caderno/js/fixtures/cifras.js";

const READING_PROOF_VIEWPORTS = [
  ...VIEWPORT_CASES,
  { name: "desktop-wide", width: 1440, height: 900, hasTouch: false, isMobile: false },
];

const screenshotDir = path.resolve("tests", "screenshots");
if (!fs.existsSync(screenshotDir)) {
  fs.mkdirSync(screenshotDir, { recursive: true });
}

test.describe("Caderno de Cifras - Provas Visuais Responsivas", () => {
  for (const vp of VIEWPORT_CASES) {
    test.describe(`Viewport: ${vp.name} (${vp.width}x${vp.height})`, () => {
      test.use({
        viewport: { width: vp.width, height: vp.height },
        hasTouch: vp.hasTouch,
        isMobile: vp.isMobile,
      });

      test("captura biblioteca", async ({ page }) => {
        const errors = await setupPage(page);
        await gotoRoute(page, "#/musicas");

        await expect(page.locator("#main .card", { hasText: "Garota de Ipanema" })).toBeVisible();
        await page.screenshot({
          path: path.join(screenshotDir, `${vp.name}-biblioteca.png`),
          fullPage: false,
        });

        expect(errors, "Nenhum erro de console").toEqual([]);
      });

      test("captura editor", async ({ page }) => {
        const errors = await setupPage(page);
        await gotoRoute(page, "#/musicas/song-cifra-test");

        await expect(page.locator("input.sheet-title")).toHaveValue("Garota de Ipanema");
        await page.screenshot({
          path: path.join(screenshotDir, `${vp.name}-editor.png`),
          fullPage: false,
        });

        expect(errors, "Nenhum erro de console").toEqual([]);
      });

      test("captura palco", async ({ page }) => {
        const errors = await setupPage(page);
        await gotoRoute(page, "#/setlists/setlist-1/palco");

        await expect(page.locator("#stage-picker")).toBeVisible();
        await page.screenshot({
          path: path.join(screenshotDir, `${vp.name}-palco.png`),
          fullPage: false,
        });

        expect(errors, "Nenhum erro de console").toEqual([]);
      });

      test("captura cifra com pdf", async ({ page }) => {
        const errors = await setupPage(page);
        await gotoRoute(page, "#/musicas/song-pdf-test");

        await expect(page.locator("input.sheet-title")).toHaveValue("Wave");
        await page.click('[data-action="read-pdf"]');
        await expect(page.locator("canvas.pdf-canvas")).toBeVisible({ timeout: 10000 });
        await page.screenshot({
          path: path.join(screenshotDir, `${vp.name}-pdf.png`),
          fullPage: false,
        });

        expect(errors, "Nenhum erro de console").toEqual([]);
      });

      test("captura assistente de divisao de pdf", async ({ page }) => {
        const errors = await setupPage(page);
        await gotoRoute(page, "#/musicas/song-cifra-test");

        const pdfBuffer = Buffer.from(TWELVE_PAGE_PDF_BASE64, "base64");
        await page.setInputFiles("#pdf-input", {
          name: "album-assistente.pdf",
          mimeType: "application/pdf",
          buffer: pdfBuffer,
        });

        const wizard = page.locator("#pdf-wizard-modal");
        await expect(wizard).toBeVisible();
        await page.click('[data-action="wizard-set-mode"][data-mode="split"]');
        await page.click('[data-action="wizard-add-range"]');

        await page.screenshot({
          path: path.join(screenshotDir, `${vp.name}-wizard.png`),
          fullPage: false,
        });

        await page.click('[data-action="wizard-cancel"]');
        expect(errors, "Nenhum erro de console").toEqual([]);
      });
    });
  }

  for (const vp of READING_PROOF_VIEWPORTS) {
    test.describe(`Fase 21 Prova Integrada - ${vp.name} (${vp.width}x${vp.height})`, () => {
      test.use({
        viewport: { width: vp.width, height: vp.height },
        hasTouch: vp.hasTouch,
        isMobile: vp.isMobile,
      });

      test("jornada completa rascunho -> compactacao -> leitura paginada -> tela cheia sem overflow ou cortes", async ({ page }) => {
        const errors = await setupPage(page, { seedPdf: false });
        await gotoRoute(page, "#/musicas");

        await page.click('[data-action="new-song"]');
        await page.click('[data-action="open-paste"]');
        await page.fill("#paste-text", longRepeatedChart);
        await page.click('[data-action="open-draft"]');
        await expect(page.locator("#draft-title")).toBeVisible();

        // Captura rascunho com sugestões de repetição
        await page.screenshot({
          path: path.join(screenshotDir, `fase21-${vp.name}-1-rascunho-sugestoes.png`),
          fullPage: false,
        });

        await page.click('[data-action="draft-set-timesig"][data-timesig="4/4"]');

        // Aceita todas as sugestões de repetição disponíveis
        const applyButtons = page.locator('[data-action="draft-apply-repeat"]');
        const count = await applyButtons.count();
        expect(count).toBeGreaterThanOrEqual(3);
        for (let i = 0; i < count; i += 1) {
          await page.locator('[data-action="draft-apply-repeat"]').first().click();
        }

        await page.screenshot({
          path: path.join(screenshotDir, `fase21-${vp.name}-2-rascunho-compactado.png`),
          fullPage: false,
        });

        await page.click("#btn-draft-confirm");
        await expect(page.locator("input.sheet-title")).toHaveValue("Suíte da Leitura Paginada");

        // Entra em leitura paginada (modo limpo)
        await page.click('[data-action="toggle-clean"]');
        const spread = page.locator("#chart-reading-spread");
        const indicator = page.locator("#chart-page-indicator");
        await expect(spread).toBeVisible();
        await expect(indicator).toBeVisible();

        const expectedSpan = vp.width >= 1024 && vp.width > vp.height ? "2" : "1";
        await expect(spread).toHaveAttribute("data-page-span", expectedSpan);

        await page.screenshot({
          path: path.join(screenshotDir, `fase21-${vp.name}-3-leitura-paginada-p1.png`),
          fullPage: false,
        });

        // Verifica ausência de overflow horizontal e visibilidade integral das linhas em cada página/dupla
        const totalPages = Number(await spread.getAttribute("data-total-pages"));
        expect(totalPages).toBeGreaterThanOrEqual(2);

        const maxSteps = Math.ceil(totalPages / Number(expectedSpan));
        for (let step = 1; step <= maxSteps; step += 1) {
          const metrics = await page.evaluate(() => {
            const lines = [...document.querySelectorAll("#chart-reading-spread .staff-line")];
            const allLinesVisible = lines.every((l) => {
              const r = l.getBoundingClientRect();
              return r.top >= 0 && r.bottom <= window.innerHeight && r.height >= 20;
            });
            return {
              overflowX: document.documentElement.scrollWidth - window.innerWidth,
              lineCount: lines.length,
              allLinesVisible,
            };
          });
          expect(metrics.overflowX).toBeLessThanOrEqual(0);
          expect(metrics.lineCount).toBeGreaterThan(0);
          expect(metrics.allLinesVisible).toBe(true);

          if (step < maxSteps) {
            await page.keyboard.press("ArrowRight");
          }
        }

        await page.screenshot({
          path: path.join(screenshotDir, `fase21-${vp.name}-4-leitura-paginada-final.png`),
          fullPage: false,
        });

        // Ativa tela cheia e registra captura
        await page.click('[data-action="toggle-fullscreen"]');
        await expect(page.locator("body")).toHaveClass(/fullscreen-reading/);
        await page.screenshot({
          path: path.join(screenshotDir, `fase21-${vp.name}-5-tela-cheia.png`),
          fullPage: false,
        });

        await page.keyboard.press("Escape");
        await expect(page.locator("body")).not.toHaveClass(/fullscreen-reading/);
        expect(errors, "Nenhum erro de console").toEqual([]);
      });
    });
  }
});
