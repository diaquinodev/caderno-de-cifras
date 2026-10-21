import { extractDomSnapshot } from "./dom-adapter.js";
import { extractCanonicalCifra } from "./extractor.js";
import { deliverToCaderno } from "./delivery.js";

/**
 * @typedef {import("./extractor.js").ClipperMetadata} ClipperMetadata
 * @typedef {import("./delivery.js").DeliveryReceipt} DeliveryReceipt
 */

/**
 * @typedef {Object} ClipperResultError
 * @property {string} code
 * @property {string} message
 */

/**
 * @typedef {{ ok: true, text: string, chordCount: number, metadata: ClipperMetadata, receipt: DeliveryReceipt } |
 *   { ok: false, error: ClipperResultError }} ClipperResult
 */

/**
 * Executes the DOM adapter on the active tab upon user click, converts
 * the snapshot into canonical Cifra text, copies it to the clipboard, and opens the Caderno.
 *
 * @param {{ id?: number } | null | undefined} tab
 * @param {any} [chromeApi]
 * @param {{ destination?: string }} [options]
 * @returns {Promise<ClipperResult>}
 */
export async function runClipperForTab(tab, chromeApi = /** @type {any} */ (globalThis).chrome, options = {}) {
  if (!tab || typeof tab.id !== "number") {
    return {
      ok: false,
      error: {
        code: "INVALID_TAB_CONTEXT",
        message: "Nenhuma aba ativa disponível para extração.",
      },
    };
  }

  if (!chromeApi?.scripting?.executeScript) {
    return {
      ok: false,
      error: {
        code: "SCRIPTING_UNAVAILABLE",
        message: "A permissão de execução na aba ativa não está disponível.",
      },
    };
  }

  let injectionResults;
  try {
    injectionResults = await chromeApi.scripting.executeScript({
      target: { tabId: tab.id },
      func: extractDomSnapshot,
    });
  } catch {
    return {
      ok: false,
      error: {
        code: "INJECTION_BLOCKED",
        message: "Não foi possível ler a aba ativa. Abra uma página pública de cifra e tente novamente.",
      },
    };
  }

  const domResult = injectionResults?.[0]?.result;
  if (!domResult || !domResult.ok) {
    return {
      ok: false,
      error: domResult?.error || {
        code: "DOM_STRUCTURE_CHANGED",
        message: "Não foi possível extrair a estrutura da cifra nesta aba.",
      },
    };
  }

  const extracted = extractCanonicalCifra(domResult.snapshot);
  if (!extracted.ok || !("text" in extracted)) {
    return {
      ok: false,
      error: {
        code: "error" in extracted ? extracted.error : "DOM_STRUCTURE_CHANGED",
        message: "message" in extracted ? extracted.message : "Falha ao extrair cifra.",
      },
    };
  }

  const delivery = await deliverToCaderno(
    {
      ok: true,
      text: extracted.text,
      chordCount: extracted.chordCount,
      metadata: domResult.snapshot.metadata,
    },
    tab,
    chromeApi,
    options,
  );

  if (!delivery.ok || !("receipt" in delivery)) {
    return {
      ok: false,
      error: "error" in delivery
        ? delivery.error
        : { code: "TAB_OPEN_FAILED", message: "Falha ao abrir o Caderno." },
    };
  }

  return {
    ok: true,
    text: extracted.text,
    chordCount: extracted.chordCount,
    metadata: domResult.snapshot.metadata,
    receipt: delivery.receipt,
  };
}

/**
 * Registers the click handler on `chrome.action.onClicked`.
 * Nothing runs automatically on page load; extraction only starts after user gesture.
 *
 * @param {any} [chromeApi]
 * @param {{ destination?: string }} [options]
 * @returns {((tab: { id?: number }) => Promise<ClipperResult>) | null}
 */
export function registerActionListener(chromeApi = /** @type {any} */ (globalThis).chrome, options = {}) {
  if (!chromeApi?.action?.onClicked?.addListener) return null;
  const listener = async (tab) => runClipperForTab(tab, chromeApi, options);
  chromeApi.action.onClicked.addListener(listener);
  return listener;
}

registerActionListener();
