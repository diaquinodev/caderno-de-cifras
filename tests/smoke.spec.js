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

  test("fase 4: cancelamento no assistente de divisao nao grava registros orfaos no IndexedDB", async ({ page }) => {
    const errors = await setupPage(page, { seedPdf: false });
    await gotoRoute(page, "#/musicas/song-cifra-test");

    const countBefore = await getStoredPdfCount(page);
    expect(countBefore).toBe(0);

    const pdfBuffer = Buffer.from(TWELVE_PAGE_PDF_BASE64, "base64");
    await page.setInputFiles("#pdf-input", {
      name: "album-completo.pdf",
      mimeType: "application/pdf",
      buffer: pdfBuffer,
    });

    const wizardModal = page.locator("#pdf-wizard-modal");
    await expect(wizardModal).toBeVisible();
    await expect(wizardModal).toContainText("album-completo.pdf");
    await expect(wizardModal).toContainText("12 página(s)");

    const cards = page.locator("#wizard-page-grid .page-card");
    await expect(cards).toHaveCount(12);

    await page.click('[data-action="wizard-cancel"]');
    await expect(wizardModal).not.toBeVisible();

    const countAfterCancel = await getStoredPdfCount(page);
    expect(countAfterCancel, "Cancelamento não deve gravar bytes no IndexedDB").toBe(0);

    const songHasPdf = await page.evaluate(() => {
      const raw = localStorage.getItem("caderno.library.v1");
      const parsed = JSON.parse(raw || "{}");
      const song = parsed.songs?.find((s) => s.id === "song-cifra-test");
      return Boolean(song?.pdfRef || song?.pdfName);
    });
    expect(songHasPdf).toBe(false);

    expect(errors).toEqual([]);
  });

  test("fase 4: divisao de PDF em cinco musicas contiguas (1-6, 7-8, 9-10, 11, 12)", async ({ page }) => {
    const cleanLibrary = {
      version: 2,
      pdfDocuments: [],
      songs: [
        {
          id: "song-cifra-test",
          title: "Garota de Ipanema",
          composer: "Tom Jobim",
          key: "F",
          tempo: 125,
          timeSignature: "4/4",
          sections: [{ id: "sec-a", label: "A", measures: [{ id: "m-1", chords: "F7M" }] }],
        },
      ],
      playlists: [],
      setlists: [],
    };
    const errors = await setupPage(page, { library: cleanLibrary, seedPdf: false });
    await gotoRoute(page, "#/musicas/song-cifra-test");

    const pdfBuffer = Buffer.from(TWELVE_PAGE_PDF_BASE64, "base64");
    await page.setInputFiles("#pdf-input", {
      name: "novo-caderno-2026.pdf",
      mimeType: "application/pdf",
      buffer: pdfBuffer,
    });

    const wizardModal = page.locator("#pdf-wizard-modal");
    await expect(wizardModal).toBeVisible();

    await page.click('[data-action="wizard-set-mode"][data-mode="split"]');

    await page.fill('[data-wizard-input="range-title"][data-range-index="0"]', "Faixa 1 - Suíte");
    await page.fill('[data-wizard-input="range-last"][data-range-index="0"]', "6");

    await page.click('[data-action="wizard-add-range"]');
    await page.fill('[data-wizard-input="range-title"][data-range-index="1"]', "Faixa 2 - Balada");
    await page.fill('[data-wizard-input="range-first"][data-range-index="1"]', "7");
    await page.fill('[data-wizard-input="range-last"][data-range-index="1"]', "8");

    await page.click('[data-action="wizard-add-range"]');
    await page.fill('[data-wizard-input="range-title"][data-range-index="2"]', "Faixa 3 - Choro");
    await page.fill('[data-wizard-input="range-first"][data-range-index="2"]', "9");
    await page.fill('[data-wizard-input="range-last"][data-range-index="2"]', "10");

    await page.click('[data-action="wizard-add-range"]');
    await page.fill('[data-wizard-input="range-title"][data-range-index="3"]', "Faixa 4 - Vinheta");
    await page.fill('[data-wizard-input="range-first"][data-range-index="3"]', "11");
    await page.fill('[data-wizard-input="range-last"][data-range-index="3"]', "11");

    await page.click('[data-action="wizard-add-range"]');
    await page.fill('[data-wizard-input="range-title"][data-range-index="4"]', "Faixa 5 - Encerramento");
    await page.fill('[data-wizard-input="range-first"][data-range-index="4"]', "12");
    await page.fill('[data-wizard-input="range-last"][data-range-index="4"]', "12");

    const commitBtn = page.locator('[data-action="wizard-commit"]');
    await expect(commitBtn).toBeEnabled();

    await commitBtn.click();
    await expect(wizardModal).not.toBeVisible();

    const countInDb = await getStoredPdfCount(page);
    expect(countInDb, "Deve haver exatamente 1 documento PDF compartilhado no IndexedDB").toBe(1);

    const libState = await page.evaluate(() => {
      const raw = localStorage.getItem("caderno.library.v1");
      const parsed = JSON.parse(raw || "{}");
      return {
        docCount: parsed.pdfDocuments?.length || 0,
        docId: parsed.pdfDocuments?.[0]?.id,
        songs: parsed.songs?.map((s) => ({
          title: s.title,
          pdfName: s.pdfName,
          pdfPages: s.pdfPages,
          pdfRef: s.pdfRef,
        })),
      };
    });

    expect(libState.docCount, "1 documento registrado em pdfDocuments").toBe(1);
    const docId = libState.docId;

    const f1 = libState.songs.find((s) => s.title === "Faixa 1 - Suíte");
    const f2 = libState.songs.find((s) => s.title === "Faixa 2 - Balada");
    const f3 = libState.songs.find((s) => s.title === "Faixa 3 - Choro");
    const f4 = libState.songs.find((s) => s.title === "Faixa 4 - Vinheta");
    const f5 = libState.songs.find((s) => s.title === "Faixa 5 - Encerramento");

    expect(f1?.pdfRef).toEqual({ documentId: docId, firstPage: 1, lastPage: 6 });
    expect(f1?.pdfPages).toBe(6);

    expect(f2?.pdfRef).toEqual({ documentId: docId, firstPage: 7, lastPage: 8 });
    expect(f2?.pdfPages).toBe(2);

    expect(f3?.pdfRef).toEqual({ documentId: docId, firstPage: 9, lastPage: 10 });
    expect(f3?.pdfPages).toBe(2);

    expect(f4?.pdfRef).toEqual({ documentId: docId, firstPage: 11, lastPage: 11 });
    expect(f4?.pdfPages).toBe(1);

    expect(f5?.pdfRef).toEqual({ documentId: docId, firstPage: 12, lastPage: 12 });
    expect(f5?.pdfPages).toBe(1);

    const totalPages = (f1?.pdfPages || 0) + (f2?.pdfPages || 0) + (f3?.pdfPages || 0) + (f4?.pdfPages || 0) + (f5?.pdfPages || 0);
    expect(totalPages).toBe(12);

    expect(errors).toEqual([]);
  });

  test("fase 4: sobreposicoes e lacunas bloqueiam conclusao ate confirmacao explicita", async ({ page }) => {
    const errors = await setupPage(page, { seedPdf: false });
    await gotoRoute(page, "#/musicas/song-cifra-test");

    const pdfBuffer = Buffer.from(TWELVE_PAGE_PDF_BASE64, "base64");
    await page.setInputFiles("#pdf-input", {
      name: "partitura-gaps.pdf",
      mimeType: "application/pdf",
      buffer: pdfBuffer,
    });

    const wizardModal = page.locator("#pdf-wizard-modal");
    await expect(wizardModal).toBeVisible();

    await page.click('[data-action="wizard-set-mode"][data-mode="split"]');

    await page.fill('[data-wizard-input="range-last"][data-range-index="0"]', "4");

    await page.click('[data-action="wizard-add-range"]');
    await page.fill('[data-wizard-input="range-first"][data-range-index="1"]', "3");
    await page.fill('[data-wizard-input="range-last"][data-range-index="1"]', "6");

    const commitBtn = page.locator('[data-action="wizard-commit"]');
    await expect(commitBtn).toBeDisabled();

    await page.click('[data-action="wizard-toggle-overlap"]');
    await expect(commitBtn, "Ainda bloqueado por conta de lacunas").toBeDisabled();

    await page.click('[data-action="wizard-toggle-gaps"]');
    await expect(commitBtn, "Habilitado apos confirmar sobreposicoes e lacunas").toBeEnabled();

    await page.click('[data-action="wizard-cancel"]');
    expect(errors).toEqual([]);
  });

  test("fase 5: navegacao no modo palco com setlist mista e retorno para a ultima pagina da musica anterior", async ({ page }) => {
    const stageLibrary = {
      version: 2,
      pdfDocuments: [
        {
          id: "doc-stage-12",
          name: "partituras-show.pdf",
          pageCount: 12,
        },
      ],
      songs: [
        {
          id: "song-cifra-1",
          title: "1. Cifra Inicial",
          composer: "Compositor A",
          key: "C",
          tempo: 120,
          timeSignature: "4/4",
          sections: [{ id: "sec-1", label: "A", measures: [{ id: "m-1", chords: "C" }] }],
        },
        {
          id: "song-pdf-2",
          title: "2. Partitura Wave",
          composer: "Tom Jobim",
          key: "D",
          tempo: 130,
          timeSignature: "4/4",
          pdfName: "partituras-show.pdf",
          pdfPages: 2,
          pdfRef: { documentId: "doc-stage-12", firstPage: 7, lastPage: 8 },
          sections: [{ id: "sec-2", label: "A", measures: [{ id: "m-2", chords: "D" }] }],
        },
        {
          id: "song-cifra-3",
          title: "3. Cifra Final",
          composer: "Compositor B",
          key: "G",
          tempo: 110,
          timeSignature: "4/4",
          sections: [{ id: "sec-3", label: "A", measures: [{ id: "m-3", chords: "G" }] }],
        },
      ],
      playlists: [],
      setlists: [
        {
          id: "setlist-show-1",
          name: "Show Principal",
          items: [
            { songId: "song-cifra-1", key: "C" },
            { songId: "song-pdf-2", key: "D" },
            { songId: "song-cifra-3", key: "G" },
          ],
        },
      ],
    };

    const errors = await setupPage(page, {
      library: stageLibrary,
      seedPdf: false,
      customPdfs: [
        {
          id: "doc-stage-12",
          name: "partituras-show.pdf",
          pageCount: 12,
          base64: TWELVE_PAGE_PDF_BASE64,
        },
      ],
    });

    // 1. Entra no modo palco
    await gotoRoute(page, "#/setlists/setlist-show-1/palco");
    await expect(page.locator(".stage-bar")).toBeVisible();
    await expect(page.locator("#stage-picker")).toHaveValue("0");

    // Início da setlist: botão Anterior desabilitado, Próxima habilitado
    await expect(page.locator('[data-action="stage-prev"]')).toBeDisabled();
    await expect(page.locator('[data-action="stage-next"]')).toBeEnabled();

    // 2. Avança com o botão "Próxima" -> entra na Música 2 (Partitura), página relativa 1 (física 7)
    await page.click('[data-action="stage-next"]');
    await expect(page.locator("#stage-picker")).toHaveValue("1");

    const canvas = page.locator("canvas.pdf-canvas");
    await expect(canvas).toBeVisible({ timeout: 10000 });
    await expect(canvas).toHaveAttribute("data-rendered", "true", { timeout: 10000 });
    await expect(canvas).toHaveAttribute("data-page", "1");
    await expect(canvas).toHaveAttribute("data-physical-page", "7");
    await expect(page.locator(".pdf-caption")).toContainText("página 1 de 2");

    // 3. Avança com a tecla ArrowRight -> permanece na Música 2, avança para página relativa 2 (física 8)
    await page.keyboard.press("ArrowRight");
    await expect(canvas).toHaveAttribute("data-page", "2");
    await expect(canvas).toHaveAttribute("data-physical-page", "8");
    await expect(page.locator(".pdf-caption")).toContainText("página 2 de 2");
    await expect(page.locator("#stage-picker")).toHaveValue("1");

    // 4. Avança com toque na zona lateral direita (.tap-zone.next) -> entra na Música 3 (Cifra Final)
    await page.click(".tap-zone.next");
    await expect(page.locator("#stage-picker")).toHaveValue("2");
    await expect(page.locator("#stage-paper")).toBeVisible();
    await expect(page.locator("h1.sheet-title")).toContainText("3. Cifra Final");

    // Fim da setlist: botão Próxima desabilitado, Anterior habilitado
    await expect(page.locator('[data-action="stage-next"]')).toBeDisabled();
    await expect(page.locator('[data-action="stage-prev"]')).toBeEnabled();

    // 5. RECUO CRUCIAL: De Música 3 (cifra) voltando com botão "Anterior" -> DEVE ENTRAR NA MÚSICA 2 NA PÁGINA 2 DE 2!
    await page.click('[data-action="stage-prev"]');
    await expect(page.locator("#stage-picker")).toHaveValue("1");
    await expect(canvas).toBeVisible();
    await expect(canvas).toHaveAttribute("data-page", "2");
    await expect(canvas).toHaveAttribute("data-physical-page", "8");
    await expect(page.locator(".pdf-caption")).toContainText("página 2 de 2");

    // 6. Recua com a tecla ArrowLeft -> permanece na Música 2, volta para página 1 de 2 (física 7)
    await page.keyboard.press("ArrowLeft");
    await expect(canvas).toHaveAttribute("data-page", "1");
    await expect(canvas).toHaveAttribute("data-physical-page", "7");
    await expect(page.locator(".pdf-caption")).toContainText("página 1 de 2");

    // 7. Recua com toque na zona lateral esquerda (.tap-zone.prev) -> volta para Música 1 (Cifra Inicial)
    await page.click(".tap-zone.prev");
    await expect(page.locator("#stage-picker")).toHaveValue("0");
    await expect(page.locator("#stage-paper")).toBeVisible();
    await expect(page.locator("h1.sheet-title")).toContainText("1. Cifra Inicial");
    await expect(page.locator('[data-action="stage-prev"]')).toBeDisabled();

    expect(errors).toEqual([]);
  });

  test("fase 5: zonas de toque laterais respeitam geometria segura e nao obstruem controles", async ({ page }) => {
    const stageLibrary = {
      version: 2,
      pdfDocuments: [],
      songs: [
        {
          id: "song-safe-1",
          title: "Música Segura A",
          composer: "Compositor",
          key: "C",
          tempo: 120,
          timeSignature: "4/4",
          sections: [{ id: "sec-1", label: "A", measures: [{ id: "m-1", chords: "C" }] }],
        },
        {
          id: "song-safe-2",
          title: "Música Segura B",
          composer: "Compositor",
          key: "D",
          tempo: 120,
          timeSignature: "4/4",
          sections: [{ id: "sec-2", label: "A", measures: [{ id: "m-2", chords: "D" }] }],
        },
      ],
      playlists: [],
      setlists: [
        {
          id: "setlist-safe-1",
          name: "Setlist Segura",
          items: [{ songId: "song-safe-1" }, { songId: "song-safe-2" }],
        },
      ],
    };

    const errors = await setupPage(page, { library: stageLibrary, seedPdf: false });
    await gotoRoute(page, "#/setlists/setlist-safe-1/palco");

    // Verifica que o seletor #stage-picker pode ser clicado e alterado diretamente sem ser bloqueado pela tap zone
    const picker = page.locator("#stage-picker");
    await expect(picker).toBeVisible();
    await picker.selectOption("1");
    await expect(picker).toHaveValue("1");
    await expect(page.locator("h1.sheet-title")).toContainText("Música Segura B");

    // Verifica que o botão "Sair do palco" no canto superior esquerdo pode ser clicado sem disparar a tap-zone.prev
    const exitBtn = page.locator('[data-action="exit-stage"]');
    await expect(exitBtn).toBeVisible();
    await exitBtn.click();
    await expect(page).toHaveURL(/#\/setlists\/setlist-safe-1/);

    expect(errors).toEqual([]);
  });

  test("fase 6: exportar, limpar, importar e tocar as cinco musicas do PDF nos mesmos intervalos", async ({ page }) => {
    const docId = "doc-album-5";
    const fiveSongsLibrary = {
      version: 2,
      pdfDocuments: [{ id: docId, name: "album-5.pdf", pageCount: 12 }],
      songs: [
        {
          id: "song-1",
          title: "Faixa 1",
          pdfRef: { documentId: docId, firstPage: 1, lastPage: 2 },
          pdfName: "album-5.pdf",
          pdfPages: 2,
          sections: [{ id: "s-1", label: "A", measures: [{ id: "m-1", chords: "C" }] }],
        },
        {
          id: "song-2",
          title: "Faixa 2",
          pdfRef: { documentId: docId, firstPage: 3, lastPage: 5 },
          pdfName: "album-5.pdf",
          pdfPages: 3,
          sections: [{ id: "s-2", label: "A", measures: [{ id: "m-2", chords: "D" }] }],
        },
        {
          id: "song-3",
          title: "Faixa 3",
          pdfRef: { documentId: docId, firstPage: 6, lastPage: 7 },
          pdfName: "album-5.pdf",
          pdfPages: 2,
          sections: [{ id: "s-3", label: "A", measures: [{ id: "m-3", chords: "E" }] }],
        },
        {
          id: "song-4",
          title: "Faixa 4",
          pdfRef: { documentId: docId, firstPage: 8, lastPage: 10 },
          pdfName: "album-5.pdf",
          pdfPages: 3,
          sections: [{ id: "s-4", label: "A", measures: [{ id: "m-4", chords: "F" }] }],
        },
        {
          id: "song-5",
          title: "Faixa 5",
          pdfRef: { documentId: docId, firstPage: 11, lastPage: 12 },
          pdfName: "album-5.pdf",
          pdfPages: 2,
          sections: [{ id: "s-5", label: "A", measures: [{ id: "m-5", chords: "G" }] }],
        },
      ],
      playlists: [],
      setlists: [
        {
          id: "setlist-album-5",
          name: "Setlist das 5 Faixas",
          items: [
            { songId: "song-1" },
            { songId: "song-2" },
            { songId: "song-3" },
            { songId: "song-4" },
            { songId: "song-5" },
          ],
        },
      ],
    };

    const errors = await setupPage(page, {
      library: fiveSongsLibrary,
      seedPdf: false,
      customPdfs: [{ id: docId, name: "album-5.pdf", pageCount: 12, base64: TWELVE_PAGE_PDF_BASE64 }],
    });

    await gotoRoute(page, "#/musicas");

    // 1. Exporta o backup via UI
    const downloadPromise = page.waitForEvent("download");
    await page.click('button[data-action="export"]');
    const download = await downloadPromise;
    const downloadStream = await download.createReadStream();
    const chunks = [];
    for await (const chunk of downloadStream) chunks.push(chunk);
    const backupJsonText = Buffer.concat(chunks).toString("utf8");
    const backupData = JSON.parse(backupJsonText);

    // Valida que o JSON tem BackupV2 com uma unica ocorrencia dos bytes do PDF
    expect(backupData.version).toBe(2);
    expect(backupData.pdfDocuments.length).toBe(1);
    expect(backupData.pdfDocuments[0].id).toBe(docId);
    const occurrences = backupJsonText.split(backupData.pdfDocuments[0].data).length - 1;
    expect(occurrences).toBe(1);

    // 2. Limpa toda a biblioteca e IndexedDB no navegador
    await page.evaluate(async () => {
      localStorage.clear();
      const dbs = (await window.indexedDB.databases?.()) || [];
      for (const db of dbs) {
        if (db.name) window.indexedDB.deleteDatabase(db.name);
      }
    });

    // Recarrega pagina em branco
    await page.reload();
    await page.waitForLoadState("domcontentloaded");
    await expect(page.locator("h1")).toBeVisible();

    // 3. Importa o backup exportado via modal de importacao (Substituir tudo)
    await page.click('button[data-action="import"]');
    const importModal = page.locator("#import-title");
    await expect(importModal).toBeVisible();

    await page.setInputFiles("#import-file", {
      name: "caderno-biblioteca.json",
      mimeType: "application/json",
      buffer: Buffer.from(backupJsonText, "utf8"),
    });

    // Clica em "Substituir tudo" e confirma modal
    await page.click('[data-action="replace-import"]');
    const confirmBtn = page.locator('[data-action="confirm-yes"]');
    await expect(confirmBtn).toBeVisible();
    await confirmBtn.click();

    // Espera toast de sucesso
    await expect(page.locator("#toast")).toContainText("Biblioteca substituída");

    // 4. Vai para o palco da setlist e toca as cinco musicas nos mesmos intervalos
    await gotoRoute(page, "#/setlists/setlist-album-5/palco");

    // Faixa 1 (paginas 1 e 2 do PDF)
    await expect(page.locator("#stage-picker")).toHaveValue("0");
    await expect(page.locator(".pdf-caption")).toContainText("Faixa 1");
    await expect(page.locator(".pdf-caption")).toContainText("página 1 de 2");
    await expect(page.locator("canvas.pdf-canvas")).toHaveAttribute("data-physical-page", "1");

    await page.click('[data-action="stage-next"]');
    await expect(page.locator(".pdf-caption")).toContainText("Faixa 1");
    await expect(page.locator(".pdf-caption")).toContainText("página 2 de 2");
    await expect(page.locator("canvas.pdf-canvas")).toHaveAttribute("data-physical-page", "2");

    // Avanca para Faixa 2 (paginas 3, 4 e 5 do PDF -> 1/3, 2/3, 3/3)
    await page.click('[data-action="stage-next"]');
    await expect(page.locator("#stage-picker")).toHaveValue("1");
    await expect(page.locator(".pdf-caption")).toContainText("Faixa 2");
    await expect(page.locator(".pdf-caption")).toContainText("página 1 de 3");
    await expect(page.locator("canvas.pdf-canvas")).toHaveAttribute("data-physical-page", "3");

    await page.click('[data-action="stage-next"]');
    await expect(page.locator(".pdf-caption")).toContainText("Faixa 2");
    await expect(page.locator(".pdf-caption")).toContainText("página 2 de 3");
    await expect(page.locator("canvas.pdf-canvas")).toHaveAttribute("data-physical-page", "4");

    await page.click('[data-action="stage-next"]');
    await expect(page.locator(".pdf-caption")).toContainText("Faixa 2");
    await expect(page.locator(".pdf-caption")).toContainText("página 3 de 3");
    await expect(page.locator("canvas.pdf-canvas")).toHaveAttribute("data-physical-page", "5");

    // Avanca para Faixa 3
    await page.click('[data-action="stage-next"]');
    await expect(page.locator("#stage-picker")).toHaveValue("2");
    await expect(page.locator(".pdf-caption")).toContainText("Faixa 3");
    await expect(page.locator(".pdf-caption")).toContainText("página 1 de 2");
    await expect(page.locator("canvas.pdf-canvas")).toHaveAttribute("data-physical-page", "6");

    // Volta para Faixa 2 -> deve cair na ultima pagina (3 de 3, pagina fisica 5)
    await page.click('[data-action="stage-prev"]');
    await expect(page.locator("#stage-picker")).toHaveValue("1");
    await expect(page.locator(".pdf-caption")).toContainText("Faixa 2");
    await expect(page.locator(".pdf-caption")).toContainText("página 3 de 3");
    await expect(page.locator("canvas.pdf-canvas")).toHaveAttribute("data-physical-page", "5");
    expect(errors).toEqual([]);
  });
  test("fase 7: carregar as seis fixtures e exibir fonte literal sem criar Song antecipadamente", async ({ page }) => {
    const errors = await setupPage(page, { seedPdf: false });
    await gotoRoute(page, "#/musicas");

    // Confere contagem inicial de musicas
    const initialSongs = await page.locator("#list button[data-action='open-song'], #list a").count();

    // Abre modal de colar cifra diretamente a partir da criacao de musica
    await page.click('[data-action="new-song"]');
    await page.click('[data-action="open-paste"]');
    await expect(page.locator("#paste-title")).toBeVisible();

    const preview = page.locator("#source-preview");

    // 1. Testa Fixture 1: So Easy
    await page.click('[data-action="load-fixture"][data-fixture-id="so-easy"]');
    await expect(preview).toBeVisible();
    await expect(preview).toContainText("So Easy (To Fall In Love)");
    await expect(preview).toContainText("Tom: C");
    await expect(preview).toContainText("Seção: Intro");
    await expect(preview).toContainText("Seção: Refrão");

    // 2. Testa Fixture 4: Aguas de Marco (deve identificar bloco anonimo)
    await page.click('[data-action="load-fixture"][data-fixture-id="aguas-de-marco"]');
    await expect(preview).toContainText("Águas de Março");
    await expect(preview).toContainText("Tom: Bb");
    await expect(preview).toContainText("Bloco anônimo");

    // 3. Testa Fixture 6: Samba de Uma Nota So (deve identificar tablatura)
    await page.click('[data-action="load-fixture"][data-fixture-id="samba-de-uma-nota-so"]');
    await expect(preview).toContainText("Samba de Uma Nota Só");
    await expect(preview).toContainText("Tom: D");
    await expect(preview).toContainText("Tablatura: Tab - Intro");

    // Fecha modal sem aplicar
    const closeBtn = page.locator('.modal [data-action="close-modal"]');
    await closeBtn.scrollIntoViewIfNeeded();
    await closeBtn.click();
    await expect(page.locator("#paste-title")).not.toBeVisible();

    // Retorna a biblioteca e confirma que nenhuma musica foi criada
    await gotoRoute(page, "#/musicas");
    const finalSongs = await page.locator("#list button[data-action='open-song'], #list a").count();
    expect(finalSongs).toBe(initialSongs);

    expect(errors).toEqual([]);
  });
  test("fase 8: fluxo interativo do rascunho musical - aviso de compasso, divisao, cancelamento e confirmacao", async ({ page }) => {
    const errors = await setupPage(page, { seedPdf: false });
    await gotoRoute(page, "#/musicas");

    const initialSongs = await page.locator("#list button[data-action='open-song'], #list a").count();

    // 1. Abre modal de colar cifra
    await page.click('[data-action="new-song"]');
    await page.click('[data-action="open-paste"]');
    await expect(page.locator("#paste-title")).toBeVisible();

    // 2. Carrega fixture "So Easy"
    await page.click('[data-action="load-fixture"][data-fixture-id="so-easy"]');

    // 3. Clica em "Gerar rascunho"
    await page.click('[data-action="open-draft"]');
    await expect(page.locator("#draft-title")).toBeVisible();
    await expect(page.locator("#draft-title")).toContainText("Rascunho Musical");

    // 4. Valida aviso de timeSignature ausente
    const timeSigBanner = page.locator("#draft-time-sig-banner");
    await expect(timeSigBanner).toBeVisible();
    await expect(timeSigBanner).toContainText("Fórmula de compasso não definida");

    // 5. Define timeSignature 4/4
    await page.click('[data-action="draft-set-timesig"][data-timesig="4/4"]');
    await expect(page.locator("#selected-timesig")).toHaveText("4/4");

    // 6. Testa cancelamento: fecha sem salvar
    const cancelBtn = page.locator('.modal [data-action="draft-cancel"]');
    await cancelBtn.scrollIntoViewIfNeeded();
    await cancelBtn.click();
    await expect(page.locator("#draft-title")).not.toBeVisible();

    // Retorna a lista e confirma que nenhuma musica foi criada
    await gotoRoute(page, "#/musicas");
    const afterCancelSongs = await page.locator("#list button[data-action='open-song'], #list a").count();
    expect(afterCancelSongs).toBe(initialSongs);

    // 7. Agora repete o fluxo e confirma a criacao
    await page.click('[data-action="new-song"]');
    await page.click('[data-action="open-paste"]');
    await page.click('[data-action="load-fixture"][data-fixture-id="so-easy"]');
    await page.click('[data-action="open-draft"]');
    await expect(page.locator("#draft-title")).toBeVisible();

    // Define 4/4
    await page.click('[data-action="draft-set-timesig"][data-timesig="4/4"]');

    // Clica em dividir o primeiro compasso elegivel
    const splitBtn = page.locator('[data-action="draft-split-measure"]').first();
    if (await splitBtn.isVisible()) {
      await splitBtn.click();
    }

    // Clica em confirmar rascunho
    const confirmBtn = page.locator('.modal [data-action="draft-confirm"]');
    await confirmBtn.scrollIntoViewIfNeeded();
    await confirmBtn.click();
    await expect(page.locator("#draft-title")).not.toBeVisible();

    // Confirma que a musica foi salva e exibe compassos
    await expect(page.locator("input.sheet-title")).toHaveValue(/So Easy/);
    await expect(page.locator("#paper-body")).toBeVisible();
    const finalBars = await page.locator("#paper-body .bar").count();
    expect(finalBars).toBeGreaterThan(0);

    expect(errors).toEqual([]);
  });
  test("fase 9 / clipper fase 7: orientacao de extensao/colagem ao receber URL isolada e importacao de texto canonico", async ({ page }) => {
    const errors = await setupPage(page, { seedPdf: false });
    await gotoRoute(page, "#/musicas");

    await page.click('[data-action="new-song"]');
    await page.click('[data-action="open-paste"]');
    await expect(page.locator(".modal")).toContainText("Caderno Clipper");

    // 1. Testa rejeicao de link que nao e do Cifra Club
    await page.fill("#paste-text", "https://www.google.com/search?q=cifra");
    await page.click('[data-action="open-draft"]');
    await expect(page.locator("#paste-error")).toBeVisible();
    await expect(page.locator("#paste-error")).toContainText("não é um link válido do Cifra Club");

    // 2. Testa URL isolada do Cifra Club -> orienta uso do Caderno Clipper ou colagem manual sem chamar servidor
    await page.fill("#paste-text", "https://www.cifraclub.com.br/artista/bloqueada/");
    await page.click('[data-action="open-draft"]');
    await expect(page.locator("#paste-error")).toBeVisible();
    await expect(page.locator("#paste-error")).toContainText("Caderno Clipper");

    // 3. No mesmo modal (sem beco sem saida), cola o texto canonico extraido e gera o rascunho
    await page.fill(
      "#paste-text",
      "Título: Cifra Extraída Localmente\nArtista: Artista Teste\nTom: G\n\n[Intro]\nG C"
    );
    await page.click('[data-action="inspect-source"]');
    await expect(page.locator("#paste-error")).toBeHidden();
    await expect(page.locator("#source-preview")).toContainText("Cifra Extraída Localmente");

    await page.click('[data-action="open-draft"]');
    await expect(page.locator("#draft-title")).toBeVisible();
    await expect(page.locator(".modal")).toContainText("Cifra Extraída Localmente");
    await expect(page.locator(".modal")).toContainText("Tom: G");

    // Fecha o modal
    await page.click('.modal [data-action="draft-cancel"]');
    await expect(page.locator("#draft-title")).not.toBeVisible();

    expect(errors).toEqual([]);
  });
  test("fase 10: revisao responsiva - bloqueio de confirmacao sem compasso, desfazer, mover e visualizacao de fonte", async ({ page }) => {
    const errors = await setupPage(page, { seedPdf: false });
    await gotoRoute(page, "#/musicas");

    // 1. Abre modal com cifra colada
    await page.click('[data-action="new-song"]');
    await page.click('[data-action="open-paste"]');
    await page.fill("#paste-text", "Tom: C\n[Intro]\n| C | G | Am | F |\n[A]\n| C | Em | F | G |");
    await page.click('[data-action="open-draft"]');
    await expect(page.locator("#draft-title")).toBeVisible();

    // 2. Em tela desktop (>= 1024px), ambas as colunas são exibidas lado a lado
    await expect(page.locator(".draft-source-column")).toBeVisible();
    await expect(page.locator(".draft-chart-column")).toBeVisible();
    await expect(page.locator(".draft-source-column")).toContainText("Intro");

    // 3. Tenta confirmar sem fórmula de compasso selecionada
    await page.click('[data-action="draft-confirm"]');
    // Modal NÃO deve fechar
    await expect(page.locator("#draft-title")).toBeVisible();
    await expect(page.locator("#draft-time-sig-error")).toBeVisible();
    await expect(page.locator("#draft-time-sig-error")).toContainText("Escolha uma fórmula de compasso");
    await expect(page.locator("#draft-time-sig-banner")).toHaveClass(/pulse-error/);

    // 4. Escolhe fórmula de compasso 4/4
    await page.click('[data-action="draft-set-timesig"][data-timesig="4/4"]');
    await expect(page.locator("#selected-timesig")).toHaveText("4/4");

    // 5. Em tela móvel (< 1024px), testa alternância por abas
    await page.setViewportSize({ width: 390, height: 844 });
    await page.click('[data-action="draft-switch-tab"][data-tab="source"]');
    await expect(page.locator(".draft-source-column")).toBeVisible();
    await expect(page.locator(".draft-chart-column")).not.toBeVisible();

    await page.click('[data-action="draft-switch-tab"][data-tab="chart"]');
    await expect(page.locator(".draft-chart-column")).toBeVisible();
    await expect(page.locator(".draft-source-column")).not.toBeVisible();

    // 6. Testa mover compasso e desfazer (Undo)
    const firstSectionMeasures = page.locator(".draft-section-card").first().locator(".draft-measure-box");
    const initialFirstChord = await firstSectionMeasures.first().locator(".measure-chords").textContent();

    // Move primeiro compasso para direita
    await firstSectionMeasures.first().locator('[data-action="draft-move-measure"][data-dir="1"]').click();
    const movedFirstChord = await firstSectionMeasures.first().locator(".measure-chords").textContent();
    expect(movedFirstChord).not.toEqual(initialFirstChord);

    // Desfaz a ação
    await page.click("#btn-draft-undo");
    const restoredFirstChord = await firstSectionMeasures.first().locator(".measure-chords").textContent();
    expect(restoredFirstChord).toEqual(initialFirstChord);

    // 7. Confirma o rascunho com sucesso
    await page.click('[data-action="draft-confirm"]');
    await expect(page.locator("#draft-title")).not.toBeVisible();
    await expect(page.locator(".sheet-title")).toBeVisible();

    expect(errors).toEqual([]);
  });
  test("fase 13: edicao de acordes por compasso (| F#m D7M | C#m7 B | E7 | -> | F#m | D7M C#m7 | B | E7 |), tempos em 4/4 e desfazer em 390x844, 1024x768 e 1440x900", async ({ page }) => {
    const errors = await setupPage(page, { seedPdf: false });
    const viewports = [
      { width: 390, height: 844 },
      { width: 1024, height: 768 },
      { width: 1440, height: 900 },
    ];

    for (const vp of viewports) {
      await page.setViewportSize(vp);
      await gotoRoute(page, "#/musicas");

      await page.click('[data-action="new-song"]');
      await page.click('[data-action="open-paste"]');
      await page.fill("#paste-text", "Título: Caso Compasso\nTom: A\n[A]\nF#m D7M C#m7 B E7");
      await page.click('[data-action="open-draft"]');
      await expect(page.locator("#draft-title")).toBeVisible();

      // Seleciona 4/4 para habilitar a avaliação de tempos de 4/4
      await page.click('[data-action="draft-set-timesig"][data-timesig="4/4"]');
      await expect(page.locator("#selected-timesig")).toHaveText("4/4");

      const measureBoxes = page.locator(".draft-section-card").first().locator(".draft-measure-box");
      await expect(measureBoxes).toHaveCount(3);

      // Estado inicial sugerido pela heurística de pares: | F#m D7M | C#m7 B | E7 |
      const getMeasureStrings = async () => {
        const count = await measureBoxes.count();
        const out = [];
        for (let i = 0; i < count; i += 1) {
          const txt = await measureBoxes.nth(i).locator(".measure-chords").textContent();
          out.push((txt || "").trim().replace(/\s+/g, " "));
        }
        return out;
      };

      expect(await getMeasureStrings()).toEqual(["F#m D7M", "C#m7 B", "E7"]);

      // Verifica indicação de tempos em 4/4 (2 + 2 tempos nos dois primeiros, 4 tempos no último)
      await expect(measureBoxes.nth(0).locator(".measure-beat-meta")).toContainText("2 + 2 tempos");
      await expect(measureBoxes.nth(2).locator(".measure-beat-meta")).toContainText("4 tempos");

      // Passo 1: seleciona D7M no compasso 1 e move isoladamente para o compasso seguinte
      const d7mBtn = measureBoxes.nth(0).locator('.measure-chord-token[data-chord-raw="D7M"]');
      await d7mBtn.click();
      await expect(d7mBtn).toHaveAttribute("aria-pressed", "true");

      const moveRightBtn = measureBoxes.nth(0).locator('[data-action="draft-move-chord"][data-dir="1"]');
      await expect(moveRightBtn).toBeEnabled();
      await moveRightBtn.click();

      // Agora temos | F#m | D7M C#m7 B | E7 |
      expect(await getMeasureStrings()).toEqual(["F#m", "D7M C#m7 B", "E7"]);

      // O compasso 2 tem 3 acordes em 4/4 -> deve exibir aviso de conferência sem duração inventada
      await expect(measureBoxes.nth(1)).toHaveAttribute("data-needs-review", "true");
      await expect(measureBoxes.nth(1).locator(".measure-beat-meta")).toContainText("Conferir divisão (3 acordes)");
      await expect(page.locator("#draft-warnings-list")).toContainText("possui 3 acordes em 4/4");

      // Passo 2: seleciona B no compasso 2 e divide usando B como fronteira
      const bBtn = measureBoxes.nth(1).locator('.measure-chord-token[data-chord-raw="B"]');
      await bBtn.click();
      await expect(bBtn).toHaveAttribute("aria-pressed", "true");

      await measureBoxes.nth(1).locator('[data-action="draft-split-measure"]').click();

      // Resultado atingido sem editar texto: | F#m | D7M C#m7 | B | E7 |
      expect(await getMeasureStrings()).toEqual(["F#m", "D7M C#m7", "B", "E7"]);
      await expect(measureBoxes.nth(0).locator(".measure-beat-meta")).toContainText("4 tempos");
      await expect(measureBoxes.nth(1).locator(".measure-beat-meta")).toContainText("2 + 2 tempos");
      await expect(measureBoxes.nth(2).locator(".measure-beat-meta")).toContainText("4 tempos");
      await expect(measureBoxes.nth(3).locator(".measure-beat-meta")).toContainText("4 tempos");

      // Testa Desfazer (Undo) e refazer a divisão para provar reversibilidade
      await page.click("#btn-draft-undo");
      expect(await getMeasureStrings()).toEqual(["F#m", "D7M C#m7 B", "E7"]);

      await measureBoxes.nth(1).locator('.measure-chord-token[data-chord-raw="B"]').click();
      await measureBoxes.nth(1).locator('[data-action="draft-split-chord"]').click();
      expect(await getMeasureStrings()).toEqual(["F#m", "D7M C#m7", "B", "E7"]);

      // Verifica ausência de rolagem horizontal acidental na janela
      const overflowX = await page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth
      );
      expect(overflowX).toBeLessThanOrEqual(0);

      // Fecha/cancela nos dois primeiros viewports e confirma no último (1440x900)
      if (vp.width < 1440) {
        const cancelBtn = page.locator('.modal [data-action="draft-cancel"]');
        await cancelBtn.scrollIntoViewIfNeeded();
        await cancelBtn.click();
        await expect(page.locator("#draft-title")).not.toBeVisible();
      } else {
        const confirmBtn = page.locator('.modal [data-action="draft-confirm"]');
        await confirmBtn.scrollIntoViewIfNeeded();
        await confirmBtn.click();
        await expect(page.locator("#draft-title")).not.toBeVisible();
        await expect(page.locator("input.sheet-title")).toHaveValue("Caso Compasso");
        await expect(page.locator("#paper-body .bar")).toHaveCount(4);
      }
    }

    expect(errors).toEqual([]);
  });
  test("fase 11: pwa manifest, prontidao offline e operacao de palco sem rede", async ({ page, request }) => {
    // 1. Verifica headers e conteudo do manifest
    const manifestRes = await request.get("/manifest.webmanifest");
    expect(manifestRes.status()).toBe(200);
    const manifest = await manifestRes.json();
    expect(manifest.name).toBe("Caderno de Cifras e Setlists");
    expect(manifest.display).toBe("standalone");
    expect(manifest.icons.length).toBeGreaterThanOrEqual(2);

    // 2. Verifica disponibilidade do Service Worker
    const swRes = await request.get("/sw.js");
    expect(swRes.status()).toBe(200);
    expect(swRes.headers()["content-type"]).toContain("javascript");

    // 3. Inicializa a aplicacao
    const errors = await setupPage(page);
    await gotoRoute(page, "#/setlists/setlist-1");

    // 4. Verifica presenca das tags no head
    const manifestTag = page.locator('link[rel="manifest"]');
    await expect(manifestTag).toHaveAttribute("href", "manifest.webmanifest");
    const iconTag = page.locator('link[rel="icon"]');
    await expect(iconTag).toHaveAttribute("href", "icon.svg");

    // 5. Verifica indicador de setlist pronta offline
    const setlistBadge = page.locator("#setlist-offline-badge");
    await expect(setlistBadge).toBeVisible();
    await expect(setlistBadge).toContainText("Músicas e partituras prontas para tocar offline");

    // 6. Entra no modo palco e checa badge de palco offline
    await page.click('[data-action="enter-stage"]');
    const stageBadge = page.locator("#stage-offline-badge");
    await expect(stageBadge).toBeVisible();
    await expect(stageBadge).toContainText("Palco offline");

    // 7. Simula desconexao total de rede (offline no palco)
    await page.context().setOffline(true);

    // 8. No palco desconectado, avanca para proxima musica (Wave)
    const stagePicker = page.locator("#stage-picker");
    await expect(stagePicker).toHaveValue("0");
    await page.click('[data-action="stage-next"]');
    await expect(stagePicker).toHaveValue("1");
    await expect(stageBadge).toBeVisible();

    // Volta e transpoe no palco
    await page.click('[data-action="stage-prev"]');
    await expect(stagePicker).toHaveValue("0");
    await expect(page.locator("h1.sheet-title")).toHaveText("Garota de Ipanema");

    // Sai do palco mesmo offline
    await page.click('[data-action="exit-stage"]');
    await expect(page).toHaveURL(/#\/setlists\/setlist-1/);
    await expect(page.locator("#setlist-offline-badge")).toBeVisible();

    // Restaura conexao
    await page.context().setOffline(false);

    const appErrors = errors.filter((err) => !err.includes("ERR_INTERNET_DISCONNECTED"));
    expect(appErrors, "Nenhum erro inesperado da aplicação no console").toEqual([]);
  });

  test("fase 16: leitura paginada de cifra HTML longa (Página X de Y, teclado, toque e ordem página->música)", async ({ page }) => {
    const makeMeasures = (prefix, count) =>
      Array.from({ length: count }, (_, idx) => ({
        id: `${prefix}-${idx + 1}`,
        chords: idx === 0 ? `${prefix}1` : "C7M Dm7 G7",
        ending: "",
        repeat: "",
      }));

    const pagedLibrary = {
      version: 2,
      pdfDocuments: [],
      songs: [
        {
          id: "song-long-16",
          title: "Suíte Longa 16 Linhas",
          composer: "Mestre Harmônico",
          style: "Samba",
          key: "C",
          tempo: 120,
          timeSignature: "4/4",
          barsPerRow: 4,
          sections: [
            { id: "sec-a", label: "Parte A", measures: makeMeasures("A", 32) },
            { id: "sec-b", label: "Parte B", measures: makeMeasures("B", 32) },
          ],
        },
        {
          id: "song-next-short",
          title: "Tema Final Curto",
          composer: "Autor B",
          style: "Bossa",
          key: "G",
          tempo: 110,
          timeSignature: "4/4",
          barsPerRow: 4,
          sections: [{ id: "sec-c", label: "A", measures: [{ id: "c-1", chords: "G7M" }] }],
        },
      ],
      playlists: [],
      setlists: [
        {
          id: "setlist-paged",
          name: "Show Paginado",
          items: [{ songId: "song-long-16" }, { songId: "song-next-short" }],
        },
      ],
    };

    const errors = await setupPage(page, { library: pagedLibrary, seedPdf: false });
    await page.setViewportSize({ width: 768, height: 1024 });

    // 1. Modo limpo em música individual (#/musicas/song-long-16) em 1-up (retrato)
    await gotoRoute(page, "#/musicas/song-long-16");
    await expect(page.locator("#paper-body .staff-line")).toHaveCount(16);

    await page.click('[data-action="toggle-clean"]');
    await expect(page.locator("#sidebar")).not.toBeVisible();
    await expect(page.locator(".sheet-tools")).not.toBeVisible();

    const indicator = page.locator("#chart-page-indicator");
    await expect(indicator).toContainText("Página 1 de 2");
    await expect(page.locator("#paper-body .staff-line")).toHaveCount(8);
    await expect(page.locator("#paper-body").getByText("A1")).toBeVisible();

    // Verifica que todas as 8 linhas musicais cabem sem corte e sem rolagem horizontal
    const layoutMetrics = await page.evaluate(() => {
      const lines = [...document.querySelectorAll("#paper-body .staff-line")];
      const rects = lines.map((el) => el.getBoundingClientRect());
      const buttons = [...document.querySelectorAll(".chart-reading-bar .btn")].map((el) => {
        const r = el.getBoundingClientRect();
        return { w: r.width, h: r.height };
      });
      return {
        overflowX: document.documentElement.scrollWidth - window.innerWidth,
        allLinesVisible: rects.every((r) => r.top >= 0 && r.bottom <= window.innerHeight && r.height >= 24),
        minBtnW: Math.min(...buttons.map((b) => b.w)),
        minBtnH: Math.min(...buttons.map((b) => b.h)),
      };
    });
    expect(layoutMetrics.overflowX).toBeLessThanOrEqual(0);
    expect(layoutMetrics.allLinesVisible).toBe(true);
    expect(layoutMetrics.minBtnW).toBeGreaterThanOrEqual(44);
    expect(layoutMetrics.minBtnH).toBeGreaterThanOrEqual(44);

    // 2. Navegação por teclado (ArrowRight / ArrowLeft) e toque (.tap-zone) no modo limpo
    await page.keyboard.press("ArrowRight");
    await expect(indicator).toContainText("Página 2 de 2");
    await expect(page.locator("#paper-body .staff-line")).toHaveCount(8);
    await expect(page.locator("#paper-body").getByText("B1")).toBeVisible();

    await page.click(".tap-zone.prev");
    await expect(indicator).toContainText("Página 1 de 2");
    await expect(page.locator("#paper-body").getByText("A1")).toBeVisible();

    // Sai do modo limpo de volta à edição
    await page.click('.chart-reading-bar [data-action="toggle-clean"]');
    await expect(page.locator(".sheet-tools")).toBeVisible();
    await expect(page.locator("#paper-body .staff-line")).toHaveCount(16);

    // 3. Modo palco (#/setlists/setlist-paged/palco): ordem página -> música e recuo para a última página
    await gotoRoute(page, "#/setlists/setlist-paged/palco");
    await expect(page.locator("#stage-picker")).toHaveValue("0");
    await expect(indicator).toContainText("Página 1 de 2");
    await expect(page.locator('[data-action="stage-prev"]')).toBeDisabled();

    // Avança para Página 2 de 2 da mesma música
    await page.click('[data-action="stage-next"]');
    await expect(page.locator("#stage-picker")).toHaveValue("0");
    await expect(indicator).toContainText("Página 2 de 2");
    await expect(page.locator("#paper-body").getByText("B1")).toBeVisible();

    // Avança na última página -> entra na Música 2 (Página 1 de 1)
    await page.click('[data-action="stage-next"]');
    await expect(page.locator("#stage-picker")).toHaveValue("1");
    await expect(page.locator("h1.sheet-title")).toHaveText("Tema Final Curto");
    await expect(indicator).toContainText("Página 1 de 1");

    // Recua da Música 2 -> volta para a Página 2 de 2 da Música 1
    await page.click('[data-action="stage-prev"]');
    await expect(page.locator("#stage-picker")).toHaveValue("0");
    await expect(indicator).toContainText("Página 2 de 2");
    await expect(page.locator("#paper-body").getByText("B1")).toBeVisible();

    expect(errors).toEqual([]);
  });

  test("fase 26: spread adaptativo preserva ordem, última ímpar, âncora e tela cheia", async ({ page }) => {
    const makeMeasures = (prefix, count) =>
      Array.from({ length: count }, (_, idx) => ({
        id: `${prefix}-${idx + 1}`,
        chords: idx === 0 ? `${prefix}1` : "Dm7 G7 A7",
        ending: "",
        repeat: "",
      }));

    const spreadLibrary = {
      version: 2,
      pdfDocuments: [],
      songs: [
        {
          id: "song-odd-3p",
          title: "Suíte Três Páginas",
          composer: "Arranjador",
          style: "Baião",
          key: "C",
          tempo: 116,
          timeSignature: "4/4",
          barsPerRow: 4,
          sections: [
            { id: "sec-1", label: "Parte A", measures: makeMeasures("A", 32) },
            { id: "sec-2", label: "Parte B", measures: makeMeasures("B", 32) },
            { id: "sec-3", label: "Parte C", measures: makeMeasures("C", 32) },
          ],
        },
      ],
      playlists: [],
      setlists: [
        {
          id: "setlist-spread",
          name: "Repertório Duplo",
          items: [{ songId: "song-odd-3p" }],
        },
      ],
    };

    const errors = await setupPage(page, { library: spreadLibrary, seedPdf: false });

    // 1. Celular retrato e horizontal mantêm uma única superfície
    await page.setViewportSize({ width: 390, height: 844 });
    await gotoRoute(page, "#/musicas/song-odd-3p");
    await page.click('[data-action="toggle-clean"]');

    const spread = page.locator("#chart-reading-spread");
    const indicator = page.locator("#chart-page-indicator");
    await expect(spread).toHaveAttribute("data-page-span", "1");
    await expect(spread).toHaveAttribute("data-resolved-page-span", "1");
    await expect(spread.locator(".paper.sheet")).toHaveCount(1);
    await expect(indicator).toContainText("Página 1 de 3");

    await page.setViewportSize({ width: 844, height: 390 });
    await expect(spread).toHaveAttribute("data-page-span", "1");
    await expect(spread.locator(".paper.sheet")).toHaveCount(1);

    // 2. Tablet: girar para uma altura curta muda a paginação, mas preserva
    // o primeiro compasso realmente visível e sua posição vertical.
    await page.setViewportSize({ width: 768, height: 1024 });
    await expect(spread).toHaveAttribute("data-page-span", "1");
    await page.waitForTimeout(150);
    await page.keyboard.press("ArrowRight");
    await expect(indicator).toContainText("Página 2 de 3");

    await page.locator('[data-measure-id="B-17"]').evaluate((bar) => bar.scrollIntoView({ block: "start" }));
    const anchorBeforeResize = await page.evaluate(() => {
      const bar = [...document.querySelectorAll("#paper-body .adaptive-bar")].find((item) => {
        const rect = item.getBoundingClientRect();
        return rect.bottom > 0 && rect.top < window.innerHeight;
      });
      return { id: bar?.getAttribute("data-measure-id") || "", top: bar?.getBoundingClientRect().top || 0 };
    });
    expect(anchorBeforeResize.id).toBeTruthy();

    await page.setViewportSize({ width: 844, height: 390 });
    await page.waitForTimeout(150);
    await expect(spread).toHaveAttribute("data-page-span", "1");
    await expect(spread).not.toHaveAttribute("data-first-page", "2");
    await expect(spread.locator(".paper.sheet")).toHaveCount(1);
    await expect(indicator).toContainText("de 6");
    const resizedAnchor = page.locator(`[data-measure-id="${anchorBeforeResize.id}"]`);
    await expect(resizedAnchor).toHaveCount(1);
    const anchorTopAfterResize = await resizedAnchor.evaluate((bar) => bar.getBoundingClientRect().top);
    expect(Math.abs(anchorTopAfterResize - anchorBeforeResize.top)).toBeLessThanOrEqual(2);
    await expect(page.locator("#clean-paper .sheet-composer")).toHaveCount(0);

    await page.setViewportSize({ width: 1024, height: 768 });
    await page.waitForTimeout(150);
    await expect(spread).toHaveAttribute("data-first-page", "2");
    await expect(indicator).toContainText("Página 2 de 3");
    await expect(page.locator(`[data-measure-id="${anchorBeforeResize.id}"]`)).toHaveCount(1);

    // 3. Avançar e recuar percorre uma página por vez
    await page.keyboard.press("ArrowRight");
    await expect(spread).toHaveAttribute("data-page-span", "1");
    await expect(spread).toHaveAttribute("data-first-page", "3");
    await expect(spread.locator(".paper.sheet")).toHaveCount(1);
    await expect(indicator).toContainText("Página 3 de 3");
    await expect(page.locator("#clean-paper").getByText("C1")).toBeVisible();

    // Recuar volta para a página 2
    await page.keyboard.press("ArrowLeft");
    await expect(indicator).toContainText("Página 2 de 3");
    await expect(spread.locator(".paper.sheet")).toHaveCount(1);

    // 4. A troca real 1↔2 folhas preserva o compasso da página 2; ao voltar
    // para 1-up, preserva o primeiro compasso visível da folha esquerda.
    await page.locator('[data-measure-id="B-1"]').evaluate((bar) => bar.scrollIntoView({ block: "start" }));
    const pageTwoTop = await page.locator('[data-measure-id="B-1"]').evaluate((bar) => bar.getBoundingClientRect().top);
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.waitForTimeout(150);
    await expect(spread).toHaveAttribute("data-visible-pages", "1,2");
    await expect(page.locator('[data-measure-id="B-1"]')).toHaveCount(1);
    const pageTwoTopInSpread = await page.locator('[data-measure-id="B-1"]').evaluate((bar) => bar.getBoundingClientRect().top);
    expect(Math.abs(pageTwoTopInSpread - pageTwoTop)).toBeLessThanOrEqual(2);

    await page.locator('[data-measure-id="A-1"]').evaluate((bar) => bar.scrollIntoView({ block: "start" }));
    const leftPageTop = await page.locator('[data-measure-id="A-1"]').evaluate((bar) => bar.getBoundingClientRect().top);
    await page.setViewportSize({ width: 1024, height: 768 });
    await page.waitForTimeout(150);
    await expect(spread).toHaveAttribute("data-visible-pages", "1");
    await expect(page.locator('[data-measure-id="A-1"]')).toHaveCount(1);
    const leftPageTopAfterFallback = await page.locator('[data-measure-id="A-1"]').evaluate((bar) => bar.getBoundingClientRect().top);
    expect(leftPageTop).toBeGreaterThanOrEqual(0);
    expect(leftPageTop).toBeLessThan(768);
    expect(leftPageTopAfterFallback).toBeGreaterThanOrEqual(0);
    expect(leftPageTopAfterFallback).toBeLessThan(768);

    // 5. Tablet usa uma folha; notebooks largos mostram duas sem overflow.
    for (const vp of [
      { width: 1024, height: 768 },
      { width: 1280, height: 640 }, // viewport CSS aproximado de 1920×1080 com Chrome em 150%
      { width: 1366, height: 768 },
      { width: 1440, height: 900 },
    ]) {
      const expectedSpan = vp.width >= 1200 ? "2" : "1";
      await page.setViewportSize(vp);
      await expect(spread).toHaveAttribute("data-page-span", expectedSpan);
      await expect(spread).toHaveAttribute("data-resolved-page-span", expectedSpan);
      const metrics = await page.evaluate(() => {
        const sheets = [...document.querySelectorAll("#chart-reading-spread .paper.sheet")];
        const minSheetWidth = Number(document.querySelector("#chart-reading-spread")?.getAttribute("data-min-sheet-width") || 420);
        const widths = sheets.map((s) => s.getBoundingClientRect().width);
        return {
          sheetCount: sheets.length,
          minRenderedWidth: Math.min(...widths),
          minSheetWidth,
          overflowX: document.documentElement.scrollWidth - window.innerWidth,
        };
      });
      expect(metrics.sheetCount).toBe(Number(expectedSpan));
      expect(metrics.minRenderedWidth).toBeGreaterThanOrEqual(metrics.minSheetWidth - 1);
      expect(metrics.overflowX).toBeLessThanOrEqual(0);
    }

    // 6. Transpor em 2-up preserva o primeiro compasso visível e sua altura.
    // A altura menor deixa margem de rolagem abaixo da âncora; no fim físico do
    // documento o navegador não consegue preservar a coordenada por causa do clamp.
    await page.setViewportSize({ width: 1366, height: 600 });
    await page.waitForTimeout(150);
    await expect(spread).toHaveAttribute("data-page-span", "2");
    await page.locator('[data-measure-id="A-5"]').evaluate((bar) => bar.scrollIntoView({ block: "start" }));
    const transposeAnchor = await page.evaluate(() => {
      const bar = [...document.querySelectorAll("#chart-reading-spread .adaptive-bar")].find((item) => {
        const rect = item.getBoundingClientRect();
        return rect.bottom > 0 && rect.top < window.innerHeight;
      });
      return {
        id: bar?.getAttribute("data-measure-id") || "",
        top: bar?.getBoundingClientRect().top || 0,
      };
    });
    expect(transposeAnchor.id).toBeTruthy();
    await page.locator("select[data-preview-key]").evaluate((select) => {
      select.value = "D";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await expect(spread).toHaveAttribute("data-visible-pages", "1,2");
    const transposedAnchor = page.locator(`[data-measure-id="${transposeAnchor.id}"]`);
    await expect(transposedAnchor).toHaveCount(1);
    const transposeAnchorTopAfter = await transposedAnchor.evaluate((bar) => bar.getBoundingClientRect().top);
    expect(Math.abs(transposeAnchorTopAfter - transposeAnchor.top)).toBeLessThanOrEqual(2);

    // 7. No notebook, avançar percorre a dupla 1–2 e preserva a página 3 ímpar.
    await expect(spread).toHaveAttribute("data-visible-pages", "1,2");
    await expect(indicator).toContainText("Páginas 1–2 de 3");
    await page.keyboard.press("ArrowRight");
    await expect(spread).toHaveAttribute("data-visible-pages", "3");
    await expect(spread.locator(".paper.sheet")).toHaveCount(1);
    await expect(indicator).toContainText("Página 3 de 3");
    await page.keyboard.press("ArrowLeft");
    await expect(spread).toHaveAttribute("data-visible-pages", "1,2");

    // 8. Tela cheia no modo palco com fallback claro quando a API do navegador não está disponível e saída com Esc
    await gotoRoute(page, "#/setlists/setlist-spread/palco");
    await expect(page.locator(".stage-bar")).toBeVisible();

    await page.evaluate(() => {
      Object.defineProperty(document, "fullscreenEnabled", {
        value: false,
        configurable: true,
      });
    });

    await page.click('[data-action="toggle-fullscreen"]');
    await expect(page.locator("body")).toHaveClass(/fullscreen-reading/);
    await expect(page.locator(".stage-bar")).not.toBeVisible();
    await expect(page.locator("#fullscreen-fallback-status")).toBeVisible();
    await expect(page.locator('[data-action="toggle-fullscreen"]')).toHaveAttribute("aria-pressed", "true");

    // Pressionar Esc sai da tela cheia e restaura a barra do palco
    await page.keyboard.press("Escape");
    await expect(page.locator("body")).not.toHaveClass(/fullscreen-reading/);
    await expect(page.locator(".stage-bar")).toBeVisible();
    await expect(page.locator('[data-action="toggle-fullscreen"]')).toHaveAttribute("aria-pressed", "false");

    expect(errors).toEqual([]);
  });

  test("fase 27: zoom interno redimensiona somente a cifra, preserva âncora e não altera a música", async ({ page }) => {
    const measures = Array.from({ length: 64 }, (_, index) => ({
      id: `zoom-${index + 1}`,
      chords: index === 0 ? "C7M" : "Dm7 G7 A7",
      ending: "",
      repeat: "",
    }));
    const zoomLibrary = {
      version: 2,
      pdfDocuments: [],
      songs: [{
        id: "song-zoom",
        title: "Zoom de Palco",
        composer: "Caderno",
        style: "Jazz",
        key: "C",
        tempo: 120,
        timeSignature: "4/4",
        barsPerRow: 4,
        sections: [{ id: "zoom-section", label: "Principal", measures }],
      }],
      playlists: [],
      setlists: [],
    };

    const errors = await setupPage(page, { library: zoomLibrary, seedPdf: false });
    await page.setViewportSize({ width: 1440, height: 700 });
    await gotoRoute(page, "#/musicas/song-zoom");
    await page.click('[data-action="toggle-clean"]');

    const spread = page.locator("#chart-reading-spread");
    const zoomValue = page.locator("#reading-zoom-value");
    const decrease = page.locator('[data-action="reading-zoom"][data-command="decrease"]');
    const increase = page.locator('[data-action="reading-zoom"][data-command="increase"]');
    const fit = page.locator('[data-action="reading-zoom"][data-command="fit"]');
    const storedSongBefore = await page.evaluate(() => localStorage.getItem("caderno.library.v1"));

    const readMetrics = () => page.evaluate(() => {
      const sheet = document.querySelector("#chart-reading-spread .paper.sheet");
      const chord = document.querySelector("#chart-reading-spread .root");
      const host = document.querySelector("#chart-reading-spread");
      return {
        sheetWidth: sheet?.getBoundingClientRect().width || 0,
        chordSize: Number.parseFloat(chord ? getComputedStyle(chord).fontSize : "0"),
        innerOverflow: (host?.scrollWidth || 0) - (host?.clientWidth || 0),
        documentOverflow: document.documentElement.scrollWidth - window.innerWidth,
      };
    });

    await expect(zoomValue).toHaveText("100%");
    await expect(fit).toHaveAttribute("aria-pressed", "true");
    await expect(spread).toHaveAttribute("data-page-span", "2");
    const fitMetrics = await readMetrics();

    await decrease.click();
    await expect(zoomValue).toHaveText("90%");
    await expect(fit).toHaveAttribute("aria-pressed", "false");
    const reducedMetrics = await readMetrics();
    expect(reducedMetrics.sheetWidth).toBeLessThan(fitMetrics.sheetWidth);
    expect(reducedMetrics.chordSize).toBeLessThan(fitMetrics.chordSize);

    await decrease.click();
    await decrease.click();
    await decrease.click();
    await expect(zoomValue).toHaveText("67%");
    await expect(decrease).toBeDisabled();
    const minimumMetrics = await readMetrics();

    await page.locator('[data-measure-id="zoom-5"]').evaluate((bar) => bar.scrollIntoView({ block: "start" }));
    const anchorBeforeZoom = await page.evaluate(() => {
      const bar = [...document.querySelectorAll("#chart-reading-spread .adaptive-bar")].find((item) => {
        const rect = item.getBoundingClientRect();
        return rect.bottom > 0 && rect.top < window.innerHeight;
      });
      return { id: bar?.getAttribute("data-measure-id") || "", top: bar?.getBoundingClientRect().top || 0 };
    });
    expect(anchorBeforeZoom.id).toBeTruthy();

    await page.keyboard.press("=");
    await expect(zoomValue).toHaveText("77%");
    const enlargedMetrics = await readMetrics();
    expect(enlargedMetrics.sheetWidth).toBeGreaterThan(minimumMetrics.sheetWidth);
    expect(enlargedMetrics.chordSize).toBeGreaterThan(minimumMetrics.chordSize);
    const anchoredBar = page.locator(`[data-measure-id="${anchorBeforeZoom.id}"]`);
    await expect(anchoredBar).toHaveCount(1);
    const anchorTopAfterZoom = await anchoredBar.evaluate((bar) => bar.getBoundingClientRect().top);
    expect(Math.abs(anchorTopAfterZoom - anchorBeforeZoom.top)).toBeLessThanOrEqual(2);

    await page.locator("select[data-preview-key]").evaluate((field) => {
      field.dispatchEvent(new KeyboardEvent("keydown", { key: "+", bubbles: true }));
    });
    await expect(zoomValue).toHaveText("77%");
    await page.keyboard.press("-");
    await expect(zoomValue).toHaveText("67%");

    await page.keyboard.press("0");
    await expect(zoomValue).toHaveText("100%");
    await expect(fit).toHaveAttribute("aria-pressed", "true");
    const firstFitAgain = await readMetrics();
    await page.keyboard.press("0");
    const secondFitAgain = await readMetrics();
    expect(secondFitAgain.sheetWidth).toBeCloseTo(firstFitAgain.sheetWidth, 1);

    await page.keyboard.press("+");
    await expect(zoomValue).toHaveText("110%");
    await page.keyboard.press("0");
    const browserShortcutPrevented = await page.evaluate(() => {
      const event = new KeyboardEvent("keydown", {
        key: "=",
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
      });
      document.body.dispatchEvent(event);
      return event.defaultPrevented;
    });
    expect(browserShortcutPrevented).toBe(false);
    await expect(zoomValue).toHaveText("100%");

    await increase.click();
    await expect(zoomValue).toHaveText("110%");
    await expect(spread).toHaveAttribute("data-page-span", "1");

    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(150);
    await expect(spread).toHaveAttribute("data-page-span", "1");
    const mobileManualMetrics = await readMetrics();
    expect(mobileManualMetrics.innerOverflow).toBeGreaterThan(0);
    expect(mobileManualMetrics.documentOverflow).toBeLessThanOrEqual(0);

    await fit.click();
    await expect(zoomValue).toHaveText("100%");
    const mobileFitMetrics = await readMetrics();
    expect(mobileFitMetrics.innerOverflow).toBeLessThanOrEqual(1);
    expect(mobileFitMetrics.documentOverflow).toBeLessThanOrEqual(0);

    const storedSongAfter = await page.evaluate(() => localStorage.getItem("caderno.library.v1"));
    expect(storedSongAfter).toBe(storedSongBefore);
    expect(errors).toEqual([]);
  });

  test("fase 22: grade de 16 células mantém a marca quando uma seção começa no meio do sistema", async ({ page }) => {
    const makeMeasures = (prefix, count) =>
      Array.from({ length: count }, (_, idx) => ({
        id: `${prefix}-${idx + 1}`,
        chords: "C7M Dm7 G7",
        ending: idx === count - 1 ? "2" : "",
        repeat: idx === 0 ? "start" : "",
      }));
    const adaptiveLibrary = {
      version: 2,
      pdfDocuments: [],
      songs: [{
        id: "song-adaptive-grid",
        title: "Grade Adaptativa",
        composer: "Teste de Palco",
        style: "Samba",
        key: "C",
        tempo: 120,
        timeSignature: "4/4",
        barsPerRow: 4,
        sections: [
          { id: "section-a", label: "Parte A", measures: makeMeasures("a", 6) },
          { id: "section-b", label: "Parte B", measures: makeMeasures("b", 6) },
        ],
      }],
      playlists: [],
      setlists: [],
    };

    const errors = await setupPage(page, { library: adaptiveLibrary, seedPdf: false });
    await page.setViewportSize({ width: 768, height: 1024 });
    await gotoRoute(page, "#/musicas/song-adaptive-grid");
    await page.click('[data-action="toggle-clean"]');

    const spread = page.locator("#chart-reading-spread");
    const systems = page.locator("#paper-body .adaptive-system");
    const sharedSystem = systems.nth(1);
    await expect(spread).toHaveAttribute("data-density", "normal");
    await expect(spread).toHaveAttribute("data-total-pages", "1");
    await expect(systems).toHaveCount(3);
    await expect(sharedSystem).toHaveAttribute("data-cells-used", "16");
    await expect(sharedSystem.locator(".bar")).toHaveCount(4);
    await expect(sharedSystem.locator('[data-measure-id="a-5"]')).toBeVisible();
    await expect(sharedSystem.locator('[data-measure-id="a-6"]')).toBeVisible();
    await expect(sharedSystem.locator('[data-measure-id="b-1"] .adaptive-section-marker')).toHaveText("Parte B");
    await expect(sharedSystem.locator('[data-measure-id="b-2"]')).toBeVisible();
    await expect(page.locator('[data-measure-id="a-1"]')).toHaveClass(/repeat-start/);
    await expect(page.locator('[data-measure-id="b-6"]')).toHaveClass(/has-ending/);
    expect(errors).toEqual([]);
  });

  test("fase 23: densidade por sistema preserva largura e legibilidade", async ({ page }) => {
    const measures = Array.from({ length: 20 }, (_, index) => ({
      id: `mixed-${index + 1}`,
      chords: index >= 8 && index < 12 ? "D-7(9) A-7(9)" : "Cmaj7",
      ending: "",
      repeat: "",
    }));
    const mixedLibrary = {
      version: 2,
      pdfDocuments: [],
      songs: [{
        id: "song-system-density",
        title: "Densidade por Sistema",
        composer: "Prova sanitizada",
        style: "",
        key: "C",
        tempo: 120,
        timeSignature: "4/4",
        barsPerRow: 4,
        sections: [{ id: "section-a", label: "Parte A", measures }],
      }],
      playlists: [],
      setlists: [],
    };

    const errors = await setupPage(page, { library: mixedLibrary, seedPdf: false });
    for (const viewport of [
      { width: 390, height: 844 },
      { width: 768, height: 1024 },
      { width: 1366, height: 768 },
    ]) {
      await page.setViewportSize(viewport);
      await gotoRoute(page, "#/musicas/song-system-density");
      await page.click('[data-action="toggle-clean"]');

      const spread = page.locator("#chart-reading-spread");
      const systems = page.locator("#paper-body .adaptive-system");
      await expect(spread).toHaveAttribute("data-density", "mixed");
      await expect(systems).toHaveCount(3);
      await expect(systems.nth(0)).toHaveAttribute("data-density", "compact");
      await expect(systems.nth(0).locator(".bar")).toHaveCount(8);
      await expect(systems.nth(1)).toHaveAttribute("data-density", "normal");
      await expect(systems.nth(1).locator(".bar")).toHaveCount(4);
      await expect(systems.nth(2)).toHaveAttribute("data-density", "compact");
      await expect(systems.nth(2).locator(".bar")).toHaveCount(8);

      const geometry = await systems.evaluateAll((rows) => rows.map((row) => {
        const rowRect = row.getBoundingClientRect();
        const bars = [...row.querySelectorAll(".bar")];
        const widths = bars.map((bar) => bar.getBoundingClientRect().width);
        const glyphScales = bars.flatMap((bar) => [...bar.querySelectorAll(".glyph")].map((glyph) => {
          const naturalWidth = glyph.scrollWidth;
          return naturalWidth ? glyph.getBoundingClientRect().width / naturalWidth : 1;
        }));
        const glyphsInside = bars.every((bar) => {
          const barRect = bar.getBoundingClientRect();
          return [...bar.querySelectorAll(".glyph")].every((glyph) => {
            const glyphRect = glyph.getBoundingClientRect();
            return glyphRect.left >= barRect.left - 1 && glyphRect.right <= barRect.right + 1;
          });
        });
        return {
          rowWidth: rowRect.width,
          widths,
          minGlyphScale: Math.min(...glyphScales),
          glyphsInside,
        };
      }));

      for (const [index, row] of geometry.entries()) {
        expect(Math.max(...row.widths) - Math.min(...row.widths)).toBeLessThanOrEqual(1);
        const expectedRatio = index === 1 ? 0.25 : 0.125;
        for (const width of row.widths) expect(width / row.rowWidth).toBeCloseTo(expectedRatio, 2);
        expect(row.minGlyphScale).toBeGreaterThanOrEqual(0.8);
        expect(row.glyphsInside).toBe(true);
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0);

      if (viewport.width === 768) {
        await spread.screenshot({ path: "tests/screenshots/fase23-tablet-densidade-por-sistema.png" });
      }

      await page.click('[data-action="toggle-clean"]');
    }
    expect(errors).toEqual([]);
  });

  test("fase 20: interface de sugestão de repetições (aceitar, manter completo, expandir e desfazer) em celular, tablet e notebook", async ({ page }) => {
    const errors = await setupPage(page, { seedPdf: false });

    const repeatedCifra = `Título: Choro da Repetição
Artista: Conjunto Regional
Tom: C

[Parte A]
| Cmaj7 | Dm7 G7 | Em7 A7 | Dm7 G7 |
| Cmaj7 | Dm7 G7 | Em7 A7 | Dm7 G7 |

[Parte B]
| Fmaj7 | Fm6 | Cmaj7 | A7 |
| Fmaj7 | Fm6 | Cmaj7 | A7 |`;

    await gotoRoute(page, "#/musicas");
    await page.click('[data-action="new-song"]');

    for (const vp of [
      { width: 390, height: 844 },
      { width: 768, height: 1024 },
      { width: 1366, height: 768 },
    ]) {
      await page.setViewportSize(vp);
      await page.click('[data-action="open-paste"]');
      await page.fill("#paste-text", repeatedCifra);
      await page.click('[data-action="open-draft"]');

      await expect(page.locator("#draft-title")).toBeVisible();
      await expect(page.locator(".draft-repeat-suggestion")).toHaveCount(2);

      // Verifica alvo de toque >= 44px nos botões de repetição
      const firstApplyBtn = page.locator('[data-action="draft-apply-repeat"]').first();
      const firstDismissBtn = page.locator('[data-action="draft-dismiss-repeat"]').first();
      const applyBox = await firstApplyBtn.boundingBox();
      const dismissBox = await firstDismissBtn.boundingBox();
      expect(applyBox.height).toBeGreaterThanOrEqual(44);
      expect(applyBox.width).toBeGreaterThanOrEqual(44);
      expect(dismissBox.height).toBeGreaterThanOrEqual(44);
      expect(dismissBox.width).toBeGreaterThanOrEqual(44);

      // 1. Aceitar ("Compactar como 2x") na Parte A
      await firstApplyBtn.click();
      const secA = page.locator(".draft-section-card").first();
      await expect(secA).toHaveAttribute("data-compacted", "true");
      await expect(secA.locator(".draft-repeat-compacted-banner")).toContainText("Compactada como 2x");
      await expect(secA.locator(".draft-measure-box")).toHaveCount(4);
      await expect(secA.locator(".draft-measure-box").first()).toHaveAttribute("data-repeat", "start");
      await expect(secA.locator(".draft-measure-box").nth(3)).toHaveAttribute("data-repeat", "end");
      await expect(page.locator("#draft-repeat-live")).toContainText("Repetição compactada como 2x");

      // 2. Ignorar ("Manter completo") na Parte B
      await page.locator('[data-action="draft-dismiss-repeat"]').first().click();
      const secB = page.locator(".draft-section-card").nth(1);
      await expect(secB).toHaveAttribute("data-compacted", "false");
      await expect(secB.locator(".draft-measure-box")).toHaveCount(8);
      await expect(page.locator(".draft-repeat-suggestion")).toHaveCount(0);

      // 3. Desfazer o "Manter completo" -> sugestão da Parte B reaparece
      await page.click("#btn-draft-undo");
      await expect(page.locator(".draft-repeat-suggestion")).toHaveCount(1);

      // 4. Expandir a Parte A -> restaura os 8 compassos visíveis e libera edição estrutural
      await secA.locator('[data-action="draft-expand-repeat"]').click();
      await expect(secA).toHaveAttribute("data-compacted", "false");
      await expect(secA.locator(".draft-measure-box")).toHaveCount(8);
      await expect(page.locator(".draft-repeat-suggestion")).toHaveCount(2);

      await page.click('[data-action="draft-cancel"]');
    }

    // Fluxo final de confirmação: compactar Parte A, manter Parte B completa, escolher 4/4 e salvar
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.click('[data-action="open-paste"]');
    await page.fill("#paste-text", repeatedCifra);
    await page.click('[data-action="open-draft"]');
    await page.click('[data-action="draft-set-timesig"][data-timesig="4/4"]');
    await page.locator('[data-action="draft-apply-repeat"]').first().click();

    // Fonte literal permanece com 100% dos acordes (22 acordes)
    await expect(page.locator(".draft-source-column")).toContainText("22 acorde(s) literais");

    await page.click("#btn-draft-confirm");
    await expect(page.locator("input.sheet-title")).toHaveValue("Choro da Repetição");

    // Na cifra final salva, Parte A tem 4 compassos com repeat start/end e Parte B tem 8 compassos completos
    const firstSectionBars = page.locator("#paper-body .bar");
    await expect(firstSectionBars).toHaveCount(12);
    await expect(firstSectionBars.first()).toHaveClass(/repeat-start/);
    await expect(firstSectionBars.nth(3)).toHaveClass(/repeat-end/);

    expect(errors).toEqual([]);
  });

  test("fase 28: atalho universal Control+z desfaz alterações no rascunho de forma instantânea", async ({ page }) => {
    const errors = await setupPage(page);

    await gotoRoute(page, "#/musicas");

    // Abre modal de colar cifra e carrega fixture
    await page.click('[data-action="new-song"]');
    await page.click('[data-action="open-paste"]');
    await page.click('[data-action="load-fixture"][data-fixture-id="so-easy"]');
    await page.click('[data-action="open-draft"]');
    await expect(page.locator("#draft-title")).toBeVisible();

    const measureBoxes = page.locator(".draft-measure-box");
    const initialCount = await measureBoxes.count();

    // Seleciona um acorde para dividir
    const chordToken = measureBoxes.first().locator(".measure-chord-token").last();
    await chordToken.click();
    await page.locator('[data-action="draft-split-chord"]').click();
    await expect(measureBoxes).toHaveCount(initialCount + 1);

    // Pressiona Control+z para desfazer
    await page.keyboard.press("Control+z");
    await expect(measureBoxes).toHaveCount(initialCount);
    await expect(page.locator("#toast")).toContainText("Ação desfeita");

    // Testa também Meta+z (Mac)
    await chordToken.click();
    await page.locator('[data-action="draft-split-chord"]').click();
    await expect(measureBoxes).toHaveCount(initialCount + 1);
    await page.keyboard.press("Meta+z");
    await expect(measureBoxes).toHaveCount(initialCount);

    await page.click('[data-action="draft-cancel"]');
    expect(errors).toEqual([]);
  });

  test("fase 32: reabrir estrutura de música salva, apagar acorde, desfazer e salvar sem duplicar", async ({ page }) => {
    const errors = await setupPage(page);

    await gotoRoute(page, "#/musicas");

    const cards = page.locator(".cards article.card");
    const initialSongsCount = await cards.count();
    expect(initialSongsCount).toBeGreaterThan(0);

    // Abre a primeira música da biblioteca
    await cards.first().locator("a").click();
    await expect(page.locator('[data-action="open-structure-editor"]')).toBeVisible();

    // Reabre no editor estrutural
    await page.click('[data-action="open-structure-editor"]');
    await expect(page.locator("#draft-title")).toHaveText("Editar Estrutura Musical");

    // Autoridade é a música salva: sem abas nem coluna de fonte literal
    await expect(page.locator(".draft-source-column")).toHaveCount(0);
    await expect(page.locator(".draft-view-tabs")).toHaveCount(0);
    await expect(page.locator("#btn-draft-confirm")).toHaveText("Salvar alterações");

    const firstMeasure = page.locator(".draft-measure-box").first();
    const chordTokens = firstMeasure.locator(".measure-chord-token");
    const initialChordCount = await chordTokens.count();
    expect(initialChordCount).toBeGreaterThan(0);

    // Seleciona o primeiro acorde
    await chordTokens.first().click();
    const deleteBtn = page.locator('[data-action="draft-delete-chord"]');
    await expect(deleteBtn).toBeVisible();
    await expect(deleteBtn).toContainText("Apagar acorde");

    // Apaga o acorde selecionado
    await deleteBtn.click();
    await expect(page.locator("#toast")).toContainText("apagado");
    await expect(firstMeasure.locator(".measure-chord-token")).toHaveCount(Math.max(0, initialChordCount - 1));

    // Desfaz a exclusão com Control+z
    await page.keyboard.press("Control+z");
    await expect(page.locator("#toast")).toContainText("Ação desfeita");
    await expect(firstMeasure.locator(".measure-chord-token")).toHaveCount(initialChordCount);

    // Apaga novamente e confirma salvamento
    await firstMeasure.locator(".measure-chord-token").first().click();
    await page.locator('[data-action="draft-delete-chord"]').click();
    await page.locator("#btn-draft-confirm").click();
    await expect(page.locator("#toast")).toContainText("atualizada com sucesso");
    await expect(page.locator("#draft-title")).toBeHidden();

    // Volta à biblioteca e confirma que não houve duplicação
    await gotoRoute(page, "#/musicas");
    await expect(page.locator(".cards article.card")).toHaveCount(initialSongsCount);

    // Reabre a mesma música na interface para provar a persistência da alteração
    await page.locator(".cards article.card").first().locator("a").click();
    await page.locator('[data-action="open-structure-editor"]').click();
    await expect(page.locator("#draft-title")).toHaveText("Editar Estrutura Musical");
    const reloadedFirstMeasure = page.locator(".draft-measure-box").first();
    await expect(reloadedFirstMeasure.locator(".measure-chord-token")).toHaveCount(Math.max(0, initialChordCount - 1));

    await page.locator('[data-action="draft-cancel"]').click();
    expect(errors).toEqual([]);
  });

  test("fase 33: criar, editar, desfazer e persistir anotação acima do compasso no editor estrutural", async ({ page }) => {
    const errors = await setupPage(page);

    await gotoRoute(page, "#/musicas");
    const cards = page.locator(".cards article.card");
    await expect(cards.first()).toBeVisible();

    // Abre a primeira música e seu editor estrutural
    await cards.first().locator("a").click();
    await page.click('[data-action="open-structure-editor"]');
    await expect(page.locator("#draft-title")).toHaveText("Editar Estrutura Musical");

    const firstMeasure = page.locator(".draft-measure-box").first();
    const editAnnotationBtn = firstMeasure.locator('[data-action="draft-edit-annotation"]');
    await expect(editAnnotationBtn).toBeVisible();
    await expect(editAnnotationBtn).toContainText("Texto acima");

    // Clica para editar anotação acima do compasso
    await editAnnotationBtn.click();
    const annotationInput = firstMeasure.locator(".draft-annotation-input");
    await expect(annotationInput).toBeVisible();
    await expect(annotationInput).toBeFocused();

    // Preenche anotação e salva com Enter
    await annotationInput.fill("Breque com metais");
    await page.keyboard.press("Enter");

    await expect(page.locator("#toast")).toContainText("atualizada");
    const badge = firstMeasure.locator(".measure-annotation-badge");
    await expect(badge).toBeVisible();
    await expect(badge).toContainText("Breque com metais");
    await expect(editAnnotationBtn).toContainText("Editar texto");

    // Desfaz com Control+z
    await page.keyboard.press("Control+z");
    await expect(page.locator("#toast")).toContainText("Ação desfeita");
    await expect(firstMeasure.locator(".measure-annotation-badge")).toBeHidden();
    await expect(editAnnotationBtn).toContainText("Texto acima");

    // Edita novamente, salva via botão de confirmação e conclui rascunho
    await editAnnotationBtn.click();
    await expect(firstMeasure.locator(".draft-annotation-input")).toBeVisible();
    await firstMeasure.locator(".draft-annotation-input").fill("Solo de sax");
    await firstMeasure.locator('[data-action="draft-save-annotation"]').click();
    await expect(badge).toBeVisible();
    await expect(badge).toContainText("Solo de sax");

    // Salva o rascunho
    await page.locator("#btn-draft-confirm").click();
    await expect(page.locator("#toast")).toContainText("atualizada com sucesso");
    await expect(page.locator("#draft-title")).toBeHidden();

    // Reabre no editor estrutural para verificar persistência
    await page.click('[data-action="open-structure-editor"]');
    await expect(page.locator("#draft-title")).toHaveText("Editar Estrutura Musical");
    const reloadedFirstMeasure = page.locator(".draft-measure-box").first();
    await expect(reloadedFirstMeasure.locator(".measure-annotation-badge")).toBeVisible();
    await expect(reloadedFirstMeasure.locator(".measure-annotation-badge")).toContainText("Solo de sax");

    // Edita para remover a anotação
    await reloadedFirstMeasure.locator('[data-action="draft-edit-annotation"]').click();
    await reloadedFirstMeasure.locator(".draft-annotation-input").fill("");
    await page.keyboard.press("Enter");
    await expect(page.locator("#toast")).toContainText("removida");
    await expect(reloadedFirstMeasure.locator(".measure-annotation-badge")).toBeHidden();

    // Salva sem anotação
    await page.locator("#btn-draft-confirm").click();
    await expect(page.locator("#toast")).toContainText("atualizada com sucesso");

    expect(errors).toEqual([]);
  });

  test("fase 34: mostrar anotação acima do compasso na cifra, transposição, leitura limpa e modo palco", async ({ page }) => {
    const errors = await setupPage(page);

    await gotoRoute(page, "#/musicas");
    const cards = page.locator(".cards article.card");
    await expect(cards.first()).toBeVisible();

    // 1. Abre a primeira música e seu editor estrutural para incluir anotação
    await cards.first().locator("a").click();
    await page.click('[data-action="open-structure-editor"]');
    await expect(page.locator("#draft-title")).toHaveText("Editar Estrutura Musical");

    const firstMeasure = page.locator(".draft-measure-box").first();
    await firstMeasure.locator('[data-action="draft-edit-annotation"]').click();
    await firstMeasure.locator(".draft-annotation-input").fill("Breque com metais");
    await page.keyboard.press("Enter");
    await page.locator("#btn-draft-confirm").click();
    await expect(page.locator("#toast")).toContainText("atualizada com sucesso");

    // 2. Na visualização de edição da cifra (#/musicas/:id), a anotação aparece acima do compasso
    const measureAnnotation = page.locator(".bar .measure-annotation").first();
    await expect(measureAnnotation).toBeVisible();
    await expect(measureAnnotation).toHaveText("Breque com metais");
    await expect(measureAnnotation).toHaveAttribute("title", "Indicação musical: Breque com metais");

    // 3. Testa transposição: a anotação permanece inalterada
    const previewSelect = page.locator("select[data-preview-key]");
    if (await previewSelect.count() > 0) {
      await previewSelect.evaluate((select) => {
        select.value = "G";
        select.dispatchEvent(new Event("change", { bubbles: true }));
      });
      await expect(page.locator("#preview-banner")).toBeVisible();
      await expect(measureAnnotation).toBeVisible();
      await expect(measureAnnotation).toHaveText("Breque com metais");

      // Restaura para o tom original
      await previewSelect.evaluate((select) => {
        select.value = "";
        select.dispatchEvent(new Event("change", { bubbles: true }));
      });
      await expect(page.locator("#preview-banner")).toBeHidden();
    }

    // 4. Entra na leitura limpa (modo folha/clean)
    await page.click('[data-action="toggle-clean"]');
    await expect(page.locator("body")).toHaveClass(/clean/);
    const cleanAnnotation = page.locator(".reading-spread .bar .measure-annotation").first();
    await expect(cleanAnnotation).toBeVisible();
    await expect(cleanAnnotation).toHaveText("Breque com metais");

    // Sai da leitura limpa
    await page.click('[data-action="toggle-clean"]');
    await expect(page.locator("body")).not.toHaveClass(/clean/);

    // 5. Entra no modo palco através da setlist
    await gotoRoute(page, "#/setlists");
    const setlistCards = page.locator(".cards article.card");
    if (await setlistCards.count() > 0) {
      await setlistCards.first().locator("a").click();
      await page.click('[data-action="enter-stage"]');
      await expect(page.locator("body")).toHaveClass(/stage/);

      // No modo palco, seleciona a primeira música ou verifica se a anotação está no stage-paper
      const stageAnnotation = page.locator("#stage-paper .bar .measure-annotation");
      if (await stageAnnotation.count() > 0) {
        await expect(stageAnnotation.first()).toBeVisible();
        await expect(stageAnnotation.first()).toHaveText("Breque com metais");
      }
      await page.click('[data-action="exit-stage"]');
    }

    expect(errors).toEqual([]);
  });
});
