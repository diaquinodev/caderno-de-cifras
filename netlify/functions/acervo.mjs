import { getStore } from "@netlify/blobs";
import { chartKey, toSharedChart } from "../../caderno/js/acervo.js";

export default async (request) => {
  if (request.method === "GET") return readChart(request);
  if (request.method === "POST") return saveChart(request);
  return json({ error: "Não consegui usar o acervo." }, 405);
};

async function readChart(request) {
  const url = new URL(request.url);
  const id = chartKey(url.searchParams.get("title"), url.searchParams.get("composer"));
  if (!id) return json({ error: "Informe o título e o compositor." }, 400);
  const store = openStore();
  const chart = await store.get(id, { type: "json" });
  if (!chart) return json({ error: "Ainda não há cifra aprovada desta música." }, 404);
  return json(chart, 200);
}

async function saveChart(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Não consegui ler a cifra." }, 400);
  }
  const chart = toSharedChart(body);
  if (!chart) {
    return json({ error: "Para compartilhar, a cifra precisa de título, compositor e acordes conferidos." }, 400);
  }
  const store = openStore();
  await store.setJSON(chart.id, chart);
  return json({
    message: "Cifra aprovada. Quem buscar esta música recebe esta versão.",
    chart,
  }, 200);
}

function openStore() {
  return getStore("caderno-acervo");
}

function json(payload, status) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}
