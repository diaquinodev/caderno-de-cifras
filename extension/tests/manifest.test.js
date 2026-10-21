import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { validateExtensionManifest } from "../../scripts/validate-extension-manifest.mjs";

const manifestUrl = new URL("../manifest.json", import.meta.url);

test("manifesto real usa Manifest V3 e não pede permissões antes da extensão existir", async () => {
  const manifest = JSON.parse(await readFile(manifestUrl, "utf8"));
  const result = validateExtensionManifest(manifest);

  assert.deepEqual(result, { valid: true, errors: [] });
  assert.equal(manifest.manifest_version, 3);
  assert.equal(Object.hasOwn(manifest, "permissions"), false);
  assert.equal(Object.hasOwn(manifest, "host_permissions"), false);
});

test("validador detecta um manifesto propositalmente inválido", () => {
  const result = validateExtensionManifest({
    manifest_version: 2,
    name: "",
    version: "próxima",
    permissions: "activeTab",
  });

  assert.equal(result.valid, false);
  assert.deepEqual(result.errors, [
    "manifest_version deve ser 3",
    "name deve ser um texto não vazio",
    "version deve usar o formato inteiro.inteiro.inteiro",
    "permissions deve ser uma lista de textos quando informado",
  ]);
});
