/**
 * AI 域路由：模型配置增改查、AI 内容生成代理。
 */
import { randomUUID } from 'node:crypto';
import { state, saveState, audit } from '../core/state.js';
import { need } from '../core/auth.js';
import { json, failure, body, pick } from '../lib/http.js';
import { encrypt } from '../lib/crypto.js';
import { maskAiConfig, publicAiModel, callAi, generateCasesWithFallback } from '../services/ai.js';
import { summary } from '../services/summary.js';
import { createImportedCases } from '../lib/excel.js';
import { startEngine, getEngineJob, listEngineJobs, cancelEngineJob, engineArtifact, listKnowledge, addKnowledge, knowledgeDetail } from '../services/legacy-generator.js';

export async function handle(req, res, url, ctx, parts) {
  const { auth, actor } = ctx;

  if (url.pathname.startsWith('/api/ai/engine/')) {
    if (!need(res, auth, 'ai:use')) return true;
    const owner = actor.id;
    try {
      if (url.pathname === '/api/ai/engine/jobs' && req.method === 'GET') return json(res, 200, listEngineJobs(owner)), true;
      if (url.pathname === '/api/ai/engine/jobs' && req.method === 'POST') {
        const input = await body(req);
        const primary = state.aiConfigs.find(c => c.id === input.configId || (!input.configId && c.enabled));
        const fallback = input.fallbackConfigId ? state.aiConfigs.find(c => c.id === input.fallbackConfigId && c.id !== primary?.id) : null;
        if (!primary || (input.fallbackConfigId && !fallback)) return failure(res, 422, '请选择有效的主模型及可选备用模型', 'validation_error'), true;
        const job = await startEngine(input, [primary, ...(fallback ? [fallback] : [])], owner);
        audit(actor, 'ai.engine.start', job.id);
        return json(res, 202, job), true;
      }
      if (url.pathname === '/api/ai/engine/knowledge') {
        if (req.method === 'GET') return json(res, 200, await listKnowledge(owner)), true;
        if (req.method === 'POST') return json(res, 201, await addKnowledge(owner, await body(req))), true;
      }
      if (url.pathname === '/api/ai/engine/knowledge/detail' && req.method === 'GET') {
        const detail=await knowledgeDetail(owner,url.searchParams.get('path')||'');
        return detail ? (json(res,200,detail),true) : (failure(res,404,'知识文件不存在','not_found'),true);
      }
      const match = /^\/api\/ai\/engine\/jobs\/([a-f0-9-]+)(\/artifact)?$/.exec(url.pathname);
      if (match) {
        if (req.method === 'DELETE' && !match[2]) return cancelEngineJob(match[1], owner) ? (json(res, 200, {cancelled:true}), true) : (failure(res,404,'任务不存在','not_found'),true);
        if (req.method === 'GET' && match[2]) {
          const path = url.searchParams.get('path') || '';
          const buffer = await engineArtifact(match[1], owner, path);
          if (!buffer) return failure(res,404,'产物不存在或任务未通过门禁','not_found'),true;
          const filename = path.split('/').pop();
          res.writeHead(200, {'Content-Type':'application/octet-stream','Content-Disposition':`attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,'Cache-Control':'no-store'});res.end(buffer);return true;
        }
        if (req.method === 'GET') {const job=getEngineJob(match[1],owner);return job ? (json(res,200,job),true) : (failure(res,404,'任务不存在','not_found'),true);}
      }
      return failure(res,404,'接口不存在','not_found'),true;
    } catch(error) {return failure(res,422,`原工具引擎：${error.message}`,'engine_error'),true;}
  }

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
    const fallback = input.task === 'test_cases' && input.fallbackConfigId
      ? state.aiConfigs.find((c) => c.id === input.fallbackConfigId && c.id !== config.id)
      : null;
    if (input.fallbackConfigId && !fallback) return failure(res, 422, '备用模型配置无效或与主模型相同', 'validation_error'), true;
    try {
      if (input.task === 'test_cases') {
        const generationAbort = new AbortController();
        const abortOnDisconnect = () => { if (!res.writableEnded) generationAbort.abort(); };
        res.on('close', abortOnDisconnect);
        let result;
        try { result = await generateCasesWithFallback(config, fallback, String(input.input || ''), generationAbort.signal); }
        finally { res.off('close', abortOnDisconnect); }
        audit(actor, 'ai.generate', `test_cases · ${result.cases.length} 条 · ${result.model}`);
        return json(res, 200, { ...result, generatedAt: new Date().toISOString() }), true;
      }
      const content = await callAi(config, input.task, String(input.input || ''), summary(input.projectId));
      audit(actor, 'ai.generate', input.task);
      return json(res, 200, { content, model: config.model, provider: config.provider, generatedAt: new Date().toISOString() }), true;
    } catch (error) {
      const details = Array.isArray(error.validationErrors) ? error.validationErrors.map((message) => ({ message })) : undefined;
      return failure(res, 502, `AI 调用失败：${error.message}`, 'ai_request_failed', res.requestId, details), true;
    }
  }

  if (req.method === 'POST' && url.pathname === '/api/ai/save-cases') {
    if (!need(res, auth, 'ai:use')) return true;
    const input = await body(req);
    const projectId = String(input.projectId || '');
    if (!projectId || !need(res, auth, 'case:write', projectId)) return projectId ? true : (failure(res, 422, '请选择归属项目', 'validation_error'), true);
    if (!Array.isArray(input.cases) || !input.cases.length) return failure(res, 422, '没有可保存的生成用例', 'validation_error'), true;
    if (input.cases.length > 300) return failure(res, 422, '单次最多保存 300 条生成用例', 'import_limit_exceeded'), true;
    const rows = input.cases.map((item) => ({
      projectId, title: item.title, module: item.module, caseType: item.caseType,
      priority: item.priority, tags: [...(Array.isArray(item.tags) ? item.tags : []), ...(item.smoke ? ['冒烟'] : [])],
      precondition: item.precondition, steps: item.steps
    }));
    const { imported, errors } = createImportedCases(rows, { projectId }, auth, actor);
    if (errors.length) return failure(res, 422, '保存失败：生成用例未通过项目数据校验', 'import_validation_error', res.requestId, errors.slice(0, 20)), true;
    state.cases.push(...imported);
    audit(actor, 'ai.test_cases.save', `项目 ${projectId} · ${imported.length} 条`);
    return json(res, 201, { saved: imported.length, cases: imported }), true;
  }

  return false;
}
