/**
 * 全局状态中心。
 * 封装 SQLite 状态仓储、初始种子数据、状态归一化与审计日志。
 * `state` 为单例可变对象，各模块直接引用并就地修改，随后调用 saveState 持久化。
 */
import { randomUUID } from 'node:crypto';
import { createSqliteStateRepository } from '../storage/sqlite-state.js';
import { dataDir, databaseFile, legacyDataFile, roles } from '../config/index.js';
import { passwordRecord } from '../lib/crypto.js';

/* --- 初始种子数据 --- */
function makeSeed() {
  const now = new Date().toISOString();
  const user = (id, username, displayName, role, password) => ({ id, username, displayName, role, active: true, password: passwordRecord(password), passwordVersion: 0, twoFactor: { enabled: false }, createdAt: now });
  return {
    roles, users: [
      user('u-admin', 'admin', '系统管理员', 'super_admin', 'admin123'),
      user('u-manager', 'manager', '陈项目', 'project_manager', 'demo123'),
      user('u-lead', 'lead', '李主管', 'test_lead', 'demo123'),
      user('u-tester', 'tester', '王测试', 'tester', 'demo123'),
      user('u-dev', 'developer', '赵开发', 'developer', 'demo123'),
      user('u-guest', 'guest', '访客', 'guest', 'demo123')
    ],
    projects: [{ id: 'p-payment', name: '支付中心 3.2', code: 'PAY-32', description: '支付、退款与风控链路回归测试', status: 'active', members: ['u-admin', 'u-manager', 'u-lead', 'u-tester', 'u-dev'], createdAt: now }],
    cases: [
      { id: 'c-login', projectId: 'p-payment', title: '手机号验证码登录', module: '账号登录', priority: 'P0', tags: ['冒烟', '认证'], precondition: '已注册的有效手机号，验证码服务正常', steps: [{ action: '输入已注册手机号并获取验证码', expected: '验证码发送成功，倒计时开始' }, { action: '输入正确验证码并点击登录', expected: '成功进入控制台，生成有效会话' }], status: 'active', createdBy: 'u-lead', createdAt: now },
      { id: 'c-refund', projectId: 'p-payment', title: '已支付订单全额退款', module: '退款', priority: 'P1', tags: ['回归', '资金'], precondition: '存在一笔支付成功且未退款的订单', steps: [{ action: '在订单详情点击全额退款', expected: '退款申请提交成功' }, { action: '查询退款结果', expected: '订单状态变为已退款，退款金额正确' }], status: 'active', createdBy: 'u-tester', createdAt: now },
      { id: 'c-risk', projectId: 'p-payment', title: '高风险交易拦截', module: '风控', priority: 'P0', tags: ['安全', '风控'], precondition: '准备命中风控规则的测试卡号', steps: [{ action: '发起高风险支付交易', expected: '交易被拒绝且显示风险提示' }], status: 'active', createdBy: 'u-lead', createdAt: now }
    ],
    plans: [{ id: 'tp-smoke', projectId: 'p-payment', name: '3.2.0 冒烟测试', version: '3.2.0', status: 'in_progress', caseIds: ['c-login', 'c-risk'], ownerId: 'u-lead', createdAt: now, executions: [{ id: 'ex-1', caseId: 'c-login', status: 'passed', note: 'Android / Chrome 验证通过', executorId: 'u-tester', executedAt: now }, { id: 'ex-2', caseId: 'c-risk', status: 'failed', note: '风险提示文案未展示', executorId: 'u-tester', executedAt: now }] }],
    defects: [{ id: 'd-risk-text', projectId: 'p-payment', planId: 'tp-smoke', caseId: 'c-risk', title: '高风险交易被拦截后未展示风险提示', description: '接口返回风控拒绝码，但前端页面仅展示通用网络异常。', severity: 'major', priority: 'P0', status: 'in_progress', assigneeId: 'u-dev', reporterId: 'u-tester', createdAt: now, updatedAt: now, comments: [{ authorId: 'u-dev', body: '已定位到错误码映射缺失，正在修复。', createdAt: now }] }],
    aiConfigs: [], uiCases: [{ id: 'ui-login', projectId: 'p-payment', name: '用户登录主流程', framework: 'playwright', browser: 'chromium', environment: '测试环境', tags: ['冒烟', 'Web'], script: "import { test, expect } from '@playwright/test';\n\ntest('用户登录主流程', async ({ page }) => {\n  await page.goto(process.env.BASE_URL);\n  await page.getByLabel('手机号').fill('13800138000');\n  await page.getByRole('button', { name: '获取验证码' }).click();\n  await expect(page.getByText('验证码已发送')).toBeVisible();\n});", status: 'active', createdBy: 'u-lead', createdAt: now, runs: [{ id: 'run-ui-1', status: 'passed', duration: 12, executorId: 'u-tester', createdAt: now, log: 'Chromium · 3 assertions passed' }] }], apiTokens: [], auditLogs: []
  };
}

/* --- 状态仓储 --- */
const stateRepository = createSqliteStateRepository({ dataDir, databaseFile, legacyDataFile, createSeed: makeSeed });
export const state = stateRepository.getState();
export function saveState(next) { stateRepository.save(next); }

/* --- 启动归一化（兼容旧数据结构） --- */
state.uiCases ||= []; state.apiTokens ||= []; state.aiConfigs ||= []; state.auditLogs ||= [];
if(!state.aiConfigs.length){state.aiConfigs.push(defaultQwenConfig());saveState(state);}
state.users.forEach((user) => { user.passwordVersion ??= 0; });
state.cases.forEach((testCase) => { testCase.caseType ||= 'functional'; });
if (!state.uiCases.length) {
  const now = new Date().toISOString();
  state.uiCases.push({ id: 'ui-login', projectId: state.projects[0]?.id || 'p-payment', name: '用户登录主流程', framework: 'playwright', browser: 'chromium', environment: '测试环境', tags: ['冒烟', 'Web'], script: "import { test, expect } from '@playwright/test';\n\ntest('用户登录主流程', async ({ page }) => {\n  await page.goto(process.env.BASE_URL);\n  await page.getByLabel('手机号').fill('13800138000');\n  await page.getByRole('button', { name: '获取验证码' }).click();\n  await expect(page.getByText('验证码已发送')).toBeVisible();\n});", status: 'active', createdBy: 'u-lead', createdAt: now, runs: [] });
  saveState(state);
}

/* --- 审计日志 --- */
export function audit(actor, action, detail) {
  state.auditLogs.unshift({ id: randomUUID(), actorId: actor?.id || 'system', action, detail, createdAt: new Date().toISOString() });
  state.auditLogs = state.auditLogs.slice(0, 500);
  saveState(state);
}
import {defaultQwenConfig} from '../services/ai-defaults.js';
