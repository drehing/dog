'use strict';

const { uid, nowIso } = require('./util');

function publicProvider(p) {
  return {
    id: p.id,
    name: p.name,
    kind: p.kind,
    baseUrl: p.baseUrl || '',
    model: p.model || '',
    temperature: p.temperature,
    maxTokens: p.maxTokens,
    builtin: Boolean(p.builtin),
    keyUrl: p.keyUrl || '',
    hasKey: Boolean(p.apiKeyCipher),
    keyHint: p.keyHint || '',
    lastTestAt: p.lastTestAt || null,
    lastTestOk: p.lastTestOk ?? null,
    createdAt: p.createdAt,
  };
}

function sanitizeProviderInput(input = {}, existing = null) {
  const kind = ['openai', 'anthropic', 'mock'].includes(input.kind) ? input.kind : existing?.kind || 'openai';
  const name = String(input.name ?? existing?.name ?? '新模型').trim().slice(0, 60) || '新模型';
  const baseUrl = String(input.baseUrl ?? existing?.baseUrl ?? '').trim().slice(0, 500);
  const model = String(input.model ?? existing?.model ?? '').trim().slice(0, 100);
  const temperature = Math.min(2, Math.max(0, Number(input.temperature ?? existing?.temperature ?? 0.4)));
  const maxTokens = Math.min(16000, Math.max(64, Number(input.maxTokens ?? existing?.maxTokens ?? 2048)));
  if (kind !== 'mock' && !baseUrl) throw new Error('请填写 Base URL');
  if (kind !== 'mock' && !model) throw new Error('请填写模型名');
  return {
    id: existing?.id || input.id || uid('prov'),
    name,
    kind,
    baseUrl: kind === 'mock' ? '' : baseUrl,
    model: kind === 'mock' ? 'dog-demo' : model,
    temperature,
    maxTokens,
    builtin: kind === 'mock',
    keyUrl: String(input.keyUrl ?? existing?.keyUrl ?? '').slice(0, 300),
    apiKeyCipher: existing?.apiKeyCipher || '',
    keyHint: existing?.keyHint || '',
    lastTestAt: existing?.lastTestAt || null,
    lastTestOk: existing?.lastTestOk ?? null,
    createdAt: existing?.createdAt || nowIso(),
  };
}

module.exports = { publicProvider, sanitizeProviderInput };
