/**
 * UI 自动化域路由：脚本列表 / 创建 / 更新、触发执行。
 */
import { randomUUID } from 'node:crypto';
import { state, saveState, audit } from '../core/state.js';
import { need, tokenProjectAllows } from '../core/auth.js';
import { json, failure, body, pick, asArray } from '../lib/http.js';

export async function handle(req, res, url, ctx, parts) {
  const { auth, actor } = ctx;

  if (req.method === 'GET' && url.pathname === '/api/ui-cases') {
    if (!need(res, auth, 'ui:read')) return true;
    return json(res, 200, state.uiCases.filter((c) => tokenProjectAllows(auth, c.projectId))), true;
  }

  if (req.method === 'POST' && url.pathname === '/api/ui-cases') {
    if (!need(res, auth, 'ui:write')) return true;
    const input = await body(req);
    if (!input.projectId || !input.name || !input.script) return failure(res, 422, '项目、脚本名称和 Playwright 脚本不能为空', 'validation_error'), true;
    if (!need(res, auth, 'ui:write', input.projectId)) return true;
    const item = { id: randomUUID(), projectId: input.projectId, name: input.name, framework: 'playwright', browser: input.browser || 'chromium', environment: input.environment || '测试环境', tags: asArray(input.tags), script: input.script, status: 'active', createdBy: actor.id, createdAt: new Date().toISOString(), runs: [] };
    state.uiCases.push(item);
    audit(actor, 'ui.create', item.name);
    return json(res, 201, item), true;
  }

  if (req.method === 'PUT' && parts[1] === 'ui-cases' && parts[2]) {
    const item = state.uiCases.find((c) => c.id === parts[2]);
    if (!item) return failure(res, 404, 'UI 自动化脚本不存在', 'not_found'), true;
    if (!need(res, auth, 'ui:write', item.projectId)) return true;
    Object.assign(item, pick(await body(req), ['name', 'browser', 'environment', 'tags', 'script', 'status']));
    audit(actor, 'ui.update', item.name);
    saveState(state);
    return json(res, 200, item), true;
  }

  if (req.method === 'POST' && parts[1] === 'ui-cases' && parts[2] && parts[3] === 'runs') {
    const item = state.uiCases.find((c) => c.id === parts[2]);
    if (!item) return failure(res, 404, 'UI 自动化脚本不存在', 'not_found'), true;
    if (!need(res, auth, 'ui:execute', item.projectId)) return true;
    const input = await body(req);
    const run = { id: randomUUID(), status: input.status || 'queued', duration: Number(input.duration || 0), executorId: actor.id, createdAt: new Date().toISOString(), log: String(input.log || '任务已进入队列，等待受控执行器调度。') };
    item.runs.unshift(run);
    audit(actor, 'ui.run', item.name);
    return json(res, 201, run), true;
  }

  return false;
}
