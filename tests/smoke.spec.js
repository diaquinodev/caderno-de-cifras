import { test, expect } from "@playwright/test";
import { setupPage, gotoRoute, getStoredPdfCount } from "./helpers.js";
import { TWELVE_PAGE_PDF_BASE64 } from "./fixtures/pdf.js";

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

  test("fase 3: catalogo centralizado de pdfs, contagem de 12 paginas e renderizacao fisica em fundo branco", async ({ page }) => {
    const twelvePageDoc = {
      id: "doc-new-chic-12",
      name: "NEW CHIC NOVAS 2026.pdf",
      pageCount: 12,
      createdAt: "2026-10-20T00:00:00.000Z",
    };

    const multiSongLibrary = {
      version: 2,
      pdfDocuments: [twelvePageDoc],
      songs: [
        {
          id: "song-chic-1",
          title: "Chic Tema 1 (Páginas 1-6)",
          composer: "Chic",
          key: "F",
          tempo: 120,
          timeSignature: "4/4",
          pdfName: "NEW CHIC NOVAS 2026.pdf",
          pdfPages: 6,
          pdfRef: { documentId: "doc-new-chic-12", firstPage: 1, lastPage: 6 },
          sections: [{ id: "sec-1", label: "A", measures: [{ id: "m-1", chords: "F" }] }],
        },
        {
          id: "song-chic-2",
          title: "Chic Tema 2 (Páginas 7-8)",
          composer: "Chic",
          key: "Gm",
          tempo: 110,
          timeSignature: "4/4",
          pdfName: "NEW CHIC NOVAS 2026.pdf",
          pdfPages: 2,
          pdfRef: { documentId: "doc-new-chic-12", firstPage: 7, lastPage: 8 },
          sections: [{ id: "sec-2", label: "A", measures: [{ id: "m-2", chords: "Gm" }] }],
        },
        {
          id: "song-chic-5",
          title: "Chic Tema 5 (Página 12)",
          composer: "Chic",
          key: "Bb",
          tempo: 125,
          timeSignature: "4/4",
          pdfName: "NEW CHIC NOVAS 2026.pdf",
          pdfPages: 1,
          pdfRef: { documentId: "doc-new-chic-12", firstPage: 12, lastPage: 12 },
          sections: [{ id: "sec-5", label: "A", measures: [{ id: "m-5", chords: "Bb" }] }],
        },
      ],
      playlists: [],
      setlists: [],
    };

    const errors = await setupPage(page, {
      library: multiSongLibrary,
      seedPdf: false,
      customPdfs: [
        {
          id: "doc-new-chic-12",
          name: "NEW CHIC NOVAS 2026.pdf",
          pageCount: 12,
          base64: TWELVE_PAGE_PDF_BASE64,
        },
      ],
    });

    // 1. Abre a musica 1 (páginas 1 a 6) no modo de leitura
    await gotoRoute(page, "#/musicas/song-chic-1");
    await page.click('[data-action="read-pdf"]');

    const canvas = page.locator("canvas.pdf-canvas");
    await expect(canvas).toBeVisible({ timeout: 10000 });
    await expect(canvas).toHaveAttribute("data-rendered", "true", { timeout: 10000 });

    // Verifica atributos de pagina fisica e relativa
    await expect(canvas).toHaveAttribute("data-page", "1");
    await expect(canvas).toHaveAttribute("data-physical-page", "1");
    await expect(page.locator(".pdf-caption")).toContainText("página 1 de 6");

    // Verifica que o fundo do canvas foi preenchido com branco (#ffffff)
    const pixelColor = await page.evaluate(() => {
      const el = document.querySelector("canvas.pdf-canvas");
      const ctx = el?.getContext("2d");
      if (!ctx || !el) return null;
      const data = ctx.getImageData(10, 10, 1, 1).data;
      return [data[0], data[1], data[2]];
    });
    expect(pixelColor).toEqual([255, 255, 255]);

    // Avança até a página 6 física (relativa 6 de 6)
    for (let p = 1; p < 6; p += 1) {
      await page.click('button[data-action="stage-step"][data-dir="1"]');
      await expect(canvas).toHaveAttribute("data-page", String(p + 1));
    }
    await expect(canvas).toHaveAttribute("data-physical-page", "6");
    await expect(page.locator(".pdf-caption")).toContainText("página 6 de 6");

    // 2. Abre a musica 2 (páginas 7 a 8 físicas)
    await gotoRoute(page, "#/musicas/song-chic-2");
    await page.click('[data-action="read-pdf"]');
    await expect(canvas).toBeVisible();
    await expect(canvas).toHaveAttribute("data-rendered", "true");
    await expect(canvas).toHaveAttribute("data-page", "1");
    await expect(canvas).toHaveAttribute("data-physical-page", "7");
    await expect(page.locator(".pdf-caption")).toContainText("página 1 de 2");

    // 3. Abre a musica 5 (página 12 física)
    await gotoRoute(page, "#/musicas/song-chic-5");
    await page.click('[data-action="read-pdf"]');
    await expect(canvas).toBeVisible();
    await expect(canvas).toHaveAttribute("data-rendered", "true");
    await expect(canvas).toHaveAttribute("data-page", "1");
    await expect(canvas).toHaveAttribute("data-physical-page", "12");
    await expect(page.locator(".pdf-caption")).toContainText("página 1 de 1");

    expect(errors, "Nenhum erro no console durante a navegacao entre paginas").toEqual([]);
  });

  test("fase 3: duplicacao compartilha bytes no IndexedDB e exclusao remove apenas quando orfao", async ({ page }) => {
    const docId = "doc-shared-test";
    const library = {
      version: 2,
      pdfDocuments: [{ id: docId, name: "partitura.pdf", pageCount: 2 }],
      songs: [
        {
          id: "song-orig",
          title: "Original",
          composer: "Autor",
          key: "C",
          tempo: 120,
          timeSignature: "4/4",
          pdfName: "partitura.pdf",
          pdfPages: 2,
          pdfRef: { documentId: docId, firstPage: 1, lastPage: 2 },
          sections: [{ id: "sec-1", label: "A", measures: [{ id: "m-1", chords: "C" }] }],
        },
      ],
      playlists: [],
      setlists: [],
    };

    const errors = await setupPage(page, {
      library,
      seedPdf: false,
      customPdfs: [{ id: docId, name: "partitura.pdf", pageCount: 2, base64: TWELVE_PAGE_PDF_BASE64 }],
    });

    await gotoRoute(page, "#/musicas/song-orig");

    // 1. Registros iniciais no IndexedDB deve ser exatamente 1
    const initialCount = await getStoredPdfCount(page);
    expect(initialCount).toBe(1);

    // 2. Duplica a musica pelo editor
    await page.click('[data-action="duplicate-song"]');
    await expect(page.locator("input.sheet-title")).toHaveValue("Original (cópia)");

    // Confere que agora existem 2 musicas na biblioteca
    const songsInLib = await page.evaluate(() => {
      const raw = localStorage.getItem("caderno.library.v1");
      const parsed = JSON.parse(raw || "{}");
      return parsed.songs.length;
    });
    expect(songsInLib).toBe(2);

    // Confere que o IndexedDB NAO duplicou o registro binario: continua sendo exatamente 1
    const countAfterDup = await getStoredPdfCount(page);
    expect(countAfterDup, "Duplicacao nao deve aumentar registros no IndexedDB").toBe(1);

    // 3. Apaga a copia: o original ainda existe, portanto o PDF deve permanecer no IndexedDB
    await page.click('[data-action="delete-song"]');
    await page.click('[data-action="confirm-yes"]');
    await expect(page.locator("#main")).toBeVisible();

    const countAfterDeleteCopy = await getStoredPdfCount(page);
    expect(countAfterDeleteCopy, "PDF deve permanecer enquanto houver musica referenciando").toBe(1);

    // 4. Apaga o original (ultima referencia): o documento orfao deve ser removido do IndexedDB
    await gotoRoute(page, "#/musicas/song-orig");
    await page.click('[data-action="delete-song"]');
    await page.click('[data-action="confirm-yes"]');
    await expect(page.locator("#main")).toBeVisible();

    const countAfterDeleteLast = await getStoredPdfCount(page);
    expect(countAfterDeleteLast, "Ultima referencia apagada deve remover os bytes do IndexedDB").toBe(0);

    // Confere que tambem foi limpo do catalogo pdfDocuments da biblioteca
    const pdfDocsLeft = await page.evaluate(() => {
      const raw = localStorage.getItem("caderno.library.v1");
      const parsed = JSON.parse(raw || "{}");
      return parsed.pdfDocuments?.length || 0;
    });
    expect(pdfDocsLeft).toBe(0);

    expect(errors, "Nenhum erro no console durante o ciclo de vida do PDF").toEqual([]);
  });

  test("fase 3: status explicito ao tentar carregar documento ausente", async ({ page }) => {
    const brokenLibrary = {
      version: 2,
      pdfDocuments: [{ id: "doc-missing", name: "inexistente.pdf", pageCount: 3 }],
      songs: [
        {
          id: "song-broken",
          title: "Musica Sem Bytes",
          composer: "Fantasma",
          key: "C",
          tempo: 120,
          timeSignature: "",
          pdfName: "inexistente.pdf",
          pdfPages: 3,
          pdfRef: { documentId: "doc-missing", firstPage: 1, lastPage: 3 },
          sections: [{ id: "sec-1", label: "A", measures: [{ id: "m-1", chords: "C" }] }],
        },
      ],
      playlists: [],
      setlists: [],
    };

    // Inicializa sem gravar o PDF no IndexedDB
    await setupPage(page, { library: brokenLibrary, seedPdf: false });
    await gotoRoute(page, "#/musicas/song-broken");

    // Abre modo leitura
    await page.click('[data-action="read-pdf"]');

    // Confere que status explicito e exibido sem travar a aplicacao
    const status = page.locator(".pdf-status");
    await expect(status).toBeVisible();
    await expect(status).toContainText("PDF não encontrado neste dispositivo");
  });

});
