import assert from 'node:assert/strict';
import test from 'node:test';

import { onRequestPost } from '../functions/api/beneficio-assistencial.js';

const validPayload = {
  event_id: '123e4567-e89b-42d3-a456-426614174000',
  website: '',
  name: 'Maria da Silva',
  phone: '(27) 99999-1234',
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

function createDb() {
  const state = { crm_status: 'pending', crm_contact_id: '', updates: [] };
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
              }
              if (sql.includes('SET crm_status = ?')) {
                state.crm_status = values[0];
                state.crm_contact_id = values[1];
                state.updates.push(values);
              }
              if (sql.includes("SET crm_status = 'synced'")) {
                state.crm_status = 'synced';
                state.crm_contact_id = values[0];
              }
              return { success: true };
            },
            async first() {
              return {
                crm_status: state.crm_status,
                crm_contact_id: state.crm_contact_id,
              };
            },
          };
        },
      };
    },
  };
}

test('creates a LEADS contact, adds the LP tag and stores answers as an internal note', async () => {
  const db = createDb();
  const calls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options, body: JSON.parse(options.body) });
    if (url.endsWith('/v1/contacts')) {
      return Response.json({ exist: true, id: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee', created: true });
    }
    if (url.endsWith('/v1/settings/tags')) {
      return Response.json({ contact: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee', tags: ['tag-id'] });
    }
    return Response.json({ response: 'Success', id: 'note-id' });
  };

  try {
    const response = await onRequestPost({
      request: requestFor(validPayload),
      env: {
        DB: db,
        LIDERHUB_API_KEY: 'test-key',
        LIDERHUB_CONNECTION_ID: 'connection-id',
        LIDERHUB_STATUS_ID: 'leads-status-id',
        LIDERHUB_TAG_ID: 'tag-id',
      },
    });

    assert.equal(response.status, 201);
    assert.equal(db.state.name, 'Maria da Silva');
    assert.equal(db.state.phone, '5527999991234');
    assert.equal(db.state.crm_status, 'synced');
    assert.equal(calls.length, 3);
    assert.deepEqual(calls[0].body, {
      connection: 'connection-id',
      number: '5527999991234',
      name: 'Maria da Silva',
      status: 'leads-status-id',
    });
    assert.deepEqual(calls[1].body, {
      contact: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
      tags: ['tag-id'],
      replace: false,
    });
    assert.equal(calls[2].body.note, true);
    assert.match(calls[2].body.content, /Tenho alguns documentos/);
    assert.match(calls[2].body.content, /LP \| Beneficio Assistencial/);
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
