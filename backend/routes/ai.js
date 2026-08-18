/**
 * AI 域路由：模型配置增改查、AI 内容生成代理。
 */
import { randomUUID } from 'node:crypto';
import { state, saveState, audit } from '../core/state.js';
import { need } from '../core/auth.js';
import { json, failure, body, pick } from '../lib/http.js';
import { encrypt } from '../lib/crypto.js';
import { maskAiConfig, callAi } from '../services/ai.js';
import { summary } from '../services/summary.js';

export async function handle(req, res, url, ctx, parts) {
  const { auth, actor } = ctx;

  if (req.method === 'GET' && url.pathname === '/api/ai-configs') {
    if (!need(res, auth, 'ai:manage')) return true;
    return json(res, 200, state.aiConfigs.map(maskAiConfig)), true;
  }

  if (req.method === 'POST' && url.pathname === '/api/ai-configs') {
    if (!need(res, auth, 'ai:manage')) return true;
    const input = await body(req);
    if (!input.name || !input.baseUrl || !input.model || !input.apiKey) return failure(res, 422, '请完整填写名称、Base URL、模型和 API Key', 'validation_error'), true;
    try { new URL(input.baseUrl); } catch { return failure(res, 422, 'Base URL 格式不正确', 'validation_error'), true; }
    const item = { id: randomUUID(), name: input.name, provider: input.provider || 'OpenAI Compatible', baseUrl: input.baseUrl.replace(/\/$/, ''), model: input.model, apiKeyEncrypted: encrypt(input.apiKey), enabled: state.aiConfigs.length === 0, createdAt: new Date().toISOString() };
    state.aiConfigs.push(item);
    audit(actor, 'ai.config.create', item.name);
    return json(res, 201, maskAiConfig(item)), true;
  }

  if (req.method === 'PUT' && parts[1] === 'ai-configs' && parts[2]) {
    if (!need(res, auth, 'ai:manage')) return true;
    const item = state.aiConfigs.find((c) => c.id === parts[2]);
    if (!item) return failure(res, 404, '模型配置不存在', 'not_found'), true;
    const input = await body(req);
    Object.assign(item, pick(input, ['name', 'provider', 'baseUrl', 'model', 'enabled']));
    if (input.apiKey) item.apiKeyEncrypted = encrypt(input.apiKey);
    if (input.enabled) state.aiConfigs.forEach((c) => { if (c.id !== item.id) c.enabled = false; });
    audit(actor, 'ai.config.update', item.name);
    saveState(state);
    return json(res, 200, maskAiConfig(item)), true;
  }

  if (req.method === 'POST' && url.pathname === '/api/ai/generate') {
    if (!need(res, auth, 'ai:use')) return true;
    const input = await body(req);
    const config = state.aiConfigs.find((c) => c.id === input.configId || (!input.configId && c.enabled));
    if (!config) return failure(res, 422, '尚未启用 AI 模型。请由超级管理员在“AI 设置”中配置 API Key。', 'ai_not_configured'), true;
    if (!['test_cases', 'defect_analysis', 'report_summary'].includes(input.task)) return failure(res, 422, '不支持的 AI 任务类型', 'validation_error'), true;
    try {
      const content = await callAi(config, input.task, String(input.input || ''), summary(input.projectId));
      audit(actor, 'ai.generate', input.task);
      return json(res, 200, { content, model: config.model, provider: config.provider, generatedAt: new Date().toISOString() }), true;
    } catch (error) {
      return failure(res, 502, `AI 调用失败：${error.message}`, 'ai_request_failed'), true;
    }
  }

  return false;
}
