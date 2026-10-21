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
});
