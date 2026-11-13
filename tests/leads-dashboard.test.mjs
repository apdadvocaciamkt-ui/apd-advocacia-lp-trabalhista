import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { onRequestGet } from '../functions/api/leads.js';

function createDb() {
  const calls = [];
  return {
    calls,
    prepare(sql) {
      return {
        bind(...values) {
          calls.push({ sql, values });
          return {
            async all() {
              if (sql.includes('SELECT * FROM lead_data')) {
                return { results: [{ event_id: 'lead-1', funnel: 'beneficio-assistencial', form_name: 'Maria' }] };
              }
              if (sql.includes('GROUP BY funnel')) {
                return { results: [{ funnel: 'beneficio-assistencial', count: 3 }] };
              }
              if (sql.includes("GROUP BY date")) {
                return { results: [{ date: '2026-11-12', count: 2 }] };
              }
              return { results: [] };
            },
            async first() {
              if (sql.includes('SUM(CASE WHEN form_submission_id')) {
                return { total: 4, answered: 3, active_funnels: 2 };
              }
              return { total: 1 };
            },
          };
        },
      };
    },
  };
}

test('requires the dashboard key', async () => {
  const response = await onRequestGet({
    request: new Request('https://example.com/api/leads'),
    env: { DASH_KEY: 'secret', DB: createDb() },
  });

  assert.equal(response.status, 401);
});

test('searches and filters leads on the server with bound parameters', async () => {
  const db = createDb();
  const response = await onRequestGet({
    request: new Request('https://example.com/api/leads?key=secret&days=30&limit=50&page=2&search=Maria%25&funnel=beneficio-assistencial'),
    env: { DASH_KEY: 'secret', DB: db },
  });
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.total, 4);
  assert.equal(body.filtered_total, 1);
  assert.equal(body.page, 2);
  assert.equal(body.funnel, 'beneficio-assistencial');
  assert.equal(body.leads[0].form_name, 'Maria');

  const rowQuery = db.calls.find(call => call.sql.includes('SELECT * FROM lead_data'));
  assert.ok(rowQuery);
  assert.equal(rowQuery.sql.includes('Maria'), false);
  assert.ok(rowQuery.values.includes('%maria\\%%'));
  assert.ok(rowQuery.values.includes('beneficio-assistencial'));
  assert.deepEqual(rowQuery.values.slice(-2), [50, 50]);
});

test('dashboard is lead-only and exposes search, funnel and answers', async () => {
  const html = await readFile(new URL('../dash/index.html', import.meta.url), 'utf8');

  assert.match(html, /Pesquisar nome, e-mail ou telefone/);
  assert.match(html, /Filtrar por funil/);
  assert.match(html, /Respostas do formulário/);
  assert.doesNotMatch(html, /Gross Revenue|Revenue over time|Average Order|Recent purchases|ROAS|purchase_log/i);
});
