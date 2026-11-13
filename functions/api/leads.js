// GET /api/leads?key=...&days=30&limit=50&page=1&search=...&funnel=...
//
// Lead-only dashboard endpoint. It keeps financial data out of the interface and
// provides server-side search, funnel filtering, pagination, totals and trend data.

const FUNNELS = new Set([
  'beneficio-assistencial',
  'previdenciario',
  'direitos-trabalhistas',
  'trabalhista',
]);

const LEAD_DATA_CTE = `
  WITH lead_data AS (
    SELECT
      e.event_id,
      e.timestamp,
      e.session_id,
      e.raw_email,
      e.browser,
      e.os,
      e.is_mobile,
      e.is_bot,
      e.bot_reason,
      s.utm_source,
      s.utm_medium,
      s.utm_campaign,
      s.utm_content,
      s.utm_term,
      s.fbclid,
      s.gclid,
      s.referrer,
      s.landing_url,
      b.id AS form_submission_id,
      b.name AS form_name,
      b.phone AS form_phone,
      b.q1,
      b.q2,
      b.q3,
      b.q4,
      b.source_path AS form_source_path,
      CASE
        WHEN COALESCE(b.source_path, '') LIKE '%beneficio-assistencial%'
          OR COALESCE(s.landing_url, '') LIKE '%/beneficio-assistencial%'
          THEN 'beneficio-assistencial'
        WHEN COALESCE(s.landing_url, '') LIKE '%/previdenciario%'
          THEN 'previdenciario'
        WHEN COALESCE(s.landing_url, '') LIKE '%/direitos%'
          THEN 'direitos-trabalhistas'
        ELSE 'trabalhista'
      END AS funnel
    FROM event_log e
    LEFT JOIN sessions s ON e.session_id = s.session_id
    LEFT JOIN benefit_form_submissions b ON e.event_id = b.event_id
    WHERE e.event_name = 'Lead'
      AND e.timestamp >= ?
      AND e.is_bot = 0
  )
`;

export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);

  const key = url.searchParams.get('key');
  if (!env.DASH_KEY || key !== env.DASH_KEY) {
    return json({ error: 'Unauthorized' }, 401);
  }

  const days = clampInt(url.searchParams.get('days'), 30, 1, 365);
  const limit = clampInt(url.searchParams.get('limit'), 50, 1, 100);
  const page = clampInt(url.searchParams.get('page'), 1, 1, 100000);
  const search = normalizeSearch(url.searchParams.get('search'));
  const requestedFunnel = normalizeSearch(url.searchParams.get('funnel'));
  const funnel = FUNNELS.has(requestedFunnel) ? requestedFunnel : '';
  const since = Math.floor(Date.now() / 1000) - days * 86400;
  const offset = (page - 1) * limit;

  const searchFilters = [];
  const searchParams = [since];
  if (search) {
    const escaped = escapeLike(search.toLowerCase());
    const digits = search.replace(/\D/g, '');
    searchFilters.push(`(
      LOWER(COALESCE(form_name, '')) LIKE ? ESCAPE '\\'
      OR LOWER(COALESCE(raw_email, '')) LIKE ? ESCAPE '\\'
      OR COALESCE(form_phone, '') LIKE ? ESCAPE '\\'
    )`);
    searchParams.push(`%${escaped}%`, `%${escaped}%`, digits ? `%${escapeLike(digits)}%` : '__no_phone_match__');
  }

  const filteredClauses = [...searchFilters];
  const filteredParams = [...searchParams];
  if (funnel) {
    filteredClauses.push('funnel = ?');
    filteredParams.push(funnel);
  }

  const searchWhere = searchFilters.length ? `WHERE ${searchFilters.join(' AND ')}` : '';
  const filteredWhere = filteredClauses.length ? `WHERE ${filteredClauses.join(' AND ')}` : '';

  try {
    const [rows, totals, filteredTotal, summary, timeSeries] = await Promise.all([
      env.DB.prepare(`${LEAD_DATA_CTE}
        SELECT * FROM lead_data
        ${filteredWhere}
        ORDER BY timestamp DESC
        LIMIT ? OFFSET ?
      `).bind(...filteredParams, limit, offset).all(),

      env.DB.prepare(`${LEAD_DATA_CTE}
        SELECT
          COUNT(*) AS total,
          SUM(CASE WHEN form_submission_id IS NOT NULL THEN 1 ELSE 0 END) AS answered,
          COUNT(DISTINCT funnel) AS active_funnels
        FROM lead_data
      `).bind(since).first(),

      env.DB.prepare(`${LEAD_DATA_CTE}
        SELECT COUNT(*) AS total
        FROM lead_data
        ${filteredWhere}
      `).bind(...filteredParams).first(),

      env.DB.prepare(`${LEAD_DATA_CTE}
        SELECT funnel, COUNT(*) AS count
        FROM lead_data
        ${searchWhere}
        GROUP BY funnel
        ORDER BY count DESC, funnel ASC
      `).bind(...searchParams).all(),

      env.DB.prepare(`${LEAD_DATA_CTE}
        SELECT date(timestamp, 'unixepoch') AS date, COUNT(*) AS count
        FROM lead_data
        ${filteredWhere}
        GROUP BY date
        ORDER BY date ASC
      `).bind(...filteredParams).all(),
    ]);

    return json({
      days,
      page,
      limit,
      search,
      funnel,
      total: Number(totals?.total || 0),
      answered: Number(totals?.answered || 0),
      active_funnels: Number(totals?.active_funnels || 0),
      filtered_total: Number(filteredTotal?.total || 0),
      leads: rows.results || [],
      summary: summary.results || [],
      time_series: timeSeries.results || [],
    });
  } catch (err) {
    return json({ error: err.message }, 500);
  }
}

function normalizeSearch(value) {
  if (typeof value !== 'string') return '';
  return value.trim().replace(/\s+/g, ' ').slice(0, 100);
}

function escapeLike(value) {
  return value.replace(/[\\%_]/g, match => `\\${match}`);
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

function clampInt(raw, fallback, min, max) {
  const n = parseInt(raw || '', 10);
  if (Number.isNaN(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}
