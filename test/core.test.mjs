import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { modelDefinitions, discover, windowsToWsl } from '../src/core.mjs';

test('context and identifiers come from server metadata; output fits context', () => {
  const models = modelDefinitions({ data: [{ id: 'different-model', max_model_len: 4096 }] }, { maxTokens: 8192 });
  assert.equal(models[0].id, 'different-model');
  assert.equal(models[0].contextWindow, 4096);
  assert.equal(models[0].maxTokens, 4095);
  assert.equal(models[0].compat.maxTokensField, 'max_completion_tokens');
  assert.equal(models[0].reasoning, true);
  assert.equal(models[0].compat.supportsReasoningEffort, true);
  assert.equal(models[0].thinkingLevelMap.off, 'none');
  assert.equal(models[0].thinkingLevelMap.high, null);
  assert.equal(models[0].thinkingLevelMap.minimal, null);
  assert.equal(models[0].thinkingLevelMap.max, null);
  assert.deepEqual(Object.entries(models[0].thinkingLevelMap).filter(([, value]) => value !== null).map(([level]) => level), ['off', 'low', 'medium', 'xhigh']);
  for (const data of [[], [{ id: 'x' }], [{ id: 'x', max_model_len: 1 }], [{ id: 'x', max_model_len: 4 }, { id: 'x', max_model_len: 4 }]])
    assert.throws(() => modelDefinitions({ data }, { maxTokens: 8192 }));
});

test('discovery reads actual endpoint and propagates cancellation', async () => {
  const server = createServer((req, res) => {
    assert.equal(req.url, '/v1/models');
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ data: [{ id: 'live-model', max_model_len: 12345 }] }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const config = { url: `http://127.0.0.1:${server.address().port}`, maxTokens: 8192 };
    assert.equal((await discover(config)).models[0].contextWindow, 12345);
    await assert.rejects(discover(config, AbortSignal.abort()));
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test('WSL package paths preserve spaces and reject non-drive paths', () => {
  assert.equal(windowsToWsl('C:\\Users\\Admin\\My Package\\engine.py'), '/mnt/c/Users/Admin/My Package/engine.py');
  assert.throws(() => windowsToWsl('\\\\host\\share\\engine.py'));
});
