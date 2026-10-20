import { cifraClubUrl } from "./cifra.js";
import { parseCifraHtmlSource } from "./source.js";

/**
 * @typedef {import("./source.js").CifraSource} CifraSource
 */

/**
 * @typedef {Object} ApiError
 * @property {"INVALID_URL" | "NOT_FOUND" | "UPSTREAM_BLOCKED" | "UNPARSEABLE" | "TEMPORARY_FAILURE" | "METHOD_NOT_ALLOWED"} code
 * @property {string} message
 * @property {boolean} retryable
 */

/**
 * @typedef {Object} ApiResult
 * @property {boolean} ok
 * @property {number} status
 * @property {CifraSource} [source]
 * @property {ApiError} [error]
 */

/**
 * Busca a página HTML do Cifra Club e extrai a fonte literal de cifra (CifraSource).
 * Injeta fetch para permitir testes determinísticos e isolamento completo de rede.
 *
 * @param {string} targetUrl
 * @param {Object} [options]
 * @param {typeof fetch} [options.fetch]
 * @param {number} [options.timeoutMs=8000]
 * @returns {Promise<ApiResult>}
 */
export async function fetchCifraSource(targetUrl, options = {}) {
  const fetchFn = options.fetch || globalThis.fetch;
  const timeoutMs = options.timeoutMs || 8000;

  const canonical = cifraClubUrl(targetUrl);
  if (!canonical) {
    return {
      ok: false,
      status: 400,
      error: {
        code: "INVALID_URL",
        message: "O endereço informado não é um link válido do Cifra Club.",
        retryable: false,
      },
    };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let response;
  try {
    response = await fetchFn(canonical, {
      redirect: "follow",
      headers: {
        Accept: "text/html,application/xhtml+xml",
        "Accept-Language": "pt-BR,pt;q=0.9",
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
      },
      signal: controller.signal,
    });
  } catch {
    clearTimeout(timer);
    return {
      ok: false,
      status: 502,
      error: {
        code: "TEMPORARY_FAILURE",
        message: "Falha de rede ou tempo de resposta esgotado ao contatar o Cifra Club.",
        retryable: true,
      },
    };
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    if (response.status === 404) {
      return {
        ok: false,
        status: 404,
        error: {
          code: "NOT_FOUND",
          message: "A cifra não foi encontrada no Cifra Club (página inexistente).",
          retryable: false,
        },
      };
    }
    if (response.status === 401 || response.status === 403 || response.status === 429) {
      return {
        ok: false,
        status: 403,
        error: {
          code: "UPSTREAM_BLOCKED",
          message: "O Cifra Club bloqueou ou limitou o acesso automatizado a esta página. Copie e cole os acordes da cifra manualmente.",
          retryable: false,
        },
      };
    }
    return {
      ok: false,
      status: 502,
      error: {
        code: "TEMPORARY_FAILURE",
        message: `O servidor do Cifra Club retornou HTTP ${response.status}. Tente novamente mais tarde.`,
        retryable: true,
      },
    };
  }

  let html;
  try {
    html = await response.text();
  } catch {
    return {
      ok: false,
      status: 502,
      error: {
        code: "TEMPORARY_FAILURE",
        message: "Não foi possível ler o corpo da página recebida.",
        retryable: true,
      },
    };
  }

  const finalUrl = response.url || canonical;
  const source = parseCifraHtmlSource(html, finalUrl);

  if (!source || !Array.isArray(source.allChords) || source.allChords.length === 0) {
    return {
      ok: false,
      status: 422,
      error: {
        code: "UNPARSEABLE",
        message: "A página foi carregada, mas não contém acordes de cifra identificáveis. A estrutura pode ter mudado ou trata-se apenas de letra.",
        retryable: false,
      },
    };
  }

  return {
    ok: true,
    status: 200,
    source,
  };
}

/**
 * Cliente da API de cifra para consumo pelo navegador.
 * Chama o endpoint oficial /api/cifra?url=... e recebe { source } ou erro tipado.
 *
 * @param {string} targetUrl
 * @param {Object} [options]
 * @param {typeof fetch} [options.fetch]
 * @returns {Promise<ApiResult>}
 */
export async function requestCifraApi(targetUrl, options = {}) {
  const fetchFn = options.fetch || globalThis.fetch;
  const canonical = cifraClubUrl(targetUrl);
  if (!canonical) {
    return {
      ok: false,
      status: 400,
      error: {
        code: "INVALID_URL",
        message: "O endereço informado não é um link válido do Cifra Club.",
        retryable: false,
      },
    };
  }

  try {
    const res = await fetchFn(`/api/cifra?url=${encodeURIComponent(canonical)}`, {
      headers: { Accept: "application/json" },
    });
    const body = await res.json().catch(() => ({}));
    if (res.ok && body.source) {
      return { ok: true, status: res.status, source: body.source };
    }
    const err = body.error || {
      code: "TEMPORARY_FAILURE",
      message: `Erro ao obter a cifra (HTTP ${res.status}).`,
      retryable: res.status >= 500,
    };
    return { ok: false, status: res.status, error: err };
  } catch {
    return {
      ok: false,
      status: 502,
      error: {
        code: "TEMPORARY_FAILURE",
        message: "Não foi possível conectar ao serviço de cifras do Caderno.",
        retryable: true,
      },
    };
  }
}
