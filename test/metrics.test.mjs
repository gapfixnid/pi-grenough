import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SpeedMeter, formatTimings, parseTimings } from '../src/metrics.mjs';

test('server counts override stream-chunk counts including MTP and thinking', () => {
  let now = 100;
  const meter = new SpeedMeter(() => now);
  meter.begin();
  now = 150;
  meter.observe({ choices: [{ delta: { role: 'assistant' } }] });
  assert.equal(meter.ttftMs, undefined);
  now = 300;
  meter.observe({ choices: [{ delta: { reasoning_content: 'several tokens in one chunk' } }] });
  assert.equal(meter.ttftMs, 200);
  const metrics = meter.observe({ choices: [], usage: { completion_tokens: 100 }, timings: {
    prompt_n: 1000, prompt_ms: 200, prompt_per_second: 5000,
    predicted_n: 100, predicted_ms: 500, predicted_per_second: 198,
  } });
  assert.equal(metrics.outputTokens, 100);
  assert.equal(metrics.decodeTps, 198);
  assert.equal(formatTimings(metrics, meter.ttftMs), 'prefill 5.00k tok/s · decode 198.0 tok/s · ↓100 · TTFT 200ms');
  assert.equal(meter.paintDue(), true);
  assert.equal(meter.paintDue(), false);
  assert.equal(meter.paintDue(true), true);
  meter.begin();
  assert.equal(meter.latest, undefined);
  assert.equal(meter.ttftMs, undefined);
});

test('missing, invalid or negative timing fields cannot become reported rates', () => {
  assert.equal(parseTimings({}), undefined);
  assert.equal(parseTimings({ timings: { predicted_n: 20 } }), undefined);
  assert.equal(parseTimings({ timings: { prompt_n: 0, prompt_ms: 0, prompt_per_second: 0, predicted_n: 0, predicted_ms: 0, predicted_per_second: -1 } }), undefined);
});
