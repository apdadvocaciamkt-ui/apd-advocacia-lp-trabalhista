import assert from 'node:assert/strict';
import test from 'node:test';

import { onRequestPost } from '../functions/api/beneficio-assistencial.js';

const validPayload = {
  event_id: '123e4567-e89b-42d3-a456-426614174000',
  website: '',
  name: 'Maria da Silva',
  phone: '(27) 99999-1234',
  email: 'Maria.Silva@Example.com',
  q1: 'q1_o1',
  q2: 'q2_o2',
  q3: 'q3_o1',
  q4: 'q4_o3',
};

function requestFor(payload) {
  return new Request('https://apdadvocacia.pages.dev/api/beneficio-assistencial', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: 'https://apdadvocacia.pages.dev',
    },
    body: JSON.stringify(payload),
  });
}

function createContext(db, env = {}) {
  const tasks = [];
  return {
    context: {
      request: requestFor(validPayload),
      env: { DB: db, ...env },
      waitUntil(promise) {
        tasks.push(promise);
      },
    },
    async finish() {
      await Promise.all(tasks);
    },
  };
}

function createDb() {
  const state = {
    writes: 0,
    syncStatus: '',
    contactId: '',
    errorCode: '',
    attempts: 0,
  };

  return {
    state,
    prepare(sql) {
      return {
        bind(...values) {
          return {
            async run() {
              if (sql.includes('INSERT INTO benefit_form_submissions')) {
                state.name = values[3];
                state.phone = values[4];
                state.email = values[5];
                state.writes += 1;
              } else if (sql.includes('INSERT INTO benefit_form_crm_sync')) {
                if (!state.syncStatus) state.syncStatus = 'pending';
              } else if (sql.includes("SET status = 'syncing'")) {
                if (state.syncStatus === 'synced') return { success: true, meta: { changes: 0 } };
                state.syncStatus = 'syncing';
                state.attempts += 1;
              } else if (sql.includes("SET status = 'synced'")) {
                state.syncStatus = 'synced';
                state.contactId = values[0];
              } else if (sql.includes('SET status = ?, contact_id = ?, error_code = ?')) {
                state.syncStatus = values[0];
                state.contactId = values[1];
                state.errorCode = values[2];
              }
              return { success: true, meta: { changes: 1 } };
            },
            async first() {
              if (sql.includes('FROM benefit_form_submissions b')) {
                return {
                  ...validPayload,
                  phone: '5527999991234',
                  email: 'maria.silva@example.com',
                  source_path: '/beneficio-assistencial/',
                  utm_source: 'meta',
                  utm_medium: 'paid_social',
                  utm_campaign: 'bpc_es',
                  utm_content: '',
                  utm_term: '',
                };
              }
              return null;
            },
          };
        },
      };
    },
  };
}

const crmEnv = {
  LIDERHUB_API_KEY: 'test-key',
  LIDERHUB_CONNECTION_ID: 'connection-id',
  LIDERHUB_STATUS_ID: 'status-id',
  LIDERHUB_TAG_ID: 'tag-id',
  LIDERHUB_SOURCE_ID: 'source-id',
};

test('stores the lead first and syncs contact, tag, source and answers to LiderHub', async () => {
  const db = createDb();
  const calls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    calls.push({ url, headers: options.headers, body: JSON.parse(options.body) });
    if (url.endsWith('/v1/contacts')) {
      return Response.json({ exist: true, id: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee', created: true });
    }
    return Response.json({ response: 'Success' });
  };

  try {
    const run = createContext(db, crmEnv);
    const response = await onRequestPost(run.context);

    assert.equal(response.status, 201);
    assert.equal(db.state.name, 'Maria da Silva');
    assert.equal(db.state.phone, '5527999991234');
    assert.equal(db.state.email, 'maria.silva@example.com');
    assert.equal(db.state.writes, 1);

    await run.finish();

    assert.equal(db.state.syncStatus, 'synced');
    assert.equal(db.state.attempts, 1);
    assert.equal(calls.length, 4);
    assert.equal(calls[0].headers['x-company-key'], 'test-key');
    assert.deepEqual(calls[0].body, {
      connection: 'connection-id',
      number: '5527999991234',
      name: 'Maria da Silva',
      email: 'maria.silva@example.com',
      status: 'status-id',
    });
    assert.deepEqual(calls[1].body, {
      contact: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
      tags: ['tag-id'],
      replace: false,
    });
    assert.deepEqual(calls[2].body, {
      contact: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
      source: 'source-id',
    });
    assert.equal(calls[3].body.note, true);
    assert.match(calls[3].body.content, /Tenho alguns documentos/);
    assert.match(calls[3].body.content, /maria\.silva@example\.com/);
    assert.match(calls[3].body.content, /utm_source: meta/);
    assert.match(calls[3].body.content, /ID do envio: 123e4567/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('keeps the D1 submission successful when the CRM is temporarily unavailable', async () => {
  const db = createDb();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response('{}', { status: 503 });

  try {
    const run = createContext(db, crmEnv);
    const response = await onRequestPost(run.context);
    assert.equal(response.status, 201);
    assert.equal(db.state.writes, 1);

    await run.finish();
    assert.equal(db.state.syncStatus, 'liderhub_http_503');
    assert.equal(db.state.errorCode, 'liderhub_http_503');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('records a configuration error without losing the form submission', async () => {
  const db = createDb();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('fetch must not run'); };

  try {
    const run = createContext(db);
    const response = await onRequestPost(run.context);
    assert.equal(response.status, 201);

    await run.finish();
    assert.equal(db.state.syncStatus, 'configuration_error');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('rejects a missing name or invalid phone before writing', async () => {
  const db = createDb();
  const response = await onRequestPost({
    request: requestFor({ ...validPayload, name: ' ', phone: '123' }),
    env: { DB: db },
  });

  assert.equal(response.status, 400);
  assert.equal(db.state.name, undefined);
});
