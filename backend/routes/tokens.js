/**
 * 访问令牌域路由：API Token 列表 / 创建 / 吊销。
 */
import { state, audit } from '../core/state.js';
import { need, maskToken, createApiToken } from '../core/auth.js';
import { json, failure, body } from '../lib/http.js';

export async function handle(req, res, url, ctx, parts) {
  const { auth, actor } = ctx;

  if (req.method === 'GET' && url.pathname === '/api/access-tokens') {
    if (!need(res, auth, 'token:manage')) return true;
    return json(res, 200, state.apiTokens.map(maskToken)), true;
  }

  if (req.method === 'POST' && url.pathname === '/api/access-tokens') {
    if (!need(res, auth, 'token:manage')) return true;
    const input = await body(req);
    if (!input.name) return failure(res, 422, '请填写令牌名称', 'validation_error'), true;
    const created = createApiToken(actor, input);
    return json(res, 201, { token: created.secret, item: maskToken(created.item) }), true;
  }

  if (req.method === 'DELETE' && parts[1] === 'access-tokens' && parts[2]) {
    if (!need(res, auth, 'token:manage')) return true;
    const item = state.apiTokens.find((x) => x.id === parts[2]);
    if (!item) return failure(res, 404, '访问令牌不存在', 'not_found'), true;
    item.revokedAt = new Date().toISOString();
    audit(actor, 'token.revoke', item.name);
    return json(res, 200, { revoked: true }), true;
  }

  return false;
}
