/**
 * 全局配置中心。
 * 集中管理运行时配置、路径、RBAC 角色与权限、用例类型枚举。
 * 后续接入环境变量校验、配置热更新时只需修改此模块。
 */
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

/* --- 路径 --- */
export const root = fileURLToPath(new URL('../../', import.meta.url));
export const publicDir = join(root, 'public');
export const dataDir = join(root, 'data');
export const legacyDataFile = join(dataDir, 'testhub.json');
export const databaseFile = join(dataDir, 'ai-testhub.db');
export const templatesDir = join(root, 'templates');
export const openapiFile = join(root, 'backend/contracts/openapi.yaml');

/* --- 运行时 --- */
export const PORT = Number(process.env.PORT || 8080);
export const appSecret = process.env.APP_SECRET || 'development-only-change-me-to-a-long-secret';
export const tokenKey = createHash('sha256').update(appSecret).digest();

/* --- RBAC 权限字典 --- */
export const permissions = {
  'system:manage': '系统设置与审计日志',
  'user:manage': '用户与角色管理',
  'project:read': '查看项目', 'project:write': '管理项目与成员',
  'case:read': '查看测试用例', 'case:write': '管理测试用例',
  'plan:read': '查看测试计划', 'plan:write': '管理测试计划', 'execution:write': '执行测试用例',
  'defect:read': '查看缺陷', 'defect:write': '提交与流转缺陷',
  'report:read': '查看测试报告', 'report:export': '导出测试报告',
  'ai:use': '使用 AI 助手', 'ai:manage': '配置 AI 模型',
  'ui:read': '查看 UI 自动化', 'ui:write': '管理 UI 自动化脚本', 'ui:execute': '执行 UI 自动化任务', 'token:manage': '管理访问令牌'
};

/* --- 预置角色 --- */
export const roles = {
  super_admin: { name: '超级管理员', permissions: ['*'] },
  project_manager: { name: '项目经理', permissions: ['project:read', 'project:write', 'case:read', 'case:write', 'plan:read', 'plan:write', 'execution:write', 'defect:read', 'defect:write', 'report:read', 'report:export', 'ai:use', 'ui:read', 'ui:write', 'ui:execute'] },
  test_lead: { name: '测试主管', permissions: ['project:read', 'project:write', 'case:read', 'case:write', 'plan:read', 'plan:write', 'execution:write', 'defect:read', 'defect:write', 'report:read', 'report:export', 'ai:use', 'ui:read', 'ui:write', 'ui:execute'] },
  tester: { name: '测试工程师', permissions: ['project:read', 'case:read', 'case:write', 'plan:read', 'execution:write', 'defect:read', 'defect:write', 'report:read', 'ai:use', 'ui:read', 'ui:write', 'ui:execute'] },
  developer: { name: '开发工程师', permissions: ['project:read', 'defect:read', 'defect:write', 'report:read', 'ai:use', 'ui:read'] },
  guest: { name: '访客（只读）', permissions: ['project:read', 'report:read', 'ui:read'] }
};

/* --- 测试用例类型 --- */
export const CASE_TYPES = ['functional', 'api', 'ui', 'performance', 'security', 'compatibility'];
export const CASE_TYPE_LABELS = { functional: '功能', api: '接口', ui: 'UI', performance: '性能', security: '安全', compatibility: '兼容性' };
