import test from "node:test";
import assert from "node:assert/strict";

import { fetchCifraSource, requestCifraApi } from "./api.js";

test("fetchCifraSource: rejeita URL invalida com status 400 e INVALID_URL", async () => {
  const result = await fetchCifraSource("https://www.google.com/search?q=teste");

  assert.equal(result.ok, false);
  assert.equal(result.status, 400);
  assert.equal(result.error?.code, "INVALID_URL");
  assert.equal(result.error?.retryable, false);
});

test("fetchCifraSource: extrai CifraSource com status 200 para HTML valido", async () => {
  const sampleHtml = `<!DOCTYPE html>
<html>
<head><title>Música Teste - Artista Teste | Cifra Club</title></head>
<body>
  <h1 class="t1">Música Teste</h1>
  <h2><a href="/artista-teste/">Artista Teste</a></h2>
  <div class="c-info"><span id="cifra_tom">Tom: <a>C</a></span></div>
  <pre>
[Intro]
<span class="c-chord" data-chord-name="C7M"><b>C7M</b></span>  <span class="c-chord" data-chord-name="Dm7"><b>Dm7</b></span>
  </pre>
</body>
</html>`;

  const mockFetch = async () => ({
    ok: true,
    status: 200,
    url: "https://www.cifraclub.com.br/artista-teste/musica-teste/",
    text: async () => sampleHtml,
  });

  const result = await fetchCifraSource("https://www.cifraclub.com.br/artista-teste/musica-teste/", {
    fetch: mockFetch,
  });

  assert.equal(result.ok, true);
  assert.equal(result.status, 200);
  assert.ok(result.source, "Deve conter o objeto CifraSource");
  assert.equal(result.source.metadata.title, "Música Teste");
  assert.equal(result.source.metadata.artist, "Artista Teste");
  assert.equal(result.source.allChords.length, 2);
  assert.equal(result.source.allChords[0].raw, "C7M");
  assert.equal(result.source.allChords[1].raw, "Dm7");
});

test("fetchCifraSource: trata 404 da origem como NOT_FOUND com status 404", async () => {
  const mockFetch = async () => ({
    ok: false,
    status: 404,
    url: "https://www.cifraclub.com.br/artista/musica-inexistente/",
  });

  const result = await fetchCifraSource("https://www.cifraclub.com.br/artista/musica-inexistente/", {
    fetch: mockFetch,
  });

  assert.equal(result.ok, false);
  assert.equal(result.status, 404);
  assert.equal(result.error?.code, "NOT_FOUND");
  assert.equal(result.error?.retryable, false);
});

test("fetchCifraSource: trata bloqueio ou limitacao (403/429) como UPSTREAM_BLOCKED", async () => {
  const mockFetch = async () => ({
    ok: false,
    status: 403,
    url: "https://www.cifraclub.com.br/artista/musica/",
  });

  const result = await fetchCifraSource("https://www.cifraclub.com.br/artista/musica/", {
    fetch: mockFetch,
  });

  assert.equal(result.ok, false);
  assert.equal(result.status, 403);
  assert.equal(result.error?.code, "UPSTREAM_BLOCKED");
  assert.equal(result.error?.retryable, false);
});

test("fetchCifraSource: trata falha de rede ou timeout como TEMPORARY_FAILURE retryable", async () => {
  const mockFetch = async () => {
    throw new Error("Network timeout or connection refused");
  };

  const result = await fetchCifraSource("https://www.cifraclub.com.br/artista/musica/", {
    fetch: mockFetch,
  });

  assert.equal(result.ok, false);
  assert.equal(result.status, 502);
  assert.equal(result.error?.code, "TEMPORARY_FAILURE");
  assert.equal(result.error?.retryable, true);
});

test("fetchCifraSource: pagina sem acordes reconheciveis retorna status 422 e UNPARSEABLE", async () => {
  const sampleLyricsOnly = `<!DOCTYPE html>
<html>
<body>
  <h1>Apenas Letra</h1>
  <pre>Esta é uma canção sem nenhuma tag de acorde.</pre>
</body>
</html>`;

  const mockFetch = async () => ({
    ok: true,
    status: 200,
    url: "https://www.cifraclub.com.br/artista/so-letra/",
    text: async () => sampleLyricsOnly,
  });

  const result = await fetchCifraSource("https://www.cifraclub.com.br/artista/so-letra/", {
    fetch: mockFetch,
  });

  assert.equal(result.ok, false);
  assert.equal(result.status, 422);
  assert.equal(result.error?.code, "UNPARSEABLE");
  assert.equal(result.error?.retryable, false);
});

test("requestCifraApi: cliente no navegador processa sucesso da rota /api/cifra", async () => {
  const fakeSource = {
    metadata: { title: "Fake Song", artist: "Fake Artist", composer: "", key: "C", url: "" },
    blocks: [],
    allChords: [],
    exclusions: [],
  };

  const mockFetch = async (url) => {
    assert.ok(String(url).startsWith("/api/cifra?url="));
    return {
      ok: true,
      status: 200,
      json: async () => ({ source: fakeSource }),
    };
  };

  const result = await requestCifraApi("https://www.cifraclub.com.br/artista/fake-song/", {
    fetch: mockFetch,
  });

  assert.equal(result.ok, true);
  assert.equal(result.status, 200);
  assert.equal(result.source?.metadata?.title, "Fake Song");
});

test("requestCifraApi: cliente repassa erro tipado da rota /api/cifra", async () => {
  const mockFetch = async () => ({
    ok: false,
    status: 403,
    json: async () => ({
      error: {
        code: "UPSTREAM_BLOCKED",
        message: "Bloqueio do Cifra Club",
        retryable: false,
      },
    }),
  });

  const result = await requestCifraApi("https://www.cifraclub.com.br/artista/bloqueada/", {
    fetch: mockFetch,
  });

  assert.equal(result.ok, false);
  assert.equal(result.status, 403);
  assert.equal(result.error?.code, "UPSTREAM_BLOCKED");
  assert.equal(result.error?.retryable, false);
});
