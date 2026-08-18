/**
 * 系统域路由：OpenAPI 契约、健康检查、引导数据、质量报告、审计日志。
 */
import { readFileSync } from 'node:fs';
import { openapiFile, roles } from '../config/index.js';
import { state } from '../core/state.js';
import { need, publicUser, permitted, tokenLevelAllows, tokenProjectAllows, projectVisible } from '../core/auth.js';
import { json, failure, body } from '../lib/http.js';
import { summary } from '../services/summary.js';
import { reportHtml } from '../services/report.js';
import { maskAiConfig } from '../services/ai.js';

export async function handle(req, res, url, ctx) {
  const { auth, actor } = ctx;

  if (req.method === 'GET' && url.pathname === '/api/openapi.yaml') {
    res.writeHead(200, { 'Content-Type': 'application/yaml; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(readFileSync(openapiFile));
    return true;
  }

  if (req.method === 'GET' && url.pathname === '/api/health') {
    return json(res, 200, { ok: true, service: 'AI-TestHub', time: new Date().toISOString() }), true;
  }

  if (req.method === 'GET' && url.pathname === '/api/bootstrap') {
    if (!need(res, auth, 'project:read')) return true;
    const projects = state.projects.filter((p) => projectVisible(auth, p));
    const ids = new Set(projects.map((p) => p.id));
    return json(res, 200, { user: publicUser(actor), permissions: roles[actor.role].permissions, roles, projects, cases: state.cases.filter((c) => ids.has(c.projectId)), plans: state.plans.filter((p) => ids.has(p.projectId)), defects: state.defects.filter((d) => ids.has(d.projectId)), users: permitted(actor, 'user:manage') ? state.users.map(publicUser) : state.users.filter((u) => projects.some((p) => p.members.includes(u.id))).map(publicUser), aiConfigs: permitted(actor, 'ai:manage') && tokenLevelAllows(auth, 'ai:manage') ? state.aiConfigs.map(maskAiConfig) : [], uiCases: state.uiCases.filter((c) => ids.has(c.projectId) && tokenProjectAllows(auth, c.projectId)), tokenContext: auth ? { kind: auth.kind, level: auth.level, projectIds: auth.projectIds } : null, summary: summary() }), true;
  }

  if (req.method === 'GET' && url.pathname === '/api/reports/summary') {
    if (!need(res, auth, 'report:read')) return true;
    return json(res, 200, summary(url.searchParams.get('projectId') || undefined)), true;
  }

  if (req.method === 'POST' && url.pathname === '/api/reports/export') {
    if (!need(res, auth, 'report:export')) return true;
    const report = summary((await body(req)).projectId);
    return json(res, 200, { filename: 'quality-report.html', html: reportHtml(report) }), true;
  }

  if (req.method === 'GET' && url.pathname === '/api/audit-logs') {
    if (!need(res, auth, 'system:manage')) return true;
    return json(res, 200, state.auditLogs), true;
  }

  return false;
}
