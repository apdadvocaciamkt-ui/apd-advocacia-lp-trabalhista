import { syncBenefitLead } from '../_lib/liderhub.js';

const MAX_BODY_BYTES = 4096;
const EVENT_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ALLOWED_ANSWERS = {
  q1: new Set(['q1_o1', 'q1_o2', 'q1_o3']),
  q2: new Set(['q2_o1', 'q2_o2', 'q2_o3', 'q2_o4']),
  q3: new Set(['q3_o1', 'q3_o2', 'q3_o3']),
  q4: new Set(['q4_o1', 'q4_o2', 'q4_o3']),
};
export async function onRequestPost(context) {
  const { request, env } = context;

  if (!env.DB) return json({ ok: false, error: 'Banco indisponivel.' }, 503);
  if (!isSameOrigin(request)) return json({ ok: false, error: 'Origem nao autorizada.' }, 403);

  const contentType = request.headers.get('content-type') || '';
  if (!contentType.toLowerCase().startsWith('application/json')) {
    return json({ ok: false, error: 'Conteudo invalido.' }, 415);
  }

  const declaredLength = Number(request.headers.get('content-length') || 0);
  if (declaredLength > MAX_BODY_BYTES) {
    return json({ ok: false, error: 'Conteudo muito grande.' }, 413);
  }

  let body;
  try {
    const rawBody = await request.text();
    if (new TextEncoder().encode(rawBody).byteLength > MAX_BODY_BYTES) {
      return json({ ok: false, error: 'Conteudo muito grande.' }, 413);
    }
    body = JSON.parse(rawBody);
  } catch {
    return json({ ok: false, error: 'JSON invalido.' }, 400);
  }

  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return json({ ok: false, error: 'Respostas invalidas.' }, 400);
  }

  // Honeypot: bots recebem uma resposta neutra, sem gravacao.
  if (typeof body.website === 'string' && body.website.trim() !== '') {
    return json({ ok: true }, 202);
  }

  const { event_id: eventId, q1, q2, q3, q4 } = body;
  const name = normalizeName(body.name);
  const phone = normalizeBrazilPhone(body.phone);
  const email = normalizeEmail(body.email);
  if (
    typeof eventId !== 'string' || !EVENT_ID_PATTERN.test(eventId) ||
    !name || !phone || !email ||
    typeof q1 !== 'string' || !ALLOWED_ANSWERS.q1.has(q1) ||
    typeof q2 !== 'string' || !ALLOWED_ANSWERS.q2.has(q2) ||
    typeof q3 !== 'string' || !ALLOWED_ANSWERS.q3.has(q3) ||
    typeof q4 !== 'string' || !ALLOWED_ANSWERS.q4.has(q4)
  ) {
    return json({ ok: false, error: 'Respostas invalidas.' }, 400);
  }

  const cookies = parseCookies(request.headers.get('cookie') || '');
  const submissionId = crypto.randomUUID();
  const createdAt = Math.floor(Date.now() / 1000);

  try {
    await env.DB.prepare(`
      INSERT INTO benefit_form_submissions (
        id, event_id, session_id, name, phone, email, q1, q2, q3, q4,
        source_path, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(event_id) DO UPDATE SET
        name = excluded.name,
        phone = excluded.phone,
        email = excluded.email,
        q1 = excluded.q1,
        q2 = excluded.q2,
        q3 = excluded.q3,
        q4 = excluded.q4
    `).bind(
      submissionId,
      eventId,
      cookies._krob_sid || '',
      name,
      phone,
      email,
      q1,
      q2,
      q3,
      q4,
      '/beneficio-assistencial/',
      createdAt,
    ).run();

    await env.DB.prepare(`
      INSERT INTO benefit_form_crm_sync (event_id, status)
      VALUES (?, 'pending')
      ON CONFLICT(event_id) DO NOTHING
    `).bind(eventId).run();
  } catch (error) {
    console.error('Benefit form D1 error:', error?.message || 'unknown');
    return json({ ok: false, error: 'Nao foi possivel registrar as respostas.' }, 500);
  }

  const syncTask = syncBenefitLead(env, eventId);
  if (typeof context.waitUntil === 'function') {
    context.waitUntil(syncTask);
  } else {
    await syncTask;
  }

  return json({ ok: true, event_id: eventId }, 201);
}

export function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Cache-Control': 'no-store',
    },
  });
}

function isSameOrigin(request) {
  const origin = request.headers.get('origin');
  if (!origin) return false;
  try {
    return new URL(origin).host === new URL(request.url).host;
  } catch {
    return false;
  }
}

function parseCookies(cookieHeader) {
  const cookies = {};
  for (const part of cookieHeader.split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name) cookies[name] = rest.join('=');
  }
  return cookies;
}

function normalizeName(value) {
  if (typeof value !== 'string') return '';
  const normalized = value.trim().replace(/\s+/g, ' ');
  if (normalized.length < 2 || normalized.length > 100 || /[\u0000-\u001f\u007f]/.test(normalized)) return '';
  return normalized;
}

function normalizeBrazilPhone(value) {
  if (typeof value !== 'string') return '';
  let digits = value.replace(/\D/g, '');
  if (digits.length === 10 || digits.length === 11) digits = `55${digits}`;
  if (!/^55\d{10,11}$/.test(digits)) return '';
  return digits;
}

function normalizeEmail(value) {
  if (typeof value !== 'string') return '';
  const normalized = value.trim().toLowerCase();
  if (normalized.length < 5 || normalized.length > 254 || /[\s\u0000-\u001f\u007f]/.test(normalized)) return '';
  if (!/^[^@]+@[^@]+\.[^@]+$/.test(normalized)) return '';
  return normalized;
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
