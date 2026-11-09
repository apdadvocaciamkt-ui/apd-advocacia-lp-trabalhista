const MAX_BODY_BYTES = 4096;
const EVENT_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ALLOWED_ANSWERS = {
  q1: new Set(['q1_o1', 'q1_o2', 'q1_o3']),
  q2: new Set(['q2_o1', 'q2_o2', 'q2_o3', 'q2_o4']),
  q3: new Set(['q3_o1', 'q3_o2', 'q3_o3']),
  q4: new Set(['q4_o1', 'q4_o2', 'q4_o3']),
};
const ANSWER_LABELS = {
  q1_o1: 'Para mim',
  q1_o2: 'Para um filho ou filha',
  q1_o3: 'Para outra pessoa da familia',
  q2_o1: 'Pessoa com deficiencia ou doenca que dificulta as atividades diarias',
  q2_o2: 'Pessoa idosa com 65 anos ou mais',
  q2_o3: 'Sofreu um acidente e ficou com sequelas',
  q2_o4: 'Outra situacao',
  q3_o1: 'Sim',
  q3_o2: 'Nao',
  q3_o3: 'Nao tenho certeza',
  q4_o1: 'Sim',
  q4_o2: 'Nao',
  q4_o3: 'Tenho alguns documentos',
};
const LIDERHUB_API_URL = 'https://api.liderhub.com.br';

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
  if (
    typeof eventId !== 'string' || !EVENT_ID_PATTERN.test(eventId) ||
    !name || !phone ||
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
        id, event_id, session_id, name, phone, q1, q2, q3, q4,
        source_path, crm_status, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)
      ON CONFLICT(event_id) DO UPDATE SET
        name = excluded.name,
        phone = excluded.phone,
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
      q1,
      q2,
      q3,
      q4,
      '/beneficio-assistencial/',
      createdAt,
    ).run();

    const existing = await env.DB.prepare(`
      SELECT crm_status, crm_contact_id
      FROM benefit_form_submissions
      WHERE event_id = ?
      LIMIT 1
    `).bind(eventId).first();

    if (existing?.crm_status === 'synced' && existing.crm_contact_id) {
      return json({ ok: true, event_id: eventId }, 201);
    }
  } catch (error) {
    console.error('Benefit form D1 error:', error?.message || 'unknown');
    return json({ ok: false, error: 'Nao foi possivel registrar as respostas.' }, 500);
  }

  const requiredConfig = [
    env.LIDERHUB_API_KEY,
    env.LIDERHUB_CONNECTION_ID,
    env.LIDERHUB_STATUS_ID,
    env.LIDERHUB_TAG_ID,
  ];
  if (requiredConfig.some((value) => typeof value !== 'string' || !value.trim())) {
    await updateCrmState(env.DB, eventId, 'configuration_error', '', 'Configuracao da integracao ausente.');
    return json({ ok: false, error: 'Integracao temporariamente indisponivel.' }, 503);
  }

  let contactId = '';
  try {
    const contact = await liderhubRequest(env, '/v1/contacts', {
      method: 'POST',
      body: {
        connection: env.LIDERHUB_CONNECTION_ID,
        number: phone,
        name,
        status: env.LIDERHUB_STATUS_ID,
      },
    });

    if (!contact?.exist || typeof contact.id !== 'string') {
      await updateCrmState(env.DB, eventId, 'invalid_whatsapp', '', 'Telefone sem WhatsApp ativo.');
      return json({ ok: false, error: 'Telefone sem WhatsApp ativo.' }, 422);
    }

    contactId = contact.id;
    await updateCrmState(env.DB, eventId, 'contact_created', contactId, '');

    await liderhubRequest(env, '/v1/settings/tags', {
      method: 'PATCH',
      body: {
        contact: contactId,
        tags: [env.LIDERHUB_TAG_ID],
        replace: false,
      },
    });

    await liderhubRequest(env, '/v1/send/message', {
      method: 'POST',
      body: {
        contact: contactId,
        content: buildInternalNote({ name, phone, q1, q2, q3, q4 }),
        messageType: 'conversation',
        note: true,
      },
    });

    await env.DB.prepare(`
      UPDATE benefit_form_submissions
      SET crm_status = 'synced', crm_contact_id = ?, crm_error = '', crm_synced_at = ?
      WHERE event_id = ?
    `).bind(contactId, Math.floor(Date.now() / 1000), eventId).run();

    return json({ ok: true, event_id: eventId }, 201);
  } catch (error) {
    console.error('LiderHub sync error:', error?.message || 'unknown');
    await updateCrmState(
      env.DB,
      eventId,
      contactId ? 'crm_partial_error' : 'crm_error',
      contactId,
      'Falha ao sincronizar com o CRM.',
    );
    return json({ ok: false, error: 'Nao foi possivel enviar os dados para o atendimento.' }, 502);
  }
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

function buildInternalNote({ name, phone, q1, q2, q3, q4 }) {
  return [
    'Formulario: LP | Beneficio Assistencial',
    `Nome: ${name}`,
    `WhatsApp: +${phone}`,
    'Origem: https://apdadvocacia.pages.dev/beneficio-assistencial/',
    '',
    'Respostas:',
    `1. Para quem busca o beneficio: ${ANSWER_LABELS[q1]}`,
    `2. Situacao da pessoa: ${ANSWER_LABELS[q2]}`,
    `3. Nucleo familiar recebe Bolsa Familia: ${ANSWER_LABELS[q3]}`,
    `4. Possui laudos ou documentos medicos: ${ANSWER_LABELS[q4]}`,
  ].join('\n');
}

async function liderhubRequest(env, path, { method, body }) {
  const response = await fetch(`${LIDERHUB_API_URL}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'x-company-key': env.LIDERHUB_API_KEY,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10000),
  });

  const responseBody = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`LiderHub ${path} HTTP ${response.status}`);
  return responseBody;
}

async function updateCrmState(db, eventId, status, contactId, errorMessage) {
  try {
    await db.prepare(`
      UPDATE benefit_form_submissions
      SET crm_status = ?, crm_contact_id = ?, crm_error = ?
      WHERE event_id = ?
    `).bind(status, contactId || '', errorMessage || '', eventId).run();
  } catch (error) {
    console.error('Benefit form CRM state error:', error?.message || 'unknown');
  }
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
