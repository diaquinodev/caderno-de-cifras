import test from "node:test";
import assert from "node:assert/strict";
import { applyActionFeedback, createClipperError } from "../errors.js";
import { runClipperForTab } from "../background.js";

test("createClipperError tipa cada código de erro com mensagem instrutiva e flag retryable", () => {
  const unsupported = createClipperError("UNSUPPORTED_TAB");
  assert.equal(unsupported.code, "UNSUPPORTED_TAB");
  assert.equal(unsupported.retryable, false);
  assert.match(unsupported.message, /não permite leitura/);

  const notChord = createClipperError("NOT_CHORD_PAGE");
  assert.equal(notChord.code, "NOT_CHORD_PAGE");
  assert.equal(notChord.retryable, false);
  assert.match(notChord.message, /não é uma cifra reconhecida/);

  const domChanged = createClipperError("DOM_STRUCTURE_CHANGED");
  assert.equal(domChanged.code, "DOM_STRUCTURE_CHANGED");
  assert.equal(domChanged.retryable, true);
  assert.match(domChanged.message, /estrutura da página mudou/);

  const noChords = createClipperError("NO_CHORDS");
  assert.equal(noChords.code, "NO_CHORDS");
  assert.equal(noChords.retryable, false);
  assert.match(noChords.message, /Nenhum acorde reconhecível/);

  const clipboardDenied = createClipperError("CLIPBOARD_DENIED");
  assert.equal(clipboardDenied.code, "CLIPBOARD_DENIED");
  assert.equal(clipboardDenied.retryable, true);
  assert.match(clipboardDenied.message, /área de transferência/);

  const deliveryFailed = createClipperError("DELIVERY_FAILED");
  assert.equal(deliveryFailed.code, "DELIVERY_FAILED");
  assert.equal(deliveryFailed.retryable, true);
  assert.match(deliveryFailed.message, /abrir o Caderno/);
});

test("falhas em qualquer etapa nunca sobrescrevem o clipboard e repetição do clique é idempotente", async () => {
  const badges = [];
  const titles = [];
  let copyAttempts = 0;

  const mockChrome = {
    action: {
      async setBadgeText(payload) {
        badges.push(payload);
      },
      async setBadgeBackgroundColor() {},
      async setTitle(payload) {
        titles.push(payload);
      },
    },
    scripting: {
      async executeScript({ args }) {
        if (Array.isArray(args)) {
          copyAttempts += 1;
          return [{ result: { ok: true } }];
        }
        return [
          {
            result: {
              ok: false,
              error: {
                code: "NOT_CHORD_PAGE",
                message: "A página atual não é uma cifra reconhecida.",
              },
            },
          },
        ];
      },
    },
  };

  const firstAttempt = await runClipperForTab({ id: 55 }, mockChrome);
  const secondAttempt = await runClipperForTab({ id: 55 }, mockChrome);

  assert.deepEqual(firstAttempt, secondAttempt);
  assert.equal(firstAttempt.ok, false);
  if (!firstAttempt.ok) {
    assert.equal(firstAttempt.error.code, "NOT_CHORD_PAGE");
    assert.equal(firstAttempt.error.retryable, false);
  }
  assert.equal(copyAttempts, 0, "Falha nunca deve chamar cópia para o clipboard");
  assert.deepEqual(badges, [
    { tabId: 55, text: "ERR" },
    { tabId: 55, text: "ERR" },
  ]);
  assert.equal(titles[0].title, titles[1].title);
});

test("applyActionFeedback atualiza badge e tooltip tanto em sucesso quanto em erro", async () => {
  const calls = [];
  const mockChrome = {
    action: {
      async setBadgeText(p) {
        calls.push(["badge", p]);
      },
      async setBadgeBackgroundColor(p) {
        calls.push(["color", p]);
      },
      async setTitle(p) {
        calls.push(["title", p]);
      },
    },
  };

  await applyActionFeedback(10, { ok: true, title: "Copiado: Teste (8 acordes)" }, mockChrome);
  assert.deepEqual(calls, [
    ["badge", { tabId: 10, text: "OK" }],
    ["color", { tabId: 10, color: "#1f7a4c" }],
    ["title", { tabId: 10, title: "Copiado: Teste (8 acordes)" }],
  ]);
});
