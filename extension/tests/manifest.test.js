import test from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { validateExtensionManifest } from "../../scripts/validate-extension-manifest.mjs";

const manifestUrl = new URL("../manifest.json", import.meta.url);
const extensionDir = fileURLToPath(new URL("../", import.meta.url));

test("manifesto real usa Manifest V3, solicita apenas activeTab e scripting e não declara hosts permanentes", async () => {
  const manifest = JSON.parse(await readFile(manifestUrl, "utf8"));
  const result = validateExtensionManifest(manifest);

  assert.deepEqual(result, { valid: true, errors: [] });
  assert.equal(manifest.manifest_version, 3);
  assert.deepEqual(manifest.permissions, ["activeTab", "scripting"]);
  assert.equal(Object.hasOwn(manifest, "host_permissions"), false);
  assert.equal(Object.hasOwn(manifest, "content_scripts"), false);
  assert.deepEqual(manifest.background, {
    service_worker: "background.js",
    type: "module",
  });
});

test("validador detecta manifesto inválido, permissões proibidas e content_scripts permanentes", () => {
  const result = validateExtensionManifest({
    manifest_version: 2,
    name: "",
    version: "próxima",
    permissions: ["activeTab", "cookies", "webRequest", "<all_urls>"],
    host_permissions: ["https://www.cifraclub.com.br/*"],
    content_scripts: [{ matches: ["<all_urls>"], js: ["content.js"] }],
  });

  assert.equal(result.valid, false);
  assert.deepEqual(result.errors, [
    "manifest_version deve ser 3",
    "name deve ser um texto não vazio",
    "version deve usar o formato inteiro.inteiro.inteiro",
    "permissão não autorizada no manifesto: cookies",
    "permissão não autorizada no manifesto: webRequest",
    "permissão não autorizada no manifesto: <all_urls>",
    "host_permissions não deve declarar hosts permanentes",
    "content_scripts permanente não é permitido; use acionamento por clique",
  ]);
});

test("código da extensão não lê cookies, tokens nem executa chamadas de rede", async () => {
  const entries = await readdir(extensionDir, { withFileTypes: true });
  const jsFiles = entries.filter((entry) => entry.isFile() && entry.name.endsWith(".js"));
  assert.ok(jsFiles.length >= 3);

  const forbiddenPatterns = [
    /\bcookie\b/i,
    /\btoken\b/i,
    /\bfetch\s*\(/,
    /\bXMLHttpRequest\b/,
    /\bsendBeacon\b/,
    /\bWebSocket\b/,
    /\bwebRequest\b/,
    /\blocalStorage\b/,
    /\bsessionStorage\b/,
  ];

  for (const file of jsFiles) {
    const source = await readFile(join(extensionDir, file.name), "utf8");
    for (const pattern of forbiddenPatterns) {
      assert.doesNotMatch(
        source,
        pattern,
        `Padrão proibido ${pattern} encontrado em extension/${file.name}`,
      );
    }
  }
});
