import { fetchCifraSource } from "../../caderno/js/api.js";

export default async (request) => {
  if (request.method !== "GET") {
    return new Response(
      JSON.stringify({
        error: {
          code: "METHOD_NOT_ALLOWED",
          message: "Método não permitido. Utilize GET.",
          retryable: false,
        },
      }),
      {
        status: 405,
        headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
      }
    );
  }
  const target = new URL(request.url).searchParams.get("url") || "";
  const result = await fetchCifraSource(target);
  const payload = result.ok ? { source: result.source } : { error: result.error };
  return new Response(JSON.stringify(payload), {
    status: result.status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
};
