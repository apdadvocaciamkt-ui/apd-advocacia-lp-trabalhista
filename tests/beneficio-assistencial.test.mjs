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
  const state = { writes: 0 };
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
                state.writes += 1;
              }
              return { success: true };
            },
          };
        },
      };
    },
  };
}

test('stores contact data and answers without depending on an external CRM', async () => {
  const db = createDb();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('External CRM must not be called'); };

  try {
    const response = await onRequestPost({
      request: requestFor(validPayload),
      env: { DB: db },
    });

    assert.equal(response.status, 201);
    assert.equal(db.state.name, 'Maria da Silva');
    assert.equal(db.state.phone, '5527999991234');
    assert.equal(db.state.writes, 1);
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
