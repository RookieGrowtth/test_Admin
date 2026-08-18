/**
 * v1 稳定集成层路由（/api/v1/*）。
 * 面向外部系统集成：统一分页集合、UI 执行回调。
 * 该前缀下的所有请求均由本模块闭环处理（含未匹配时的 404）。
 */
import { state, saveState, audit } from '../core/state.js';
import { need, publicUser, tokenProjectAllows, projectVisible } from '../core/auth.js';
import { json, failure, body, pick, collection } from '../lib/http.js';
import { summary } from '../services/summary.js';
import { roles } from '../config/index.js';

function publicRun(item, uiCase) { return { ...item, uiCaseId: uiCase.id, uiCaseName: uiCase.name, projectId: uiCase.projectId }; }

export async function handle(req, res, url, ctx) {
  if (!url.pathname.startsWith('/api/v1/')) return false;
  const { auth, actor } = ctx;
  const v1 = url.pathname.slice('/api/v1'.length);

  if (req.method === 'GET' && v1 === '/health') return json(res, 200, { ok: true, service: 'AI-TestHub', apiVersion: 'v1', time: new Date().toISOString() }), true;
  if (req.method === 'GET' && v1 === '/me') { if (!need(res, auth, 'project:read')) return true; return json(res, 200, { user: publicUser(actor), permissions: roles[actor.role].permissions, token: { kind: auth.kind, level: auth.level, projectIds: auth.projectIds } }), true; }
  if (req.method === 'GET' && v1 === '/projects') { if (!need(res, auth, 'project:read')) return true; return json(res, 200, collection(state.projects.filter((item) => projectVisible(auth, item)), url)), true; }
  if (req.method === 'GET' && v1 === '/cases') { if (!need(res, auth, 'case:read')) return true; const projectId = url.searchParams.get('projectId'); const module = url.searchParams.get('module'); const caseType = url.searchParams.get('caseType'); return json(res, 200, collection(state.cases.filter((item) => (!projectId || item.projectId === projectId) && (!module || item.module === module) && (!caseType || item.caseType === caseType) && tokenProjectAllows(auth, item.projectId)), url)), true; }
  if (req.method === 'GET' && v1 === '/plans') { if (!need(res, auth, 'plan:read')) return true; const projectId = url.searchParams.get('projectId'); return json(res, 200, collection(state.plans.filter((item) => (!projectId || item.projectId === projectId) && tokenProjectAllows(auth, item.projectId)), url)), true; }
  if (req.method === 'GET' && v1 === '/defects') { if (!need(res, auth, 'defect:read')) return true; const projectId = url.searchParams.get('projectId'); const currentStatus = url.searchParams.get('status'); return json(res, 200, collection(state.defects.filter((item) => (!projectId || item.projectId === projectId) && (!currentStatus || item.status === currentStatus) && tokenProjectAllows(auth, item.projectId)), url)), true; }
  if (req.method === 'GET' && v1 === '/reports/summary') { if (!need(res, auth, 'report:read')) return true; const projectId = url.searchParams.get('projectId') || undefined; if (projectId && !tokenProjectAllows(auth, projectId)) return failure(res, 403, '该访问令牌未被授权访问此项目', 'token_project_denied'), true; return json(res, 200, summary(projectId)), true; }
  if (req.method === 'GET' && v1 === '/ui-cases') { if (!need(res, auth, 'ui:read')) return true; return json(res, 200, collection(state.uiCases.filter((item) => tokenProjectAllows(auth, item.projectId)), url)), true; }
  if (req.method === 'GET' && v1 === '/ui-runs') { if (!need(res, auth, 'ui:read')) return true; const currentStatus = url.searchParams.get('status'); const runs = state.uiCases.flatMap((uiCase) => (uiCase.runs || []).map((run) => publicRun(run, uiCase))).filter((run) => (!currentStatus || run.status === currentStatus) && tokenProjectAllows(auth, run.projectId)); return json(res, 200, collection(runs, url)), true; }

  const callback = v1.match(/^\/ui-runs\/([^/]+)\/callback$/);
  if (req.method === 'PATCH' && callback) {
    const found = state.uiCases.map((uiCase) => ({ uiCase, run: (uiCase.runs || []).find((run) => run.id === callback[1]) })).find((item) => item.run);
    if (!found) return failure(res, 404, 'UI 执行记录不存在', 'not_found'), true;
    if (!need(res, auth, 'ui:execute', found.uiCase.projectId)) return true;
    const input = await body(req);
    if (!['passed', 'failed', 'blocked'].includes(input.status)) return failure(res, 422, '执行回调状态必须为 passed、failed 或 blocked', 'validation_error'), true;
    Object.assign(found.run, pick(input, ['status', 'duration', 'log', 'artifactUrl']));
    found.run.completedAt = new Date().toISOString();
    audit(actor, 'ui.runner.callback', found.uiCase.name + ' / ' + found.run.status);
    saveState(state);
    return json(res, 200, publicRun(found.run, found.uiCase)), true;
  }

  if (req.method === 'GET' && v1 === '/audit-logs') { if (!need(res, auth, 'system:manage')) return true; return json(res, 200, collection(state.auditLogs, url)), true; }

  return failure(res, 404, 'v1 接口不存在，请参阅 /api/openapi.yaml', 'not_found'), true;
}
