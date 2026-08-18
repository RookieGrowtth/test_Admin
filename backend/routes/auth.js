/**
 * 认证域路由：账号登录、当前用户、双因素认证（TOTP）启用 / 确认 / 关闭。
 */
import { randomBytes } from 'node:crypto';
import { roles } from '../config/index.js';
import { state, audit } from '../core/state.js';
import { need, publicUser } from '../core/auth.js';
import { json, failure, body } from '../lib/http.js';
import { validPassword, tokenFor, verifyTotp, base32 } from '../lib/crypto.js';

export async function handle(req, res, url, ctx) {
  const { auth, actor } = ctx;

  if (req.method === 'POST' && url.pathname === '/api/auth/login') {
    const input = await body(req);
    const user = state.users.find((u) => u.username === String(input.username || '').trim());
    if (!user || !user.active || !validPassword(input.password, user.password)) return failure(res, 401, '用户名或密码错误', 'invalid_credentials'), true;
    if (user.twoFactor?.enabled && !verifyTotp(user.twoFactor.secret, input.otp)) return failure(res, 401, '请输入有效的动态验证码', 'two_factor_required'), true;
    audit(user, 'auth.login', '登录系统');
    return json(res, 200, { token: tokenFor(user), user: publicUser(user), permissions: roles[user.role].permissions }), true;
  }

  if (req.method === 'GET' && url.pathname === '/api/me') {
    if (!need(res, auth, 'project:read')) return true;
    return json(res, 200, { user: publicUser(actor), permissions: roles[actor.role].permissions, roles }), true;
  }

  if (req.method === 'POST' && url.pathname === '/api/auth/2fa/setup') {
    if (!need(res, auth, 'project:read')) return true;
    const secret = base32(randomBytes(20));
    const label = encodeURIComponent(`AI-TestHub:${actor.username}`);
    const uri = `otpauth://totp/${label}?secret=${secret}&issuer=AI-TestHub&period=30&digits=6`;
    return json(res, 200, { secret, uri, message: '请将密钥添加到 Google Authenticator 或 Microsoft Authenticator，然后提交验证码确认。' }), true;
  }

  if (req.method === 'POST' && url.pathname === '/api/auth/2fa/confirm') {
    if (!need(res, auth, 'project:read')) return true;
    const input = await body(req);
    if (!verifyTotp(input.secret, input.otp)) return failure(res, 422, '动态验证码无效，请检查时间与密钥', 'invalid_otp'), true;
    actor.twoFactor = { enabled: true, secret: input.secret };
    audit(actor, 'auth.2fa.enable', '启用双因素认证');
    return json(res, 200, { enabled: true }), true;
  }

  if (req.method === 'POST' && url.pathname === '/api/auth/2fa/disable') {
    if (!need(res, auth, 'project:read')) return true;
    actor.twoFactor = { enabled: false };
    audit(actor, 'auth.2fa.disable', '关闭双因素认证');
    return json(res, 200, { enabled: false }), true;
  }

  return false;
}
