/* CloudBox plugin child runtime (CommonJS; forked, never required by main). */
'use strict';

const { existsSync, mkdirSync, readFileSync, writeFileSync } = require('node:fs');
const path = require('node:path');

const pluginDir = process.argv[2] || '';
const storageDir = process.argv[3] || '';
if (!pluginDir || !storageDir) process.exit(2);
mkdirSync(storageDir, { recursive: true });

const manifest = JSON.parse(readFileSync(path.join(pluginDir, 'manifest.json'), 'utf8'));

function send(message) {
  if (process.send) process.send(message);
}
function normalizePart(value) {
  const trimmed = String(value || '').trim();
  if (trimmed === '' || trimmed === '/') return '';
  return `/${trimmed.replace(/^\/+|\/+$/g, '')}`;
}
function createRouter() {
  const routes = [];
  const register = (method) => (routePath, handler) => {
    routes.push({ method, path: normalizePart(routePath), handler });
  };
  return {
    routes,
    get: register('GET'),
    post: register('POST'),
    put: register('PUT'),
    patch: register('PATCH'),
    delete: register('DELETE'),
    all: register('ALL'),
  };
}
const routes = [];
const aiHandlers = new Map();
const eventHandlers = new Map();
const configFile = path.join(storageDir, 'config.json');
function readConfig() {
  try {
    return JSON.parse(readFileSync(configFile, 'utf8'));
  } catch {
    return {};
  }
}
function safeStoragePath(name) {
  const target = path.resolve(storageDir, name);
  const rel = path.relative(storageDir, target);
  if (rel.startsWith('..') || path.isAbsolute(rel)) throw new Error('非法的插件存储路径');
  return target;
}
let rpcSeq = 0;
const rpcPending = new Map();
function callHost(method, ...args) {
  const id = String(++rpcSeq);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { rpcPending.delete(id); reject(new Error('插件宿主请求超时')); }, 15_000);
    rpcPending.set(id, { resolve, reject, timer });
    send({ type: 'context-request', id, method, args });
  });
}
function cronFieldMatch(field, value, min, max) {
  for (const part of String(field).split(',')) {
    const [range, stepRaw] = part.split('/');
    const step = Math.max(1, Number(stepRaw) || 1);
    const [startRaw, endRaw] = range.split('-');
    const start = startRaw === '*' ? min : Number(startRaw);
    const end = endRaw === undefined ? (startRaw === '*' ? max : start) : Number(endRaw);
    if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
    if (value >= start && value <= end && (value - start) % step === 0) return true;
  }
  return false;
}
function cronMatches(expression, date) {
  const fields = String(expression).trim().split(/\s+/);
  if (fields.length !== 5) return false;
  const [minute, hour, day, month, weekday] = fields;
  return cronFieldMatch(minute, date.getMinutes(), 0, 59) && cronFieldMatch(hour, date.getHours(), 0, 23) && cronFieldMatch(day, date.getDate(), 1, 31) && cronFieldMatch(month, date.getMonth() + 1, 1, 12) && cronFieldMatch(weekday, date.getDay(), 0, 6);
}
const cronJobs = [];
setInterval(() => {
  const now = new Date();
  for (const job of cronJobs) {
    if (cronMatches(job.expression, now) && job.lastMinute !== now.getMinutes()) {
      job.lastMinute = now.getMinutes();
      try { Promise.resolve(job.handler()).catch((error) => send({ type: 'log', level: 'error', args: [String(error)] })); } catch (error) { send({ type: 'log', level: 'error', args: [String(error)] }); }
    }
  }
}, 30_000).unref();

