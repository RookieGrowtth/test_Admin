/**
 * 路由分发器。
 * 按领域顺序依次尝试各路由模块，任一模块返回 true 即视为已处理；
 * 全部未命中则返回统一 404。新增领域只需实现 handle() 并注册到 modules。
 */
import { failure } from '../lib/http.js';
import * as system from './system.js';
import * as v1 from './v1.js';
import * as auth from './auth.js';
import * as projects from './projects.js';
import * as cases from './cases.js';
import * as plans from './plans.js';
import * as defects from './defects.js';
import * as users from './users.js';
import * as ui from './ui.js';
import * as tokens from './tokens.js';
import * as ai from './ai.js';

const modules = [system, v1, auth, projects, cases, plans, defects, users, ui, tokens, ai];

export async function dispatch(req, res, url, ctx) {
  const parts = url.pathname.split('/').filter(Boolean);
  for (const module of modules) {
    if (await module.handle(req, res, url, ctx, parts)) return;
  }
  failure(res, 404, '接口不存在', 'not_found');
}
