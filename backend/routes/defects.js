/**
 * 缺陷域路由：缺陷提交与流转更新（含评论）。
 */
import { randomUUID } from 'node:crypto';
import { state, saveState, audit } from '../core/state.js';
import { need } from '../core/auth.js';
import { json, failure, body, pick } from '../lib/http.js';

export async function handle(req, res, url, ctx, parts) {
  const { auth, actor } = ctx;

  if (req.method === 'POST' && url.pathname === '/api/defects') {
    if (!need(res, auth, 'defect:write')) return true;
    const input = await body(req);
    if (!input.projectId || !input.title) return failure(res, 422, '项目和缺陷标题不能为空', 'validation_error'), true;
    if (!need(res, auth, 'defect:write', input.projectId)) return true;
    const now = new Date().toISOString();
    const item = { id: randomUUID(), projectId: input.projectId, planId: input.planId || null, caseId: input.caseId || null, title: input.title, description: input.description || '', severity: input.severity || 'normal', priority: input.priority || 'P1', status: 'open', assigneeId: input.assigneeId || null, reporterId: actor.id, createdAt: now, updatedAt: now, comments: [] };
    state.defects.push(item);
    audit(actor, 'defect.create', item.title);
    return json(res, 201, item), true;
  }

  if (req.method === 'PUT' && parts[1] === 'defects' && parts[2]) {
    const item = state.defects.find((d) => d.id === parts[2]);
    if (!item) return failure(res, 404, '缺陷不存在', 'not_found'), true;
    if (!need(res, auth, 'defect:write', item.projectId)) return true;
    const input = await body(req);
    Object.assign(item, pick(input, ['title', 'description', 'severity', 'priority', 'status', 'assigneeId']));
    item.updatedAt = new Date().toISOString();
    if (input.comment) item.comments.push({ authorId: actor.id, body: String(input.comment), createdAt: item.updatedAt });
    audit(actor, 'defect.update', item.title);
    saveState(state);
    return json(res, 200, item), true;
  }

  return false;
}
