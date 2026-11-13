const LIDERHUB_API_URL = 'https://api.liderhub.com.br';
const SYNC_STALE_AFTER_SECONDS = 300;

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

export async function syncBenefitLead(env, eventId) {
  let contactId = '';

  try {
    const claimed = await claimSync(env.DB, eventId);
    if (!claimed) return { ok: true, skipped: true };

    const lead = await loadLead(env.DB, eventId);
    if (!lead) throw crmError('lead_not_found', 'Lead nao encontrado no D1.');

    validateConfiguration(env);

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
        tags: [env.LIDERHUB_TAG_ID],
        replace: false,
      },
    });

    if (env.LIDERHUB_SOURCE_ID) {
      await liderhubRequest(env, '/v1/settings/source', {
        method: 'PATCH',
        body: {
          contact: contactId,
          source: env.LIDERHUB_SOURCE_ID,
        },
      });
    }

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
      b.event_id, b.name, b.phone, b.email, b.q1, b.q2, b.q3, b.q4, b.source_path,
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
  if (!response.ok) throw crmError(`liderhub_http_${response.status}`, `LiderHub ${path} HTTP ${response.status}`);
  return responseBody;
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