const ctx = {
  manifest,
  config: {
    get(key, fallback = null) { const config = readConfig(); return Object.prototype.hasOwnProperty.call(config, key) ? config[key] : fallback; },
    set(key, value) { const config = readConfig(); config[key] = value; writeFileSync(configFile, `${JSON.stringify(config, null, 2)}\n`, 'utf8'); },
  },
  schedule(expression, handler) { if (typeof expression !== 'string' || typeof handler !== 'function') throw new Error('schedule 参数不合法'); cronJobs.push({ expression, handler }); },
  system: { getStats: () => callHost('system.getStats') },
  security: { getBannedList: () => callHost('security.getBannedList') },
  user: {
    getInfo: (userId) => callHost('user.getInfo', userId),
    updateQuota: (userId, bytes) => callHost('user.updateQuota', userId, bytes),
    getMeta: (userId, key) => callHost('user.getMeta', userId, key),
    setMeta: (userId, key, value) => callHost('user.setMeta', userId, key, value),
  },
  file: {
    read: (userId, filePath) => callHost('file.read', userId, filePath),
    write: (userId, filePath, content) => callHost('file.write', userId, filePath, content),
    list: (userId, dir) => callHost('file.list', userId, dir),
    getUrl: (userId, filePath) => callHost('file.getUrl', userId, filePath),
  },
  ai: {
    registerTool(name, description, parametersSchema, handler) {
      if (typeof handler !== 'function') throw new Error('AI 工具 handler 必须是函数');
      aiHandlers.set(name, handler);
      return callHost('ai.registerTool', { name, description, parameters: parametersSchema });
    },
    injectPrompt(promptText) { return callHost('ai.injectPrompt', promptText); },
  },
  ui: { registerComponent(component) { return callHost('ui.register', component); } },

  createRouter,
  registerRouter(prefix, router) {
    let cleanPrefix = normalizePart(prefix);
    const own = `/api/plugins/${manifest.name}`;
    if (cleanPrefix.startsWith(own)) cleanPrefix = normalizePart(cleanPrefix.slice(own.length));
    for (const route of router.routes || []) {
      routes.push({ ...route, path: normalizePart(`${cleanPrefix}${route.path}`) });
    }
  },
  on(event, handler) {
    const list = eventHandlers.get(event) || [];
    list.push(handler);
    eventHandlers.set(event, list);
  },
  storage: {
    dir: storageDir,
    get(key, fallback = null) {
      const config = readConfig();
      return Object.prototype.hasOwnProperty.call(config, key) ? config[key] : fallback;
    },
    set(key, value) {
      const config = readConfig();
      config[key] = value;
      writeFileSync(configFile, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
    },
    read(name) {
      const target = safeStoragePath(name);
      return existsSync(target) ? readFileSync(target, 'utf8') : null;
    },
    write(name, value) {
      writeFileSync(safeStoragePath(name), value, 'utf8');
    },
  },
  logger: {
    info: (...args) => send({ type: 'log', level: 'info', args }),
    warn: (...args) => send({ type: 'log', level: 'warn', args }),
    error: (...args) => send({ type: 'log', level: 'error', args }),
  },
};

function matchRoute(method, requestPath) {
  for (const route of routes) {
    if (route.method !== 'ALL' && route.method !== method) continue;
    if (route.path === requestPath) return route;
    const routeParts = route.path.split('/').filter(Boolean);
    const requestParts = requestPath.split('/').filter(Boolean);
    if (routeParts.length !== requestParts.length) continue;
    let matched = true;
    for (let i = 0; i < routeParts.length; i += 1) {
      if (!routeParts[i].startsWith(':') && routeParts[i] !== requestParts[i]) {
        matched = false;
        break;
      }
    }
    if (matched) return route;
  }
  return null;
}

async function handleHttp(message) {
  const request = message.request;
  const route = matchRoute(request.method, request.path);
  if (!route) {
    send({
      type: 'http-response',
      id: message.id,
      status: 404,
      headers: { 'content-type': 'application/json' },
      body: { code: 'PLUGIN_ROUTE_NOT_FOUND', message: '插件路由不存在' },
    });
    return;
  }
  try {
    const result = await route.handler(request);
    const response =
      result && typeof result === 'object' &&
      ('status' in result || 'body' in result || 'headers' in result)
        ? result
        : { body: result };
    send({
      type: 'http-response',
      id: message.id,
      status: response.status || 200,
      headers: response.headers || {},
      body: response.body === undefined ? null : response.body,
    });
  } catch (error) {
    send({
      type: 'http-response',
      id: message.id,
      status: 500,
      headers: { 'content-type': 'application/json' },
      body: { code: 'PLUGIN_ERROR', message: error instanceof Error ? error.message : String(error) },
    });
  }
}

process.on('message', (message) => {
  if (!message) return;
  if (message.type === 'http') {
    void handleHttp(message);
    return;
  }
  if (message.type === 'context-response') {
    const pending = rpcPending.get(String(message.id));
    if (pending) {
      rpcPending.delete(String(message.id));
      clearTimeout(pending.timer);
      if (message.ok) pending.resolve(message.result);
      else pending.reject(new Error(message.error || '插件宿主调用失败'));
    }
    return;
  }
  if (message.type === 'ai-tool-call') {
    const handler = aiHandlers.get(message.name);
    Promise.resolve(handler ? handler(message.args || {}) : null).then(
      (result) => send({ type: 'ai-tool-result', id: message.id, ok: true, result }),
      (error) => send({ type: 'ai-tool-result', id: message.id, ok: false, error: error instanceof Error ? error.message : String(error) }),
    );
    return;
  }
  if (message.type === 'event') {
    for (const handler of eventHandlers.get(message.event) || []) {
      try {
        handler(message.payload);
      } catch (error) {
        send({ type: 'log', level: 'error', args: [String(error)] });
      }
    }
    return;
  }
  if (message.type === 'shutdown') process.exit(0);
});

(async () => {
  try {
    const entry = path.join(pluginDir, 'index.js');
    const mod = require(entry);
    const activate = typeof mod === 'function' ? mod : mod.activate;
    if (typeof activate !== 'function') throw new Error('插件 index.js 必须导出 activate(ctx) 函数');
    await activate(ctx);
    send({ type: 'ready', routeCount: routes.length });
  } catch (error) {
    send({ type: 'fatal', message: error && error.stack ? error.stack : String(error) });
    process.exit(1);
  }
})();
