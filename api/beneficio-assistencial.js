import { put } from "@vercel/blob";

const MAX_BODY_BYTES = 4096;
const ALLOWED_ANSWERS = {
  q1: new Set(["q1_o1", "q1_o2", "q1_o3"]),
  q2: new Set(["q2_o1", "q2_o2", "q2_o3", "q2_o4"]),
  q3: new Set(["q3_o1", "q3_o2", "q3_o3"]),
  q4: new Set(["q4_o1", "q4_o2", "q4_o3"]),
};

function json(body, status = 200) {
  return Response.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

function isSameOrigin(request) {
  const origin = request.headers.get("origin");
  if (!origin) return false;

  try {
    const originHost = new URL(origin).host;
    const requestHost = request.headers.get("x-forwarded-host") || new URL(request.url).host;
    return originHost === requestHost;
  } catch {
    return false;
  }
}

export default {
  async fetch(request) {
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Methods": "POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
          "Access-Control-Max-Age": "86400",
          "Cache-Control": "no-store",
        },
      });
    }

    if (request.method !== "POST") {
      return json({ ok: false, error: "Metodo nao permitido." }, 405);
    }

    if (!isSameOrigin(request)) {
      return json({ ok: false, error: "Origem nao autorizada." }, 403);
    }

    const contentType = request.headers.get("content-type") || "";
    if (!contentType.toLowerCase().startsWith("application/json")) {
      return json({ ok: false, error: "Conteudo invalido." }, 415);
    }

    const declaredLength = Number(request.headers.get("content-length") || 0);
    if (declaredLength > MAX_BODY_BYTES) {
      return json({ ok: false, error: "Conteudo muito grande." }, 413);
    }

    let body;
    try {
      const rawBody = await request.text();
      if (new TextEncoder().encode(rawBody).byteLength > MAX_BODY_BYTES) {
        return json({ ok: false, error: "Conteudo muito grande." }, 413);
      }
      body = JSON.parse(rawBody);
    } catch {
      return json({ ok: false, error: "JSON invalido." }, 400);
    }

    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return json({ ok: false, error: "Respostas invalidas." }, 400);
    }

    // Campo invisivel: bots costumam preenche-lo; pessoas nao o veem.
    if (typeof body.website === "string" && body.website.trim() !== "") {
      return json({ ok: true }, 202);
    }

    const { q1, q2, q3, q4 } = body;
    if (
      typeof q1 !== "string" || !ALLOWED_ANSWERS.q1.has(q1) ||
      typeof q2 !== "string" || !ALLOWED_ANSWERS.q2.has(q2) ||
      typeof q3 !== "string" || !ALLOWED_ANSWERS.q3.has(q3) ||
      typeof q4 !== "string" || !ALLOWED_ANSWERS.q4.has(q4)
    ) {
      return json({ ok: false, error: "Respostas invalidas." }, 400);
    }

    const id = crypto.randomUUID();
    const submittedAt = new Date().toISOString();
    const date = submittedAt.slice(0, 10);
    const record = {
      id,
      submittedAt,
      source: "beneficio-assistencial",
      answers: { q1, q2, q3, q4 },
    };

    try {
      await put(
        `beneficio-assistencial/${date}/${id}.json`,
        JSON.stringify(record),
        {
          access: "private",
          addRandomSuffix: false,
          contentType: "application/json; charset=utf-8",
        },
      );
      return json({ ok: true }, 201);
    } catch (error) {
      console.error("Falha ao registrar formulario de beneficio assistencial", error);
      return json({ ok: false, error: "Nao foi possivel registrar as respostas." }, 500);
    }
  },
};
