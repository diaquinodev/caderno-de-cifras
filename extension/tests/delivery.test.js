import test from "node:test";
import assert from "node:assert/strict";
import {
  CADERNO_PRODUCTION_URL,
  deliverToCaderno,
  formatDeliveryConfirmation,
  isCleanCadernoDestination,
} from "../delivery.js";

test("isCleanCadernoDestination garante URL de destino sem dados musicais na query string", () => {
  assert.equal(isCleanCadernoDestination(CADERNO_PRODUCTION_URL), true);
  assert.equal(isCleanCadernoDestination("http://127.0.0.1:4173/#/musicas"), true);
  assert.equal(isCleanCadernoDestination("https://stunning-raindrop-7db7c8.netlify.app/?text=Bm7"), false);
  assert.equal(isCleanCadernoDestination("javascript:alert(1)"), false);
});

test("deliverToCaderno copia somente após extração válida, abre o Caderno e gera DeliveryReceipt sem letra", async () => {
  const copiedTexts = [];
  const openedTabs = [];
  const badgeUpdates = [];

  const mockChrome = {
    scripting: {
      async executeScript({ target, args }) {
        assert.equal(target.tabId, 11);
        copiedTexts.push(args[0]);
        return [{ result: { ok: true } }];
      },
    },
    tabs: {
      async create({ url }) {
        openedTabs.push(url);
        return { id: 99, url };
      },
    },
    action: {
      async setBadgeText(payload) {
        badgeUpdates.push(payload);
      },
      async setBadgeBackgroundColor() {},
      async setTitle() {},
    },
  };

  const result = await deliverToCaderno(
    {
      ok: true,
      text: "Título: Oba Lá Vem Ela\nArtista: Jorge Ben Jor\nTom: Bm\n\n[Refrão]\nBm7 Em7",
      chordCount: 74,
      metadata: { title: "Oba Lá Vem Ela" },
    },
    { id: 11 },
    mockChrome,
  );

  assert.equal(result.ok, true);
  if (!result.ok) return;

  assert.equal(copiedTexts.length, 1);
  assert.deepEqual(openedTabs, [CADERNO_PRODUCTION_URL]);
  assert.deepEqual(badgeUpdates, [{ tabId: 11, text: "OK" }]);
  assert.deepEqual(result.receipt, {
    title: "Oba Lá Vem Ela",
    chordCount: 74,
    destination: CADERNO_PRODUCTION_URL,
    confirmationMessage: formatDeliveryConfirmation({ title: "Oba Lá Vem Ela", chordCount: 74 }),
  });
});

test("deliverToCaderno nunca escreve no clipboard nem abre aba quando extração falhou", async () => {
  let scriptCalled = false;
  let tabCreated = false;

  const mockChrome = {
    scripting: {
      async executeScript() {
        scriptCalled = true;
        return [{ result: { ok: true } }];
      },
    },
    tabs: {
      async create() {
        tabCreated = true;
      },
    },
  };

  const failedExtraction = await deliverToCaderno(
    { ok: false, error: { code: "NO_CHORDS", message: "Sem acordes" } },
    { id: 11 },
    mockChrome,
  );

  assert.equal(failedExtraction.ok, false);
  assert.equal(scriptCalled, false);
  assert.equal(tabCreated, false);
});
