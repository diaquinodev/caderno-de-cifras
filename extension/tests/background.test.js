import test from "node:test";
import assert from "node:assert/strict";
import { registerActionListener, runClipperForTab } from "../background.js";

test("registerActionListener aguarda clique do usuário antes de executar script na aba", async () => {
  let registeredHandler = null;
  let executeCalls = 0;

  const mockChrome = {
    action: {
      onClicked: {
        addListener(fn) {
          registeredHandler = fn;
        },
      },
    },
    scripting: {
      async executeScript({ target, func }) {
        executeCalls += 1;
        assert.equal(target.tabId, 42);
        assert.equal(typeof func, "function");
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
  };

  const listener = registerActionListener(mockChrome);
  assert.equal(typeof listener, "function");
  assert.equal(executeCalls, 0, "Nada deve rodar antes do clique do usuário");

  const result = await registeredHandler({ id: 42 });
  assert.equal(executeCalls, 1);
  assert.deepEqual(result, {
    ok: true,
    text: "Título: Oba Lá Vem Ela\nArtista: Jorge Ben Jor\nTom: Bm\n\n[Refrão]\nBm7 Em7",
    chordCount: 2,
    metadata: {
      title: "Oba Lá Vem Ela",
      artist: "Jorge Ben Jor",
      key: "Bm",
    },
  });
});

test("runClipperForTab retorna erro explícito quando aba é inválida ou bloqueia injeção", async () => {
  const noTab = await runClipperForTab(null, {});
  assert.equal(noTab.ok, false);
  if (!noTab.ok) {
    assert.equal(noTab.error.code, "INVALID_TAB_CONTEXT");
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
    assert.equal(blocked.error.code, "INJECTION_BLOCKED");
  }
});
