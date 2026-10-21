import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

const fixtureUrl = new URL("../../tests/fixtures/cifraclub-oba-la-vem-ela.sanitized.html", import.meta.url);
const evidenceUrl = new URL("../../tests/fixtures/cifraclub-oba-la-vem-ela.evidence.json", import.meta.url);

async function loadEvidence() {
  return JSON.parse(await readFile(evidenceUrl, "utf8"));
}

function evidenceFor(document, field) {
  return document.evidence.find((item) => item.field === field);
}

test("fixture do DOM atual preserva apenas a estrutura musical observada", async () => {
  const [html, document] = await Promise.all([
    readFile(fixtureUrl, "utf8"),
    loadEvidence(),
  ]);

  assert.match(html, /<html\b[^>]*\bdata-chord-page\b/i);
  assert.match(html, /<article\b[^>]*\bdata-chord-container\b/i);
  assert.match(html, /<pre\b[^>]*\bdata-chord-content\b/i);

  const chordTags = [...html.matchAll(/<b\b[^>]*\bdata-chord-name="([^"]+)"[^>]*>/gi)];
  const chordNames = chordTags.map((match) => match[1]);
  const chordEvidence = evidenceFor(document, "chords").observed;

  assert.equal(chordNames.length, chordEvidence.count);
  assert.deepEqual([...new Set(chordNames)], chordEvidence.unique);
  assert.equal(
    createHash("sha256").update(chordNames.join(chordEvidence.sequenceSeparator)).digest("hex"),
    chordEvidence.sequenceSha256,
  );

  const indexes = chordTags.map((match) => {
    const value = match[0].match(/\bdata-chord-index="(\d+)"/i)?.[1];
    return Number(value);
  });
  assert.deepEqual(indexes, Array.from({ length: chordNames.length }, (_, index) => index));
});

test("fixture mantém distribuição por linha e ordem dos marcadores de seção", async () => {
  const [html, document] = await Promise.all([
    readFile(fixtureUrl, "utf8"),
    loadEvidence(),
  ]);
  const pre = html.match(/<pre\b[^>]*\bdata-chord-content\b[^>]*>([\s\S]*?)<\/pre>/i)?.[1] || "";
  const rows = [...pre.matchAll(/<div\b[^>]*>([\s\S]*?)<\/div>/gi)].map((match) => match[1]);
  const rowCounts = rows.map((row) => [...row.matchAll(/\bdata-chord-name="/gi)].length);
  const sections = [...pre.matchAll(/^\s*\[([^\]]+)]\s*<\/div>/gim)].map((match) => match[1]);

  assert.deepEqual(rowCounts, evidenceFor(document, "rows").observed.chordCounts);
  assert.deepEqual(sections, evidenceFor(document, "sections").observed);
});

test("fixture sanitizada não persiste letra nem dados da sessão do navegador", async () => {
  const html = await readFile(fixtureUrl, "utf8");
  const forbidden = [
    /<script\b/i,
    /<iframe\b/i,
    /document\.cookie/i,
    /localStorage/i,
    /sessionStorage/i,
    /(?:access|auth|session)[_-]?token/i,
    /google_vignette/i,
    /akamai/i,
  ];

  for (const pattern of forbidden) {
    assert.doesNotMatch(html, pattern);
  }

  const pre = html.match(/<pre\b[^>]*\bdata-chord-content\b[^>]*>([\s\S]*?)<\/pre>/i)?.[1] || "";
  const nonMusicalText = pre
    .replace(/<b\b[^>]*>[\s\S]*?<\/b>/gi, "")
    .replace(/\[[^\]]+]/g, "")
    .replace(/<[^>]+>/g, "")
    .trim();

  assert.equal(nonMusicalText, "");
});

test("evidência usa o contrato DomEvidence e registra a limitação de tablatura", async () => {
  const document = await loadEvidence();

  for (const item of document.evidence) {
    assert.equal(typeof item.field, "string");
    assert.ok(Array.isArray(item.selectorCandidates));
    assert.equal(typeof item.sampleShape, "string");
    assert.ok(Object.hasOwn(item, "observed"));
  }

  assert.equal(evidenceFor(document, "tablature").observed, false);
});
