import fs from "node:fs";
import path from "node:path";
import { test, expect } from "@playwright/test";
import { VIEWPORT_CASES } from "./fixtures/library.js";
import { setupPage, gotoRoute } from "./helpers.js";

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
    });
  }
});
