/**
 * 计划域路由：测试计划创建、批量执行结果回填。
 */
import { randomUUID } from 'node:crypto';
import { state, saveState, audit } from '../core/state.js';
import { need } from '../core/auth.js';
import { json, failure, body, asArray } from '../lib/http.js';

export async function handle(req, res, url, ctx, parts) {
  const { auth, actor } = ctx;

  if (req.method === 'POST' && url.pathname === '/api/plans') {
    if (!need(res, auth, 'plan:write')) return true;
    const input = await body(req);
    if (!input.projectId || !input.name || !asArray(input.caseIds).length) return failure(res, 422, '项目、计划名称和至少一条用例不能为空', 'validation_error'), true;
    if (!need(res, auth, 'plan:write', input.projectId)) return true;
    const item = { id: randomUUID(), projectId: input.projectId, name: input.name, version: input.version || '', status: 'draft', caseIds: asArray(input.caseIds), ownerId: actor.id, createdAt: new Date().toISOString(), executions: [] };
    state.plans.push(item);
    audit(actor, 'plan.create', item.name);
    return json(res, 201, item), true;
  }

  if (req.method === 'POST' && parts[1] === 'plans' && parts[2] && parts[3] === 'executions') {
    if (!need(res, auth, 'execution:write')) return true;
    const plan = state.plans.find((p) => p.id === parts[2]);
    if (!plan) return failure(res, 404, '测试计划不存在', 'not_found'), true;
    if (!need(res, auth, 'execution:write', plan.projectId)) return true;
    const input = await body(req); const results = asArray(input.results);
    for (const result of results) {
      if (!plan.caseIds.includes(result.caseId) || !['passed', 'failed', 'blocked', 'skipped'].includes(result.status)) return failure(res, 422, '执行结果不合法', 'validation_error'), true;
      const old = plan.executions.find((e) => e.caseId === result.caseId);
      const execution = { id: old?.id || randomUUID(), caseId: result.caseId, status: result.status, note: String(result.note || ''), executorId: actor.id, executedAt: new Date().toISOString() };
      if (old) Object.assign(old, execution); else plan.executions.push(execution);
    }
    plan.status = 'in_progress';
    audit(actor, 'execution.save', plan.name);
    saveState(state);
    return json(res, 200, plan), true;
  }

  return false;
}
