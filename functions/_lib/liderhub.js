const LIDERHUB_API_URL = 'https://api.liderhub.com.br';
const SYNC_STALE_AFTER_SECONDS = 300;
const FORM_TAG_NAME = 'Formulário APD - Benefício Assistencial';
const FORM_SOURCE_NAME = 'Formulário APD - Benefício Assistencial';
const settingIdCache = new Map();

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
  q5_o1: 'Sim, ja tenho advogado e meu processo esta em andamento',
  q5_o2: 'Sim, tenho advogado, mas meu processo ainda nao foi iniciado',
  q5_o3: 'Sim, tenho processo em andamento, mas nao tenho advogado atualmente',
  q5_o4: 'Nao tenho advogado nem processo em andamento',
  q5_o5: 'Nao sei informar',
};

export async function syncBenefitLead(env, eventId) {
  let contactId = '';

  try {
    const claimed = await claimSync(env.DB, eventId);
    if (!claimed) return { ok: true, skipped: true };

    const lead = await loadLead(env.DB, eventId);
    if (!lead) throw crmError('lead_not_found', 'Lead nao encontrado no D1.');

    validateConfiguration(env);

    const formTagId = await resolveSettingId(env, {
      configuredId: env.LIDERHUB_FORM_TAG_ID,
      path: '/v1/settings/tags',
      name: FORM_TAG_NAME,
      kind: 'tag',
    });
    const formSourceId = await resolveSettingId(env, {
      configuredId: env.LIDERHUB_FORM_SOURCE_ID || env.LIDERHUB_SOURCE_ID,
      path: '/v1/settings/source',
      name: FORM_SOURCE_NAME,
      kind: 'origem',
    });

    const contactBody = {
      connection: env.LIDERHUB_CONNECTION_ID,
      number: lead.phone,
      name: lead.name,
      status: env.LIDERHUB_STATUS_ID,
    };
    if (lead.email) contactBody.email = lead.email;
    if (env.LIDERHUB_AGENT_ID) contactBody.agent = env.LIDERHUB_AGENT_ID;
    if (env.LIDERHUB_USER_ID) contactBody.user = env.LIDERHUB_USER_ID;

    const contact = await liderhubRequest(env, '/v1/contacts', {
      method: 'POST',
      body: contactBody,
    });

    if (!contact?.exist || typeof contact.id !== 'string' || !contact.id) {
      throw crmError('invalid_whatsapp', 'Telefone sem WhatsApp ativo.');
    }

    contactId = contact.id;
    await updateSyncState(env.DB, eventId, 'contact_ready', contactId, '');

    await liderhubRequest(env, '/v1/settings/tags', {
      method: 'PATCH',
      body: {
        contact: contactId,
        tags: [...new Set([env.LIDERHUB_TAG_ID, formTagId])],
        replace: false,
      },
    });

    await liderhubRequest(env, '/v1/settings/source', {
      method: 'PATCH',
      body: {
        contact: contactId,
        source: formSourceId,
      },
    });

    await liderhubRequest(env, '/v1/send/message', {
      method: 'POST',
      body: {
        contact: contactId,
        content: buildInternalNote(lead),
        messageType: 'conversation',
        note: true,
      },
    });

    await env.DB.prepare(`
      UPDATE benefit_form_crm_sync
      SET status = 'synced', contact_id = ?, error_code = '', synced_at = ?
      WHERE event_id = ?
    `).bind(contactId, nowSeconds(), eventId).run();

    return { ok: true, contact_id: contactId };
  } catch (error) {
    const errorCode = safeErrorCode(error);
    console.error('LiderHub sync error:', errorCode);
    await updateSyncState(env.DB, eventId, errorCode, contactId, errorCode);
    return { ok: false, error: errorCode };
  }
}

async function resolveSettingId(env, { configuredId, path, name, kind }) {
  if (typeof configuredId === 'string' && configuredId.trim()) return configuredId.trim();

  const cacheKey = `${env.LIDERHUB_API_KEY}:${path}:${name}`;
  const cached = settingIdCache.get(cacheKey);
  if (cached) return cached;

  const items = await liderhubRequest(env, path, { method: 'GET' });
  const match = Array.isArray(items) ? items.find(item => item?.name === name) : null;
  if (!match?.id) {
    throw crmError('configuration_error', `${kind} do formulario nao encontrada no LiderHub.`);
  }

  settingIdCache.set(cacheKey, match.id);
  return match.id;
}

