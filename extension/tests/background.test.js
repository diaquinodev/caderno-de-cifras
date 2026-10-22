import test from "node:test";
import assert from "node:assert/strict";
import { registerActionListener, runClipperForTab } from "../background.js";
import { CADERNO_PRODUCTION_URL } from "../delivery.js";

test("registerActionListener aguarda clique do usuário antes de executar script e entregar ao Caderno", async () => {
  let registeredHandler = null;
  const executeCalls = [];
  const createdTabs = [];
  const badges = [];

  const mockChrome = {
    action: {
      onClicked: {
        addListener(fn) {
          registeredHandler = fn;
        },
      },
      async setBadgeText(payload) {
        badges.push(payload);
      },
      async setBadgeBackgroundColor() {},
      async setTitle() {},
    },
    scripting: {
      async executeScript({ target, func, args }) {
        executeCalls.push({ tabId: target.tabId, hasArgs: Array.isArray(args) });
        assert.equal(target.tabId, 42);
        assert.equal(typeof func, "function");
        if (Array.isArray(args)) {
          return [{ result: { ok: true } }];
        }
        return [
          {
            result: {
              ok: true,
              snapshot: {
                metadata: {
                  title: "Oba Lá Vem Ela",
                  artist: "Jorge Ben Jor",
                  key: "Bm",
                },
                blocks: [
                  {
                    label: "Refrão",
                    kind: "section",
                    lines: [{ type: "chords", chords: ["Bm7", "Em7"] }],
                  },
                ],
              },
            },
          },
        ];
      },
    },
    tabs: {
      async create({ url }) {
        createdTabs.push(url);
        return { id: 100, url };
      },
    },
  };

  const listener = registerActionListener(mockChrome);
  assert.equal(typeof listener, "function");
  assert.equal(executeCalls.length, 0, "Nada deve rodar antes do clique do usuário");

  const result = await registeredHandler({ id: 42 });
  assert.equal(executeCalls.length, 2, "Deve extrair o DOM e em seguida copiar o texto válido");
  assert.deepEqual(createdTabs, [CADERNO_PRODUCTION_URL]);
  assert.deepEqual(badges, [{ tabId: 42, text: "OK" }]);
  assert.deepEqual(result, {
    ok: true,
    text: "Título: Oba Lá Vem Ela\nArtista: Jorge Ben Jor\nTom: Bm\n\n[Refrão]\nBm7 Em7",
    chordCount: 2,
    metadata: {
      title: "Oba Lá Vem Ela",
      artist: "Jorge Ben Jor",
      key: "Bm",
    },
    receipt: {
      title: "Oba Lá Vem Ela",
      chordCount: 2,
      destination: CADERNO_PRODUCTION_URL,
      confirmationMessage: "Copiado: Oba Lá Vem Ela (2 acordes). Cole no campo de cifra do Caderno.",
    },
  });
});

test("runClipperForTab retorna ClipperError UNSUPPORTED_TAB quando aba é inválida ou bloqueia injeção", async () => {
  const noTab = await runClipperForTab(null, {});
  assert.equal(noTab.ok, false);
  if (!noTab.ok) {
    assert.equal(noTab.error.code, "UNSUPPORTED_TAB");
    assert.equal(noTab.error.retryable, false);
  }

  const blockedChrome = {
    scripting: {
      async executeScript() {
        throw new Error("Cannot access a chrome:// URL");
      },
    },
  };
  const blocked = await runClipperForTab({ id: 7 }, blockedChrome);
  assert.equal(blocked.ok, false);
  if (!blocked.ok) {
    assert.equal(blocked.error.code, "UNSUPPORTED_TAB");
    assert.equal(blocked.error.retryable, false);
  }
});
