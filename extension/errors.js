/**
 * @typedef {"UNSUPPORTED_TAB" | "NOT_CHORD_PAGE" | "DOM_STRUCTURE_CHANGED" | "UNSUPPORTED_CHORD" | "NO_CHORDS" | "CLIPBOARD_DENIED" | "DELIVERY_FAILED"} ClipperErrorCode
 */

/**
 * @typedef {Object} ClipperError
 * @property {ClipperErrorCode} code
 * @property {string} message
 * @property {boolean} retryable
 */

/** @type {Record<ClipperErrorCode, { message: string, retryable: boolean }>} */
const ERROR_CATALOG = {
  UNSUPPORTED_TAB: {
    message: "Esta aba não permite leitura pela extensão. Abra uma cifra pública no Cifra Club e clique novamente.",
    retryable: false,
  },
  NOT_CHORD_PAGE: {
    message: "A página atual não é uma cifra reconhecida. Abra a página de uma música no Cifra Club.",
    retryable: false,
  },
  DOM_STRUCTURE_CHANGED: {
    message: "A estrutura da página mudou ou está incompleta. Recarregue a página ou copie os acordes manualmente.",
    retryable: true,
  },
  UNSUPPORTED_CHORD: {
    message: "A página contém uma notação de acorde ainda não suportada. Envie a URL para adicionarmos esse formato com segurança.",
    retryable: false,
  },
  NO_CHORDS: {
    message: "Nenhum acorde reconhecível foi encontrado nesta página. Verifique se a cifra possui acordes visíveis.",
    retryable: false,
  },
  CLIPBOARD_DENIED: {
    message: "Não foi possível copiar para a área de transferência. Clique na página da cifra para ativá-la e tente novamente.",
    retryable: true,
  },
  DELIVERY_FAILED: {
    message: "A cifra foi validada, mas não foi possível abrir o Caderno automaticamente. Abra o Caderno e cole manualmente.",
    retryable: true,
  },
};

/**
 * Creates a typed ClipperError with actionable user guidance and retryable flag.
 *
 * @param {string} rawCode
 * @param {string} [customMessage]
 * @returns {ClipperError}
 */
export function createClipperError(rawCode, customMessage) {
  /** @type {Record<string, ClipperErrorCode>} */
  const codeMap = {
    INVALID_TAB_CONTEXT: "UNSUPPORTED_TAB",
    SCRIPTING_UNAVAILABLE: "UNSUPPORTED_TAB",
    INJECTION_BLOCKED: "UNSUPPORTED_TAB",
    UNSUPPORTED_TAB: "UNSUPPORTED_TAB",
    NOT_CHORD_PAGE: "NOT_CHORD_PAGE",
    DOM_STRUCTURE_CHANGED: "DOM_STRUCTURE_CHANGED",
    INVALID_CHORD: "UNSUPPORTED_CHORD",
    INVALID_TAB: "DOM_STRUCTURE_CHANGED",
    NO_CHORDS: "NO_CHORDS",
    CLIPBOARD_DENIED: "CLIPBOARD_DENIED",
    INVALID_DESTINATION: "DELIVERY_FAILED",
    TAB_OPEN_FAILED: "DELIVERY_FAILED",
    DELIVERY_FAILED: "DELIVERY_FAILED",
  };

  const normalizedCode = codeMap[rawCode] || "DOM_STRUCTURE_CHANGED";
  const catalogEntry = ERROR_CATALOG[normalizedCode];

  return {
    code: normalizedCode,
    message: customMessage || catalogEntry.message,
    retryable: catalogEntry.retryable,
  };
}

/**
 * Updates the Chrome extension action icon badge and tooltip idempotently.
 *
 * @param {number | undefined} tabId
 * @param {{ ok: true, title: string } | { ok: false, error: ClipperError }} status
 * @param {any} [chromeApi]
 */
export async function applyActionFeedback(tabId, status, chromeApi = /** @type {any} */ (globalThis).chrome) {
  if (typeof tabId !== "number" || !chromeApi?.action) return;

  const badgeText = status.ok ? "OK" : "ERR";
  const badgeColor = status.ok ? "#1f7a4c" : "#b91c1c";
  const tooltip = "title" in status
    ? status.title
    : `Falha (${status.error.code}): ${status.error.message}`;

  try {
    if (chromeApi.action.setBadgeText) {
      await chromeApi.action.setBadgeText({ tabId, text: badgeText });
    }
    if (chromeApi.action.setBadgeBackgroundColor) {
      await chromeApi.action.setBadgeBackgroundColor({ tabId, color: badgeColor });
    }
    if (chromeApi.action.setTitle) {
      await chromeApi.action.setTitle({ tabId, title: tooltip });
    }
  } catch {
    // Ignore badge update failure if tab was closed mid-action
  }
}
