import { createClipperError } from "./errors.js";

export const CADERNO_PRODUCTION_URL = "https://stunning-raindrop-7db7c8.netlify.app/#/musicas";

/**
 * @typedef {import("./errors.js").ClipperError} ClipperError
 */

/**
 * @typedef {Object} DeliveryReceipt
 * @property {string} title
 * @property {number} chordCount
 * @property {string} destination
 * @property {string} confirmationMessage
 */

/**
 * @typedef {{ ok: true, receipt: DeliveryReceipt } | { ok: false, error: ClipperError }} DeliveryResult
 */

/**
 * Self-contained function executed inside the active tab to copy canonical text to the clipboard.
 *
 * @param {string} text
 * @returns {Promise<{ ok: boolean }>}
 */
export async function copyTextInActiveTab(text) {
  if (!text || typeof text !== "string") {
    return { ok: false };
  }

  try {
    if (navigator?.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return { ok: true };
    }
  } catch {
    // Fall back to execCommand below if clipboard API is blocked in context
  }

  try {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    const copied = document.execCommand("copy");
    textarea.remove();
    return { ok: Boolean(copied) };
  } catch {
    return { ok: false };
  }
}

/**
 * Formats a lyric-free confirmation message with song title and chord count.
 *
 * @param {{ title: string, chordCount: number }} info
 * @returns {string}
 */
export function formatDeliveryConfirmation({ title, chordCount }) {
  const safeTitle = String(title || "Cifra").replace(/\s+/g, " ").trim() || "Cifra";
  return `Copiado: ${safeTitle} (${chordCount} acordes). Cole no campo de cifra do Caderno.`;
}

/**
 * Validates that the destination URL is a clean Caderno origin without musical payload in query params.
 *
 * @param {string} destination
 * @returns {boolean}
 */
export function isCleanCadernoDestination(destination) {
  try {
    const parsed = new URL(destination);
    const allowedProtocol = parsed.protocol === "https:" || parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost";
    if (!allowedProtocol) return false;
    if (parsed.search && parsed.search.length > 0) return false;
    return true;
  } catch {
    return false;
  }
}

/**
 * Copies the validated canonical Cifra text to the clipboard and opens the Caderno.
 * Never writes to the clipboard if extraction failed.
 *
 * @param { { ok: boolean, text?: string, chordCount?: number, metadata?: { title?: string }, error?: { code: string, message: string } } } extraction
 * @param {{ id?: number }} tab
 * @param {any} [chromeApi]
 * @param {{ destination?: string }} [options]
 * @returns {Promise<DeliveryResult>}
 */
export async function deliverToCaderno(
  extraction,
  tab,
  chromeApi = /** @type {any} */ (globalThis).chrome,
  options = {},
) {
  if (!extraction || !extraction.ok || !extraction.text || !extraction.chordCount) {
    return {
      ok: false,
      error: createClipperError("CLIPBOARD_DENIED"),
    };
  }

  const destination = options.destination || CADERNO_PRODUCTION_URL;
  if (!isCleanCadernoDestination(destination)) {
    return {
      ok: false,
      error: createClipperError("INVALID_DESTINATION"),
    };
  }

  let copyResults;
  try {
    copyResults = await chromeApi.scripting.executeScript({
      target: { tabId: tab.id },
      func: copyTextInActiveTab,
      args: [extraction.text],
    });
  } catch {
    return {
      ok: false,
      error: createClipperError("CLIPBOARD_DENIED"),
    };
  }

  if (!copyResults?.[0]?.result?.ok) {
    return {
      ok: false,
      error: createClipperError("CLIPBOARD_DENIED"),
    };
  }

  try {
    if (chromeApi?.tabs?.create) {
      await chromeApi.tabs.create({ url: destination });
    }
  } catch {
    return {
      ok: false,
      error: createClipperError("TAB_OPEN_FAILED"),
    };
  }

  const title = extraction.metadata?.title || "Cifra";
  const confirmationMessage = formatDeliveryConfirmation({
    title,
    chordCount: extraction.chordCount,
  });

  return {
    ok: true,
    receipt: {
      title,
      chordCount: extraction.chordCount,
      destination,
      confirmationMessage,
    },
  };
}
