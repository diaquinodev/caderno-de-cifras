import test from "node:test";
import assert from "node:assert/strict";
import {
  bufferToBase64,
  base64ToBuffer,
  countPdfPages,
} from "./files.js";
import { inspectPdf } from "./pdfview.js";

test("bufferToBase64 e base64ToBuffer preservam integridade binaria", () => {
  const original = new Uint8Array([0, 1, 2, 255, 128, 64, 32, 16, 8, 4, 2, 1]);
  const b64 = bufferToBase64(original.buffer);
  assert.equal(typeof b64, "string");
  const restored = new Uint8Array(base64ToBuffer(b64));
  assert.deepEqual(restored, original);
});

test("countPdfPages detecta marcadores de pagina no fluxo binario", () => {
  const sample = "stream\n/Type /Page\nsomething\n/Type /Page\nendstream";
  const bytes = new TextEncoder().encode(sample);
  assert.equal(countPdfPages(bytes), 2);
});

test("inspectPdf retorna resultado discriminado MISSING_BYTES para entrada vazia", async () => {
  const resultNull = await inspectPdf(null);
  assert.equal(resultNull.ok, false);
  assert.equal(resultNull.error, "MISSING_BYTES");

  const resultEmpty = await inspectPdf(new Uint8Array(0));
  assert.equal(resultEmpty.ok, false);
  assert.equal(resultEmpty.error, "MISSING_BYTES");
});