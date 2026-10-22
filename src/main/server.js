'use strict';

const http = require('node:http');
const crypto = require('node:crypto');
const { EventEmitter } = require('node:events');
const { truncate } = require('./util');

class AgentApiServer extends EventEmitter {
  constructor({ store, agents }) {
    super();
    this.store = store;
    this.agents = agents;
    this.server = null;
    this.running = false;
    this.error = '';
    this.port = 0;
    this._starting = null;
  }

  ensureToken() {
    const s = this.store.data;
    if (!s.meta.agentApiToken) {
      this.store.mutate(() => {
        s.meta.agentApiToken = crypto.randomBytes(24).toString('hex');
      });
    }
    return s.meta.agentApiToken;
  }

  rotateToken() {
    const token = crypto.randomBytes(24).toString('hex');
    this.store.mutate((s) => {
      s.meta.agentApiToken = token;
    });
    return token;
  }

  info() {
    const settings = this.store.data.settings.agentApi;
    return {
      enabled: Boolean(settings.enabled),
      port: Number(settings.port) || 47821,
      url: this.running ? `http://127.0.0.1:${this.port}` : '',
      token: this.ensureToken(),
      running: this.running,
      error: this.error,
    };
  }

  async start() {
    if (this._starting) return this._starting;
    this._starting = this._start();
    try {
      return await this._starting;
    } finally {
      this._starting = null;
    }
  }

  async _start() {
    await this.stop();
    const settings = this.store.data.settings.agentApi;
    if (!settings.enabled) {
      this.error = '';
      return { ok: false, disabled: true };
    }
    this.ensureToken();
    const port = Math.min(65535, Math.max(1024, Number(settings.port) || 47821));
    this.port = port;
    const server = http.createServer((req, res) => this._handle(req, res));
    this.server = server;
    await new Promise((resolve) => {
      const onError = (err) => {
        this.running = false;
        this.error =
          err.code === 'EADDRINUSE' ? `端口 ${port} 已被占用，请在设置里换一个端口` : `本地接口启动失败：${err.message}`;
        this.emit('server-error', this.error);
        resolve();
      };
      server.once('error', onError);
      server.listen(port, '127.0.0.1', () => {
        server.removeListener('error', onError);
        this.running = true;
        this.error = '';
        this.port = server.address().port;
        this.emit('started', this.info());
        resolve();
      });
    });
    return { ok: this.running, ...this.info(), error: this.error };
  }

  stop() {
    return new Promise((resolve) => {
      const server = this.server;
      this.server = null;
      this.running = false;
      if (!server) return resolve();
      server.close(() => resolve());
      setTimeout(resolve, 800);
    });
  }

  async restart() {
    await this.stop();
    return this.start();
  }

  _auth(req) {
    const token = this.ensureToken();
    const auth = String(req.headers.authorization || '');
    const bearer = auth.startsWith('Bearer ') ? auth.slice(7) : '';
    const header = String(req.headers['x-dog-token'] || '');
    return bearer === token || header === token;
  }

  _json(res, status, data) {
    const body = JSON.stringify(data);
    res.writeHead(status, {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Length': Buffer.byteLength(body),
      'Cache-Control': 'no-store',
    });
    res.end(body);
  }

  async _handle(req, res) {
    const url = new URL(req.url, `http://127.0.0.1:${this.port}`);
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Dog-Token',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      });
      return res.end();
    }
    if (url.pathname === '/health') {
      return this._json(res, 200, { ok: true, app: 'dog-secretary' });
    }
    if (!this._auth(req)) {
      return this._json(res, 401, { ok: false, error: 'token 无效' });
    }
    try {
      if (req.method === 'POST' && url.pathname === '/v1/report') {
        const body = await this._readBody(req);
        if (!body || !body.runId) return this._json(res, 400, { ok: false, error: '缺少 runId' });
        const result = this.agents.report(body.runId, {
          status: body.status,
          progress: body.progress,
          message: body.message,
          summary: body.summary,
          needsAttention: body.needsAttention,
          attentionReason: body.attentionReason,
          level: body.level,
          source: 'http',
        });
        return this._json(res, 200, { ok: true, run: result });
      }
      if (req.method === 'GET' && url.pathname.startsWith('/v1/runs/')) {
        const id = decodeURIComponent(url.pathname.slice('/v1/runs/'.length));
        const run = this.agents.getRun(id);
        if (!run) return this._json(res, 404, { ok: false, error: '找不到这个任务' });
        return this._json(res, 200, { ok: true, run });
      }
      if (req.method === 'POST' && url.pathname === '/v1/ping') {
        return this._json(res, 200, { ok: true, time: new Date().toISOString() });
      }
      return this._json(res, 404, { ok: false, error: '接口不存在' });
    } catch (err) {
      return this._json(res, 400, { ok: false, error: truncate(err.message, 300) });
    }
  }

  _readBody(req) {
    return new Promise((resolve, reject) => {
      let size = 0;
      const chunks = [];
      req.on('data', (c) => {
        size += c.length;
        if (size > 256 * 1024) {
          reject(new Error('请求体太大'));
          req.destroy();
          return;
        }
        chunks.push(c);
      });
      req.on('end', () => {
        try {
          const text = Buffer.concat(chunks).toString('utf8');
          resolve(text ? JSON.parse(text) : {});
        } catch {
          reject(new Error('请求体不是合法 JSON'));
        }
      });
      req.on('error', reject);
    });
  }
}

module.exports = { AgentApiServer };
