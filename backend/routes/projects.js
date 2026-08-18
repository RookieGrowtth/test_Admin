/**
 * 项目域路由：项目创建与更新（含成员管理）。
 */
import { randomUUID } from 'node:crypto';
import { state, saveState, audit } from '../core/state.js';
import { need } from '../core/auth.js';
import { json, failure, body, pick } from '../lib/http.js';

export async function handle(req, res, url, ctx, parts) {
  const { auth, actor } = ctx;

  if (req.method === 'POST' && url.pathname === '/api/projects') {
    if (!need(res, auth, 'project:write')) return true;
    const input = await body(req);
    if (!input.name || !input.code) return failure(res, 422, '项目名称和项目编码不能为空', 'validation_error'), true;
    const item = { id: randomUUID(), name: input.name.trim(), code: input.code.trim().toUpperCase(), description: String(input.description || ''), status: 'active', members: [...new Set([actor.id, ...(input.memberIds || [])])], createdAt: new Date().toISOString() };
    state.projects.push(item);
    audit(actor, 'project.create', item.name);
    return json(res, 201, item), true;
  }

  if (req.method === 'PUT' && parts[1] === 'projects' && parts[2]) {
    const item = state.projects.find((p) => p.id === parts[2]);
    if (!item) return failure(res, 404, '项目不存在', 'not_found'), true;
    if (!need(res, auth, 'project:write', item.id)) return true;
    const input = await body(req);
    Object.assign(item, pick(input, ['name', 'code', 'description', 'status']));
    if (Array.isArray(input.memberIds)) item.members = [...new Set(input.memberIds)];
    audit(actor, 'project.update', item.name);
    saveState(state);
    return json(res, 200, item), true;
  }

  return false;
}
