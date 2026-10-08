import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { GrenoughEngine, PROVIDER } from './core.mjs';
import { registerSpeedDisplay } from './metrics.mjs';

export default function grenough(pi: ExtensionAPI) {
  const engine = new GrenoughEngine();
  const register = () => pi.registerProvider(PROVIDER, engine.providerConfig());
  register();
  const speed = registerSpeedDisplay(pi);

  const start = async (ctx: any) => {
    ctx.ui.setStatus('grenough', 'GRENOUGH: starting');
    try {
      await engine.ensureStarted();
      register();
      ctx.ui.setStatus('grenough', 'GRENOUGH: ready');
    } catch (error) {
      ctx.ui.setStatus('grenough', 'GRENOUGH: offline');
      throw error;
    }
  };

  pi.on('session_start', (_event, ctx) => {
    if (ctx.model?.provider === PROVIDER) ctx.ui.setStatus('grenough', 'GRENOUGH: starts on first request');
  });
  pi.on('model_select', (event, ctx) => {
    if (event.model.provider === PROVIDER) ctx.ui.setStatus('grenough', 'GRENOUGH: starts on first request');
    else ctx.ui.setStatus('grenough', undefined);
  });
  pi.on('before_provider_request', async (event, ctx) => {
    if (ctx.model?.provider !== PROVIDER) return;
    await start(ctx);
    speed.begin();
    return { ...(event.payload as object), timings_per_token: true };
  });
  pi.on('session_shutdown', async () => {
    if (engine.config.stopOnExit) await engine.stop(true);
  });

  pi.registerCommand('grenough', {
    description: 'GRENOUGH models and WSL engine: models, info, refresh, start, stop',
    handler: async (args, ctx) => {
      const action = args.trim() || 'models';
      try {
        if (action === 'stop') {
          ctx.ui.notify(await engine.stop() || 'GRENOUGH stopped.', 'info');
          ctx.ui.setStatus('grenough', 'GRENOUGH: stopped');
          return;
        }
        if (action === 'start') { await start(ctx); ctx.ui.notify('GRENOUGH is ready.', 'info'); return; }
        if (action === 'info' || action === 'refresh') {
          try { await engine.refresh(); register(); } catch { engine.online = false; }
          const models = engine.models.map(model => `${model.id}: context ${model.contextWindow.toLocaleString()}, max output ${model.maxTokens.toLocaleString()}, text + tools, thinking adjustable`).join('\n');
          ctx.ui.notify(`${engine.config.url}\n${engine.online ? 'Ready' : 'Offline'}; metadata: ${engine.catalogSource}\n${models}`, 'info');
          return;
        }
        if (action !== 'models') { ctx.ui.notify('Usage: /grenough [models|info|refresh|start|stop]', 'info'); return; }
        const listedModels = [...engine.models];
        const options = listedModels.map(model => `${model.id} · ${model.contextWindow.toLocaleString()} context`);
        const selected = await ctx.ui.select('GRENOUGH models', options);
        if (!selected) return;
        const id = listedModels[options.indexOf(selected)]?.id;
        const model = id && ctx.modelRegistry.find(PROVIDER, id);
        if (!model || !(await pi.setModel(model))) throw new Error('GRENOUGH model selection failed. Run /grenough refresh.');
      } catch (error) { ctx.ui.notify(error instanceof Error ? error.message : String(error), 'error'); }
    },
  });
}
