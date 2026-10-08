import { performance } from 'node:perf_hooks';

export function parseTimings(data) {
  const t = data?.timings;
  if (!t || !['prompt_n', 'prompt_ms', 'prompt_per_second', 'predicted_n', 'predicted_ms', 'predicted_per_second'].every(key => Number.isFinite(t[key]) && t[key] >= 0)) return;
  return { prefillTokens: t.prompt_n, prefillMs: t.prompt_ms, prefillTps: t.prompt_per_second,
    outputTokens: t.predicted_n, decodeMs: t.predicted_ms, decodeTps: t.predicted_per_second };
}

export function hasGeneratedDelta(data) {
  return data?.choices?.some(choice => {
    const d = choice.delta;
    return Boolean(d?.content || d?.reasoning_content || d?.reasoning || d?.tool_calls?.some(call => call.function?.name || call.function?.arguments));
  }) || false;
}

export function formatTimings(metrics, ttftMs) {
  const rate = value => value >= 1000 ? `${(value / 1000).toFixed(2)}k` : value.toFixed(1);
  const parts = [`prefill ${rate(metrics.prefillTps)} tok/s`, `decode ${rate(metrics.decodeTps)} tok/s`, `↓${metrics.outputTokens}`];
  if (ttftMs !== undefined) parts.push(`TTFT ${Math.round(ttftMs)}ms`);
  return parts.join(' · ');
}

export class SpeedMeter {
  constructor(now = () => performance.now()) { this.now = now; }
  begin() { this.startedAt = this.now(); this.firstAt = undefined; this.latest = undefined; this.lastPaint = -Infinity; }
  observe(data) {
    if (this.startedAt === undefined) return;
    if (this.firstAt === undefined && hasGeneratedDelta(data)) this.firstAt = this.now();
    const metrics = parseTimings(data);
    if (metrics) this.latest = metrics;
    return metrics;
  }
  get ttftMs() { return this.firstAt === undefined ? undefined : Math.max(0, this.firstAt - this.startedAt); }
  paintDue(final = false) {
    const now = this.now();
    if (!final && now - this.lastPaint < 200) return false;
    this.lastPaint = now; return true;
  }
}

export function registerSpeedDisplay(pi) {
  const meter = new SpeedMeter();
  const paint = ctx => ctx.ui.setStatus('grenough-speed', formatTimings(meter.latest, meter.ttftMs));
  pi.on('provider_stream_event', (event, ctx) => {
    if (event.provider !== 'grenough') return;
    const metrics = meter.observe(event.data);
    if (metrics && meter.paintDue(Boolean(event.data?.usage))) paint(ctx);
  });
  pi.on('message_end', (event, ctx) => {
    if (event.message.role !== 'assistant' || event.message.provider !== 'grenough') return;
    if (meter.latest) paint(ctx);
  });
  pi.on('model_select', (event, ctx) => {
    if (event.model.provider !== 'grenough') ctx.ui.setStatus('grenough-speed', undefined);
  });
  return meter;
}
