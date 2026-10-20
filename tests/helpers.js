import { TEST_LIBRARY } from "./fixtures/library.js";
import { MINIMAL_PDF_BASE64 } from "./fixtures/pdf.js";

/**
 * Prepara a pagina com estado deterministico antes do carregamento da aplicacao.
 *
 * @param {import("@playwright/test").Page} page
 * @param {Object} [options]
 * @param {Object} [options.library]
 * @param {boolean} [options.seedPdf]
 * @param {Array<{ id: string, name: string, pageCount?: number, pages?: number, base64: string }>} [options.customPdfs]
 * @returns {Array<string>} lista de erros de console coletados
 */
export async function setupPage(page, { library = TEST_LIBRARY, seedPdf = true, customPdfs = null } = {}) {
  const consoleErrors = [];

  page.on("pageerror", (error) => {
    consoleErrors.push(`[pageerror] ${error.message}\n${error.stack || ""}`);
  });

  page.on("console", (message) => {
    if (message.type() === "error") {
      consoleErrors.push(`[console.error] ${message.text()}`);
    }
  });

  const libraryJson = JSON.stringify(library);
  const pdfBase64 = seedPdf ? MINIMAL_PDF_BASE64 : "";

  await page.addInitScript(({ libJson, pdfB64, pdfList }) => {
    localStorage.clear();
    localStorage.setItem("caderno.library.v1", libJson);

    const openReq = indexedDB.open("caderno-files", 1);
    openReq.onupgradeneeded = () => {
      openReq.result.createObjectStore("pdfs");
    };
    openReq.onsuccess = () => {
      const db = openReq.result;
      const tx = db.transaction("pdfs", "readwrite");
      const store = tx.objectStore("pdfs");

      if (pdfList && Array.isArray(pdfList)) {
        for (const item of pdfList) {
          const binary = atob(item.base64);
          const bytes = new Uint8Array(binary.length);
          for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
          store.put({
            name: item.name || "documento.pdf",
            pageCount: item.pageCount || item.pages || 1,
            pages: item.pageCount || item.pages || 1,
            buffer: bytes.buffer,
          }, item.id);
        }
      } else if (pdfB64) {
        const binary = atob(pdfB64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
        store.put({
          name: "wave.pdf",
          pages: 2,
          pageCount: 2,
          buffer: bytes.buffer,
        }, "song-pdf-test");
      }
    };
  }, { libJson: libraryJson, pdfB64: pdfBase64, pdfList: customPdfs });

  return consoleErrors;
}

/**
 * Consulta a quantidade de registros gravados no IndexedDB.
 *
 * @param {import("@playwright/test").Page} page
 * @returns {Promise<number>}
 */
export async function getStoredPdfCount(page) {
  return page.evaluate(async () => {
    return new Promise((resolve, reject) => {
      const openReq = indexedDB.open("caderno-files", 1);
      openReq.onsuccess = () => {
        const db = openReq.result;
        const tx = db.transaction("pdfs", "readonly");
        const countReq = tx.objectStore("pdfs").count();
        countReq.onsuccess = () => resolve(countReq.result);
        countReq.onerror = () => reject(countReq.error);
      };
      openReq.onerror = () => reject(openReq.error);
    });
  });
}

/**
 * Navega para uma rota e aguarda o carregamento do shell.
 *
 * @param {import("@playwright/test").Page} page
 * @param {string} route
 */
export async function gotoRoute(page, route = "#/musicas") {
  await page.goto(`/${route}`);
  await page.waitForSelector("#app");
}