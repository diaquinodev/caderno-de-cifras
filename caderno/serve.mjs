import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chartKey, toSharedChart } from "./js/acervo.js";
import { fetchCifraSource } from "./js/api.js";

const root = path.dirname(fileURLToPath(import.meta.url));
const acervoFile = path.join(root, "..", "data", "acervo.json");
const port = Number(process.env.PORT || 4173);
const types = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".mjs": "text/javascript; charset=utf-8",
  ".pdf": "application/pdf",
  ".ttf": "font/ttf",
  ".wasm": "application/wasm",
};

const server = http.createServer((request, response) => {
  const url = new URL(request.url || "/", `http://127.0.0.1:${port}`);
  if (request.method === "GET" && url.pathname === "/api/cifra") {
    const target = url.searchParams.get("url") || "";
    fetchCifraSource(target).then((result) => {
      console.log(`cifra ${result.status} ${target.slice(0, 180)}`);
      const payload = result.ok ? { source: result.source } : { error: result.error };
      response.writeHead(result.status, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
      });
      response.end(JSON.stringify(payload));
    }).catch(() => {
      response.writeHead(502, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
      response.end(JSON.stringify({ error: "Não consegui ler esse link." }));
    });
    return;
  }
  if (url.pathname === "/api/acervo") {
    handleAcervo(request, response, url);
    return;
  }
  let pathname = decodeURIComponent(url.pathname);
  if (pathname === "/") pathname = "/index.html";
  const file = path.normalize(path.join(root, pathname));
  if (!file.startsWith(root)) {
    response.writeHead(403);
    response.end("Forbidden");
    return;
  }
  fs.readFile(file, (error, data) => {
    if (error) {
      response.writeHead(404);
      response.end("Not found");
      return;
    }
    response.writeHead(200, {
      "Content-Type": types[path.extname(file)] || "application/octet-stream",
      "Cache-Control": "no-store",
    });
    response.end(data);
  });
});

function readAcervo() {
  try {
    return JSON.parse(fs.readFileSync(acervoFile, "utf8"));
  } catch {
    return {};
  }
}

function writeAcervo(records) {
  fs.mkdirSync(path.dirname(acervoFile), { recursive: true });
  fs.writeFileSync(acervoFile, JSON.stringify(records));
}

function sendJson(response, status, payload) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  response.end(JSON.stringify(payload));
}

function handleAcervo(request, response, url) {
  if (request.method === "GET") {
    const id = chartKey(url.searchParams.get("title"), url.searchParams.get("composer"));
    if (!id) {
      sendJson(response, 400, { error: "Informe o título e o compositor." });
      return;
    }
    const chart = readAcervo()[id];
    sendJson(response, chart ? 200 : 404, chart || { error: "Ainda não há cifra aprovada desta música." });
    return;
  }
  if (request.method !== "POST") {
    sendJson(response, 405, { error: "Não consegui usar o acervo." });
    return;
  }
  const chunks = [];
  request.on("data", (chunk) => chunks.push(chunk));
  request.on("end", () => {
    let body;
    try {
      body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
    } catch {
      sendJson(response, 400, { error: "Não consegui ler a cifra." });
      return;
    }
    const chart = toSharedChart(body);
    if (!chart) {
      sendJson(response, 400, { error: "Para compartilhar, a cifra precisa de título, compositor e acordes conferidos." });
      return;
    }
    const records = readAcervo();
    records[chart.id] = chart;
    writeAcervo(records);
    sendJson(response, 200, { message: "Cifra aprovada. Quem buscar esta música recebe esta versão.", chart });
  });
}

server.listen(port, "127.0.0.1", () => {
  console.log(`Caderno em http://127.0.0.1:${port}`);
});
