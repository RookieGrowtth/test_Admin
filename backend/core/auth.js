/**
 * 认证与授权核心。
 * 会话 / API Token 解析、RBAC 校验、令牌级别与项目范围收敛、数据脱敏。
 */
import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { roles, tokenKey } from '../config/index.js';
import { state, saveState, audit } from './state.js';
import { failure } from '../lib/http.js';

/* --- 数据脱敏 --- */
export function publicUser(user) {
  const { password, twoFactor, ...safe } = user;
  return { ...safe, twoFactorEnabled: Boolean(twoFactor?.enabled), roleName: roles[user.role]?.name || user.role };
}
export function maskToken(item) { const { digest, ...safe } = item; return safe; }

/* --- RBAC 与令牌范围校验 --- */
export function permitted(user, permission) {
  const grants = roles[user.role]?.permissions || [];
  return grants.includes('*') || grants.includes(permission);
}
export function tokenLevelAllows(context, permission) {
  if (!context || context.kind !== 'api') return true;
  if (context.level === 'admin') return true;
  const write = /:(write|manage|execute|export)$/.test(permission);
  return context.level === 'write' ? !permission.includes(':manage') : !write;
}
export function tokenProjectAllows(context, projectId) {
  return !context || context.kind !== 'api' || !context.projectIds.length || context.projectIds.includes(projectId);
}
export function projectVisible(context, project) {
  const actor = context.user;
  return tokenProjectAllows(context, project.id) && (permitted(actor, 'project:write') || project.members.includes(actor.id) || actor.role === 'guest');
}

/** 统一鉴权入口：角色权限 + 令牌级别 + 令牌项目范围。 */
export function need(res, context, permission, projectId = null) {
  if (!context) { failure(res, 401, '请先登录', 'unauthorized'); return false; }
  if (!permitted(context.user, permission)) { failure(res, 403, '当前角色没有此操作权限', 'forbidden'); return false; }
  if (!tokenLevelAllows(context, permission)) { failure(res, 403, '该访问令牌的级别不允许此操作', 'token_scope_denied'); return false; }
  if (projectId && !tokenProjectAllows(context, projectId)) { failure(res, 403, '该访问令牌未被授权访问此项目', 'token_project_denied'); return false; }
  return true;
}

/* --- 令牌解析 --- */
export function tokenDigest(secret) { return createHash('sha256').update(secret).digest('hex'); }

export function readToken(value) {
  if (!value) return null;
  if (value.startsWith('ath_')) {
    const apiToken = state.apiTokens.find((item) => item.digest === tokenDigest(value) && !item.revokedAt && (!item.expiresAt || new Date(item.expiresAt) > new Date()));
    if (!apiToken) return null;
    const user = state.users.find((u) => u.id === apiToken.createdBy && u.active);
    if (!user) return null;
    apiToken.lastUsedAt = new Date().toISOString(); saveState(state);
    return { user, kind: 'api', level: apiToken.level, projectIds: apiToken.projectIds, tokenId: apiToken.id };
  }
  try {
    const [payload, signature] = value.split('.');
    const expected = createHmac('sha256', tokenKey).update(payload).digest('base64url');
    if (!signature || !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString());
    if (parsed.typ !== 'session' || parsed.exp < Date.now()) return null;
    const user = state.users.find((u) => u.id === parsed.sub && u.active);
    return user && (parsed.pv ?? 0) === (user.passwordVersion || 0) ? { user, kind: 'session', level: 'admin', projectIds: [] } : null;
  } catch { return null; }
}

/* --- API Token 创建 --- */
export function createApiToken(actor, input) {
  const level = ['read', 'write', 'admin'].includes(input.level) ? input.level : 'read';
  const secret = 'ath_' + randomBytes(28).toString('base64url');
  const item = { id: randomUUID(), name: String(input.name || '').trim(), prefix: secret.slice(0, 12), digest: tokenDigest(secret), level, projectIds: Array.isArray(input.projectIds) ? [...new Set(input.projectIds)] : [], createdBy: actor.id, createdAt: new Date().toISOString(), expiresAt: input.expiresAt || null, revokedAt: null, lastUsedAt: null };
  state.apiTokens.push(item);
  audit(actor, 'token.create', item.name + ' (' + item.level + ')');
  return { item, secret };
}
