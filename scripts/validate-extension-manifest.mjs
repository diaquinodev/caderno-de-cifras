import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const VERSION_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

/**
 * @param {unknown} candidate
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validateExtensionManifest(candidate) {
  const errors = [];

  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    return { valid: false, errors: ["manifest.json deve conter um objeto JSON"] };
  }

  const manifest = /** @type {Record<string, unknown>} */ (candidate);
  if (manifest.manifest_version !== 3) {
    errors.push("manifest_version deve ser 3");
  }
  if (typeof manifest.name !== "string" || !manifest.name.trim()) {
    errors.push("name deve ser um texto não vazio");
  }
  if (typeof manifest.version !== "string" || !VERSION_PATTERN.test(manifest.version)) {
    errors.push("version deve usar o formato inteiro.inteiro.inteiro");
  }

  for (const field of ["permissions", "host_permissions"]) {
    const value = manifest[field];
    if (value !== undefined && (!Array.isArray(value) || value.some((item) => typeof item !== "string"))) {
      errors.push(`${field} deve ser uma lista de textos quando informado`);
    }
  }

  return { valid: errors.length === 0, errors };
}

export async function loadAndValidateManifest(path = "extension/manifest.json") {
  const raw = await readFile(path, "utf8");
  return validateExtensionManifest(JSON.parse(raw));
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : "";
if (import.meta.url === invokedPath) {
  const result = await loadAndValidateManifest();
  if (!result.valid) {
    console.error(result.errors.join("\n"));
    process.exitCode = 1;
  } else {
    console.log("Manifesto da extensão válido.");
  }
}
