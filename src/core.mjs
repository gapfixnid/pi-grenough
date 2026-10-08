import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFileSync, writeFileSync, mkdirSync, openSync, closeSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

const execFileAsync = promisify(execFile);
export const PROVIDER = 'grenough';
export const MODEL_ID = 'GRENOUGH-Qwen3.8-27B';
export const agentDir = process.env.PI_CODING_AGENT_DIR || join(homedir(), '.pi', 'agent');
const readJson = path => { try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return {}; } };

export function readConfig() {
  const settings = readJson(join(agentDir, 'settings.json')).grenoughSettings || {};
  const config = {
    url: process.env.GRENOUGH_SERVER_URL || settings.url || 'http://127.0.0.1:8080',
    distro: settings.distro || 'Ubuntu-24.04',
    engineRoot: settings.engineRoot || '/home/admin/grenough',
    profile: settings.profile || 'mtp_k8v4',
    merge: settings.merge || 'warp',
    splitCap: settings.splitCap ?? 4,
    autoStart: settings.autoStart !== false,
    stopOnExit: settings.stopOnExit !== false,
    maxTokens: settings.maxTokens ?? 8192,
  };
  const url = new URL(config.url);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password)
    throw new Error('GRENOUGH URL must be HTTP(S), without embedded credentials.');
  config.url = url.origin + url.pathname.replace(/\/+$/, '').replace(/\/v1$/, '');
  if (!Number.isSafeInteger(config.maxTokens) || config.maxTokens < 1)
    throw new Error('GRENOUGH maxTokens must be a positive integer.');
  return config;
}

export function modelDefinitions(payload, config) {
  if (!Array.isArray(payload?.data) || payload.data.length === 0)
    throw new Error('GRENOUGH /v1/models returned no models.');
  const seen = new Set();
  return payload.data.map(entry => {
    const context = entry.max_model_len;
    if (typeof entry.id !== 'string' || !entry.id.trim() || seen.has(entry.id) ||
        !Number.isSafeInteger(context) || context < 2)
      throw new Error('Invalid model ID or max_model_len in GRENOUGH model metadata.');
    seen.add(entry.id);
    return {
      id: entry.id, name: entry.id, input: ['text'], reasoning: true,
      thinkingLevelMap: { off: 'none', minimal: null, low: 'low', medium: 'medium', high: null, xhigh: 'xhigh', max: null },
      contextWindow: context, maxTokens: Math.min(config.maxTokens, context - 1),
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      compat: {
        supportsStore: false, supportsDeveloperRole: true,
        supportsReasoningEffort: true, supportsUsageInStreaming: true,
        maxTokensField: 'max_completion_tokens',
      },
    };
  });
}

export async function discover(config, signal) {
  const signals = [AbortSignal.timeout(1500)];
  if (signal) signals.push(signal);
  const response = await fetch(`${config.url}/v1/models`, { signal: AbortSignal.any(signals) });
  if (!response.ok) throw new Error(`GRENOUGH model discovery: HTTP ${response.status}`);
  const payload = await response.json();
  return { payload, models: modelDefinitions(payload, config) };
}

export function windowsToWsl(path) {
  const match = /^([a-z]):[\\/](.*)$/i.exec(path);
  if (!match) throw new Error('GRENOUGH package must be on a Windows drive for WSL engine control.');
  return `/mnt/${match[1].toLowerCase()}/${match[2].replaceAll('\\', '/')}`;
}

export class GrenoughEngine {
  constructor(config = readConfig()) {
    this.config = config;
    this.owner = randomUUID();
    this.online = false;
    this.models = modelDefinitions({ data: [{ id: MODEL_ID, max_model_len: 262144 }] }, config);
    this.cachePath = join(agentDir, 'grenough-models.json');
    const cached = readJson(this.cachePath);
    if (cached.url === config.url) {
      try { this.models = modelDefinitions(cached.payload, config); this.catalogSource = 'cached'; } catch {}
    }
    this.catalogSource ||= 'deployment configuration';
  }

  async refresh(signal) {
    const found = await discover(this.config, signal);
    this.models = found.models;
    this.online = true;
    this.catalogSource = 'live /v1/models';
    this.lastReadyAt = Date.now();
    mkdirSync(agentDir, { recursive: true });
    writeFileSync(this.cachePath, JSON.stringify({ url: this.config.url, observedAt: new Date().toISOString(), payload: found.payload }, null, 2));
    return this.models;
  }

  helperArgs(action, ownedOnly = false) {
    const endpoint = new URL(this.config.url);
    if (process.platform !== 'win32' || endpoint.protocol !== 'http:' ||
        !['127.0.0.1', 'localhost'].includes(endpoint.hostname) || endpoint.pathname !== '/')
      throw new Error('Automatic engine control requires Windows and a local HTTP server URL.');
    const helper = windowsToWsl(fileURLToPath(new URL('../engine.py', import.meta.url)));
    const args = ['-d', this.config.distro, '-u', 'admin', '--',
      `${this.config.engineRoot}/.venv/bin/python`, helper, action,
      '--root', this.config.engineRoot, '--port', endpoint.port || '80'];
    if (action === 'start') args.push('--owner', this.owner, '--profile', this.config.profile,
      '--merge', this.config.merge, '--split-cap', String(this.config.splitCap));
    else if (ownedOnly) args.push('--owner', this.owner);
    return args;
  }

  async ensureStarted() {
    if (this.starting) return this.starting;
    if (this.online && Date.now() - this.lastReadyAt < 3000) return this.models;
    this.starting = this.start();
    try { return await this.starting; } finally { this.starting = undefined; }
  }

  async start() {
    try { return await this.refresh(); } catch { this.online = false; }
    if (!this.config.autoStart) throw new Error('GRENOUGH is offline. Start the engine or enable grenoughSettings.autoStart.');
    const args = this.helperArgs('start');
    const logDir = join(agentDir, 'logs');
    mkdirSync(logDir, { recursive: true });
    this.logPath = join(logDir, `grenough-${Date.now()}-${this.owner.slice(0, 8)}.log`);
    const fd = openSync(this.logPath, 'a');
    try { this.child = spawn('wsl.exe', args, { windowsHide: true, stdio: ['ignore', fd, fd] }); }
    finally { closeSync(fd); }
    let launchError;
    this.child.on('error', error => { launchError = error; });
    const deadline = Date.now() + 90000;
    while (Date.now() < deadline) {
      if (launchError) throw launchError;
      try { return await this.refresh(); } catch {}
      if (this.child.exitCode !== null) throw new Error(`GRENOUGH engine exited (${this.child.exitCode}). See ${this.logPath}`);
      await new Promise(resolve => setTimeout(resolve, 300));
    }
    await this.stop(true);
    throw new Error(`GRENOUGH engine startup timed out. See ${this.logPath}`);
  }

  async stop(ownedOnly = false) {
    if (ownedOnly && !this.child) return;
    const result = await execFileAsync('wsl.exe', this.helperArgs('stop', ownedOnly), { windowsHide: true, timeout: 25000 });
    this.online = false;
    return result.stdout.trim();
  }

  providerConfig() {
    return {
      name: 'GRENOUGH (WSL2)', baseUrl: `${this.config.url}/v1`,
      api: 'openai-completions', apiKey: 'local-grenough', authHeader: false,
      models: this.models, refreshModels: async context => this.refresh(context.signal),
    };
  }
}
