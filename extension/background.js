import { extractDomSnapshot } from "./dom-adapter.js";
import { extractCanonicalCifra } from "./extractor.js";
import { deliverToCaderno } from "./delivery.js";
import { applyActionFeedback, createClipperError } from "./errors.js";

/**
 * @typedef {import("./extractor.js").ClipperMetadata} ClipperMetadata
 * @typedef {import("./delivery.js").DeliveryReceipt} DeliveryReceipt
 * @typedef {import("./errors.js").ClipperError} ClipperError
 */

/**
 * @typedef {{ ok: true, text: string, chordCount: number, metadata: ClipperMetadata, receipt: DeliveryReceipt } |
 *   { ok: false, error: ClipperError }} ClipperResult
 */

/**
 * Executes the DOM adapter on the active tab upon user click, converts
 * the snapshot into canonical Cifra text, copies it to the clipboard, and opens the Caderno.
 * Never overwrites the clipboard on error and updates icon feedback idempotently.
 *
 * @param {{ id?: number } | null | undefined} tab
 * @param {any} [chromeApi]
 * @param {{ destination?: string }} [options]
 * @returns {Promise<ClipperResult>}
 */
export async function runClipperForTab(tab, chromeApi = /** @type {any} */ (globalThis).chrome, options = {}) {
  const fail = async (rawCode) => {
    const error = createClipperError(rawCode);
    await applyActionFeedback(tab?.id, { ok: false, error }, chromeApi);
    return /** @type {const} */ ({ ok: false, error });
  };

  if (!tab || typeof tab.id !== "number") {
    return fail("UNSUPPORTED_TAB");
  }

  if (!chromeApi?.scripting?.executeScript) {
    return fail("UNSUPPORTED_TAB");
  }

  let injectionResults;
  try {
    injectionResults = await chromeApi.scripting.executeScript({
      target: { tabId: tab.id },
      func: extractDomSnapshot,
    });
  } catch {
    return fail("UNSUPPORTED_TAB");
  }

  const domResult = injectionResults?.[0]?.result;
  if (!domResult || !domResult.ok) {
    return fail(domResult?.error?.code || "DOM_STRUCTURE_CHANGED");
  }

  const extracted = extractCanonicalCifra(domResult.snapshot);
  if (!extracted.ok || !("text" in extracted)) {
    return fail("error" in extracted ? extracted.error : "DOM_STRUCTURE_CHANGED");
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
    const deliveryError = "error" in delivery ? delivery.error : createClipperError("DELIVERY_FAILED");
    await applyActionFeedback(tab.id, { ok: false, error: deliveryError }, chromeApi);
    return {
      ok: false,
      error: deliveryError,
    };
  }

  await applyActionFeedback(
    tab.id,
    { ok: true, title: delivery.receipt.confirmationMessage },
    chromeApi,
  );

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
