import { test, expect } from "@playwright/test";
import { setupPage, gotoRoute } from "./helpers.js";

test.describe("Caderno de Cifras - Smoke E2E", () => {
  test("biblioteca: carrega acervo, filtra por busca e navega entre secoes", async ({ page }) => {
    const errors = await setupPage(page);

    await gotoRoute(page, "#/musicas");

    // Confere que os cards das musicas estao visiveis no painel principal
    await expect(page.locator("#main .card", { hasText: "Garota de Ipanema" })).toBeVisible();
    await expect(page.locator("#main .card", { hasText: "Wave" })).toBeVisible();

    // Filtra pela busca
    const searchInput = page.locator("#search");
    await searchInput.fill("Garota");
    await expect(page.locator("#main .card", { hasText: "Garota de Ipanema" })).toBeVisible();
    await expect(page.locator("#main .card", { hasText: "Wave" })).not.toBeVisible();

    // Limpa a busca
    await searchInput.fill("");
    await expect(page.locator("#main .card", { hasText: "Wave" })).toBeVisible();

    // Navega para Playlists
    await page.click('[data-nav="playlists"]');
    await expect(page).toHaveURL(/#\/playlists/);
    await expect(page.locator("#main .card", { hasText: "Bossa Essencial" })).toBeVisible();

    // Navega para Setlists
    await page.click('[data-nav="setlists"]');
    await expect(page).toHaveURL(/#\/setlists/);
    await expect(page.locator("#main .card", { hasText: "Show Acustico" })).toBeVisible();

    // Retorna para Musicas
    await page.click('[data-nav="musicas"]');
    await expect(page).toHaveURL(/#\/musicas/);
    await expect(page.locator("#main .card", { hasText: "Garota de Ipanema" })).toBeVisible();

    expect(errors, "Nenhum erro no console").toEqual([]);
  });

  test("editor: abre cifra existente, exibe compassos e permite transposicao visual", async ({ page }) => {
    const errors = await setupPage(page);

    await gotoRoute(page, "#/musicas/song-cifra-test");

    // Verifica campo de titulo e acordes nos compassos
    await expect(page.locator("input.sheet-title")).toHaveValue("Garota de Ipanema");
    await expect(page.locator("#paper-body").getByText("F7M")).toBeVisible();
    await expect(page.locator("#paper-body").getByText("G7")).toBeVisible();

    // Altera "Ver em" para transpor visualmente para G
    const previewSelect = page.locator("select[data-preview-key]");
    await previewSelect.selectOption("G");

    // F7M transposto um tom acima vira G7M
    await expect(page.locator("#paper-body").getByText("G7M")).toBeVisible();

    expect(errors, "Nenhum erro no console").toEqual([]);
  });

  test("palco: navega entre musicas da setlist e retorna a biblioteca", async ({ page }) => {
    const errors = await setupPage(page);

    await gotoRoute(page, "#/setlists/setlist-1/palco");

    // Verifica que a primeira musica esta selecionada no palco
    const stagePicker = page.locator("#stage-picker");
    await expect(stagePicker).toBeVisible();
    await expect(stagePicker).toHaveValue("0");
    await expect(page.locator("h1.sheet-title")).toHaveText("Garota de Ipanema");

    // Avanca para a proxima musica da setlist (Wave possui partitura PDF anexada)
    await page.click('[data-action="stage-next"]');
    await expect(stagePicker).toHaveValue("1");
    await expect(page.locator(".pdf-caption")).toContainText("Wave");

    // Volta para a musica anterior
    await page.click('[data-action="stage-prev"]');
    await expect(stagePicker).toHaveValue("0");
    await expect(page.locator("h1.sheet-title")).toHaveText("Garota de Ipanema");

    // Sai do palco
    await page.click('[data-action="exit-stage"]');
    await expect(page).toHaveURL(/#\/setlists\/setlist-1/);

    expect(errors, "Nenhum erro no console").toEqual([]);
  });

  test("pdf: renderiza musica com partitura anexada", async ({ page }) => {
    const errors = await setupPage(page);

    await gotoRoute(page, "#/musicas/song-pdf-test");

    await expect(page.locator("input.sheet-title")).toHaveValue("Wave");
    await expect(page.locator(".pdf-chip")).toBeVisible();

    // Clica em "Ler PDF" para entrar no modo de leitura de PDF
    await page.click('[data-action="read-pdf"]');

    // Canvas do PDF deve estar presente e com dimensoes validas
    const canvas = page.locator("canvas.pdf-canvas");
    await expect(canvas).toBeVisible({ timeout: 10000 });
    await expect(page.locator(".pdf-caption")).toContainText("Wave");

    expect(errors, "Nenhum erro no console").toEqual([]);
  });

  test("migracao v1 para v2: carrega biblioteca legada, aceita compasso vazio e persiste modelo v2", async ({ page }) => {
    const v1LegacyLibrary = {
      version: 1,
      songs: [
        {
          id: "song-v1-pdf",
          title: "Samba de Uma Nota So",
          composer: "Tom Jobim",
          key: "D",
          tempo: 140,
          timeSignature: "",
          pdfName: "samba.pdf",
          pdfPages: 2,
          sections: [
            {
              id: "sec-1",
              label: "A",
              measures: [{ id: "m-1", chords: "Dm7", ending: "", repeat: "" }],
            },
          ],
        },
      ],
      playlists: [
        {
          id: "pl-1",
          name: "Bossa Legada",
          note: "Importada da v1",
          songIds: ["song-v1-pdf"],
        },
      ],
      setlists: [],
    };

    const errors = await setupPage(page, { library: v1LegacyLibrary, seedPdf: false });
    await gotoRoute(page, "#/musicas");

    // Confere que a musica migrada aparece na biblioteca
    await expect(page.locator("#main .card", { hasText: "Samba de Uma Nota So" })).toBeVisible();

    // Abre a musica no editor e confere compasso vazio
    await gotoRoute(page, "#/musicas/song-v1-pdf");
    const timeSigSelect = page.locator('select[data-field="timeSignature"]');
    await expect(timeSigSelect).toHaveValue("");

    // Confere que a armadura de compasso nao estampa falso 4/4 na grade
    await expect(page.locator(".time-sig")).not.toBeVisible();

    // Recarrega a pagina e confere idempotencia e integridade
    await page.reload();
    await expect(page.locator("input.sheet-title")).toHaveValue("Samba de Uma Nota So");
    await expect(timeSigSelect).toHaveValue("");

    // Confere que a biblioteca possui version: 2 e pdfDocuments
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem("caderno.library.v1") || "{}"));
    expect(stored.version).toBe(2);
    expect(stored.pdfDocuments).toHaveLength(1);
    expect(stored.pdfDocuments[0].id).toBe("song-v1-pdf");
    expect(stored.pdfDocuments[0].name).toBe("samba.pdf");
    expect(stored.songs[0].pdfRef.documentId).toBe("song-v1-pdf");

    expect(errors, "Nenhum erro no console").toEqual([]);
  });
});
