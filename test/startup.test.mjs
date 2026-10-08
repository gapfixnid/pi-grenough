import { test } from 'node:test';
import assert from 'node:assert/strict';
import grenough from '../src/index.ts';
import { GrenoughEngine } from '../src/core.mjs';

test('loading and selection do no discovery or startup; requests await readiness', async () => {
  const originalRefresh = GrenoughEngine.prototype.refresh;
  const originalStart = GrenoughEngine.prototype.ensureStarted;
  let discoveries = 0, starts = 0, ready = false;
  GrenoughEngine.prototype.refresh = async () => { discoveries++; throw new Error('offline'); };
  GrenoughEngine.prototype.ensureStarted = async function () { starts++; await Promise.resolve(); ready = true; return this.models; };
  try {
    const handlers = new Map();
    const pi = { registerProvider() {}, on(name, handler) { handlers.set(name, handler); }, registerCommand() {} };
    assert.equal(grenough(pi), undefined);
    const ctx = { model: { provider: 'grenough' }, ui: { setStatus() {} } };
    await handlers.get('session_start')({}, ctx);
    await handlers.get('model_select')({ model: ctx.model }, ctx);
    assert.equal(discoveries, 0);
    assert.equal(starts, 0);
    await handlers.get('before_provider_request')({}, ctx);
    assert.equal(starts, 1);
    assert.equal(ready, true);
    await handlers.get('before_provider_request')({}, { ...ctx, model: { provider: 'other' } });
    assert.equal(starts, 1);
  } finally {
    GrenoughEngine.prototype.refresh = originalRefresh;
    GrenoughEngine.prototype.ensureStarted = originalStart;
  }
});
