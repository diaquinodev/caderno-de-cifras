import { loadCifraChart } from "../../caderno/js/cifra.js";

export default async (request) => {
  if (request.method !== "GET") {
    return new Response(JSON.stringify({ error: "Não consegui ler esse link." }), {
      status: 405,
      headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
    });
  }
  const target = new URL(request.url).searchParams.get("url") || "";
  const result = await loadCifraChart(target);
  const payload = result.ok ? result.chart : { error: result.error };
  return new Response(JSON.stringify(payload), {
    status: result.status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
};
