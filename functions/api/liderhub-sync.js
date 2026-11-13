import { syncBenefitLead } from '../_lib/liderhub.js';

export async function onRequestPost({ request, env }) {
  const authorization = request.headers.get('authorization') || '';
  if (!env.CRM_SYNC_KEY || authorization !== `Bearer ${env.CRM_SYNC_KEY}`) {
    return json({ ok: false, error: 'Unauthorized' }, 401);
  }
  if (!env.DB) return json({ ok: false, error: 'Banco indisponivel.' }, 503);

  const url = new URL(request.url);
  const limit = clampInt(url.searchParams.get('limit'), 25, 1, 50);

  const pending = await env.DB.prepare(`
    SELECT event_id
    FROM benefit_form_crm_sync
    WHERE status NOT IN ('synced', 'invalid_whatsapp')
    ORDER BY COALESCE(attempted_at, 0) ASC
    LIMIT ?
  `).bind(limit).all();

  const results = [];
  for (const row of pending.results || []) {
    results.push(await syncBenefitLead(env, row.event_id));
  }

  return json({
    ok: true,
    processed: results.length,
    synced: results.filter(result => result.ok && !result.skipped).length,
    skipped: results.filter(result => result.skipped).length,
    failed: results.filter(result => !result.ok).length,
  });
}

function clampInt(raw, fallback, min, max) {
  const value = Number.parseInt(raw || '', 10);
  if (Number.isNaN(value)) return fallback;
  return Math.max(min, Math.min(max, value));
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
