/**
 * 用户域路由：用户增改、密码重置（含会话 / 令牌联动失效）。
 */
import { randomUUID } from 'node:crypto';
import { roles } from '../config/index.js';
import { state, saveState, audit } from '../core/state.js';
import { need, publicUser } from '../core/auth.js';
import { json, failure, body, pick } from '../lib/http.js';
import { passwordRecord, validPassword } from '../lib/crypto.js';

export async function handle(req, res, url, ctx, parts) {
  const { auth, actor } = ctx;

  if (req.method === 'POST' && url.pathname === '/api/users') {
    if (!need(res, auth, 'user:manage')) return true;
    const input = await body(req);
    if (!input.username || !input.displayName || !roles[input.role] || String(input.password || '').length < 6) return failure(res, 422, '请填写用户名、姓名、有效角色和至少 6 位密码', 'validation_error'), true;
    if (state.users.some((u) => u.username === input.username)) return failure(res, 409, '用户名已存在', 'conflict'), true;
    const item = { id: randomUUID(), username: input.username, displayName: input.displayName, role: input.role, active: true, password: passwordRecord(input.password), passwordVersion: 0, twoFactor: { enabled: false }, createdAt: new Date().toISOString() };
    state.users.push(item);
    audit(actor, 'user.create', item.username);
    return json(res, 201, publicUser(item)), true;
  }

  if (req.method === 'PUT' && parts[1] === 'users' && parts[2]) {
    if (!need(res, auth, 'user:manage')) return true;
    const item = state.users.find((u) => u.id === parts[2]);
    if (!item) return failure(res, 404, '用户不存在', 'not_found'), true;
    const input = await body(req);
    if (input.role && !roles[input.role]) return failure(res, 422, '角色不存在', 'validation_error'), true;
    Object.assign(item, pick(input, ['displayName', 'role', 'active']));
    if (input.password) { item.password = passwordRecord(input.password); item.passwordVersion = (item.passwordVersion || 0) + 1; }
    audit(actor, 'user.update', item.username);
    saveState(state);
    return json(res, 200, publicUser(item)), true;
  }

  if (req.method === 'PATCH' && parts[1] === 'users' && parts[2] && parts[3] === 'password') {
    if (!need(res, auth, 'user:manage')) return true;
    const target = state.users.find((user) => user.id === parts[2]);
    if (!target) return failure(res, 404, '用户不存在', 'not_found'), true;
    const input = await body(req);
    const nextPassword = String(input.newPassword || '');
    if (nextPassword.length < 8) return failure(res, 422, '新密码至少需要 8 位字符', 'validation_error'), true;
    if (target.id === actor.id && !validPassword(input.currentPassword, target.password)) return failure(res, 422, '当前密码不正确', 'invalid_current_password'), true;
    target.password = passwordRecord(nextPassword);
    target.passwordVersion = (target.passwordVersion || 0) + 1;
    target.twoFactor = target.twoFactor || { enabled: false };
    state.apiTokens.forEach((token) => { if (token.createdBy === target.id && !token.revokedAt) token.revokedAt = new Date().toISOString(); });
    audit(actor, 'user.password.reset', target.username + (target.id === actor.id ? '（修改自身密码）' : '（管理员重置）'));
    return json(res, 200, { updated: true, targetUserId: target.id, targetUsername: target.username, forcedLogout: true, sessionInvalidated: true, revokedTokens: state.apiTokens.filter((token) => token.createdBy === target.id && token.revokedAt).length }), true;
  }

  return false;
}