async function claimSync(db, eventId) {
  const now = nowSeconds();
  const result = await db.prepare(`
    UPDATE benefit_form_crm_sync
    SET status = 'syncing', attempt_count = attempt_count + 1, attempted_at = ?, error_code = ''
    WHERE event_id = ?
      AND status != 'synced'
      AND (status != 'syncing' OR attempted_at IS NULL OR attempted_at < ?)
  `).bind(now, eventId, now - SYNC_STALE_AFTER_SECONDS).run();

  return result?.meta?.changes === 0 ? false : true;
}

async function loadLead(db, eventId) {
  return db.prepare(`
    SELECT
      b.event_id, b.name, b.phone, b.email, b.q1, b.q2, b.q3, b.q4, b.q5, b.source_path,
      s.utm_source, s.utm_medium, s.utm_campaign, s.utm_content, s.utm_term
    FROM benefit_form_submissions b
    LEFT JOIN sessions s ON s.session_id = b.session_id
    WHERE b.event_id = ?
    LIMIT 1
  `).bind(eventId).first();
}

function validateConfiguration(env) {
  const required = [
    env.LIDERHUB_API_KEY,
    env.LIDERHUB_CONNECTION_ID,
    env.LIDERHUB_STATUS_ID,
    env.LIDERHUB_TAG_ID,
  ];
  if (required.some(value => typeof value !== 'string' || !value.trim())) {
    throw crmError('configuration_error', 'Configuracao da integracao ausente.');
  }
  if (env.LIDERHUB_AGENT_ID && env.LIDERHUB_USER_ID) {
    throw crmError('configuration_error', 'Defina apenas agente ou usuario.');
  }
}

function buildInternalNote(lead) {
  const lines = [
    'Formulario: LP | Beneficio Assistencial',
    `Nome: ${lead.name}`,
    `WhatsApp: +${lead.phone}`,
    `E-mail: ${lead.email || 'Nao informado (lead anterior)'}`,
    'Origem: https://apdadvocacia.pages.dev/beneficio-assistencial/',
    `ID do envio: ${lead.event_id}`,
    '',
    'Respostas:',
    `1. Para quem busca o beneficio: ${ANSWER_LABELS[lead.q1]}`,
    `2. Situacao da pessoa: ${ANSWER_LABELS[lead.q2]}`,
    `3. Nucleo familiar recebe Bolsa Familia: ${ANSWER_LABELS[lead.q3]}`,
    `4. Possui laudos ou documentos medicos: ${ANSWER_LABELS[lead.q4]}`,
    `5. Possui advogado ou processo judicial em andamento: ${ANSWER_LABELS[lead.q5]}`,
  ];

  const utms = [
    ['utm_source', lead.utm_source],
    ['utm_medium', lead.utm_medium],
    ['utm_campaign', lead.utm_campaign],
    ['utm_content', lead.utm_content],
    ['utm_term', lead.utm_term],
  ].filter(([, value]) => typeof value === 'string' && value.trim());

  if (utms.length) {
    lines.push('', 'Atribuicao:');
    for (const [key, value] of utms) lines.push(`${key}: ${value}`);
  }

  return lines.join('\n');
}

async function liderhubRequest(env, path, { method, body }) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const response = await fetch(`${LIDERHUB_API_URL}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'x-company-key': env.LIDERHUB_API_KEY,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(10000),
    });

    const responseBody = await response.json().catch(() => ({}));
    if (response.ok) return responseBody;

    if (response.status === 429 && attempt < 2) {
      const retryAfterSeconds = Number(response.headers.get('retry-after'));
      const delayMs = Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0
        ? retryAfterSeconds * 1000
        : 500 * (attempt + 1);
      await new Promise(resolve => setTimeout(resolve, delayMs));
      continue;
    }

    throw crmError(`liderhub_http_${response.status}`, `LiderHub ${path} HTTP ${response.status}`);
  }

  throw crmError('liderhub_http_429', `LiderHub ${path} HTTP 429`);
}

async function updateSyncState(db, eventId, status, contactId, errorCode) {
  if (!db) return;
  try {
    await db.prepare(`
      UPDATE benefit_form_crm_sync
      SET status = ?, contact_id = ?, error_code = ?
      WHERE event_id = ?
    `).bind(status, contactId || '', errorCode || '', eventId).run();
  } catch (error) {
    console.error('Benefit form CRM state error:', safeErrorCode(error));
  }
}

function crmError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function safeErrorCode(error) {
  if (typeof error?.code === 'string' && /^[a-z0-9_]{1,80}$/i.test(error.code)) return error.code;
  return 'crm_error';
}

function nowSeconds() {
  return Math.floor(Date.now() / 1000);
}
