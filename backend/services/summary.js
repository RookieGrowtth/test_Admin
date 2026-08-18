/**
 * 质量统计聚合服务。
 * 从用例、计划、执行、缺陷中实时聚合通过率、覆盖率、冒烟完成度与发布门禁结论。
 */
import { state } from '../core/state.js';

export function summary(projectId) {
  const projectCases = state.cases.filter((c) => !projectId || c.projectId === projectId);
  const projectPlans = state.plans.filter((p) => !projectId || p.projectId === projectId);
  const projectDefects = state.defects.filter((d) => !projectId || d.projectId === projectId);
  const executions = projectPlans.flatMap((p) => p.executions || []);
  const count = (status) => executions.filter((x) => x.status === status).length;
  const passed = count('passed'); const failed = count('failed'); const blocked = count('blocked'); const skipped = count('skipped'); const total = executions.length;
  const plannedCaseIds = new Set(projectPlans.flatMap((plan) => plan.caseIds || [])); const executedCaseIds = new Set(executions.map((execution) => execution.caseId));
  const smokeCases = projectCases.filter((item) => item.smoke || (item.tags || []).includes('冒烟')); const activeDefects = projectDefects.filter((d) => !['verified', 'closed'].includes(d.status)); const critical = activeDefects.filter((d) => d.severity === 'critical').length; const major = activeDefects.filter((d) => d.severity === 'major').length;
  const passRate = total ? Math.round((passed / total) * 100) : 0; const coverage = projectCases.length ? Math.round((executedCaseIds.size / projectCases.length) * 100) : 0;
  const release = critical ? { status: 'blocked', label: '阻断发布', detail: '存在未关闭的致命缺陷，禁止进入发布环节。' } : failed || blocked ? { status: 'warning', label: '需要复测', detail: '仍存在失败或阻塞用例，应完成修复验证后再评审。' } : total === 0 ? { status: 'pending', label: '待执行', detail: '尚无执行记录，暂不能给出发布结论。' } : { status: 'ready', label: '建议发布', detail: '当前执行结果与缺陷风险满足质量门禁。' };
  return {
    generatedAt: new Date().toISOString(), projectId: projectId || 'all',
    cases: projectCases.length, plans: projectPlans.length,
    executions: { total, passed, failed, blocked, skipped, passRate },
    coverage: { planned: plannedCaseIds.size, executed: executedCaseIds.size, total: projectCases.length, rate: coverage, unexecuted: Math.max(0, projectCases.length - executedCaseIds.size) },
    smoke: { total: smokeCases.length, executed: smokeCases.filter((item) => executedCaseIds.has(item.id)).length },
    defects: { total: projectDefects.length, open: activeDefects.length, critical, major, normal: activeDefects.filter((d) => d.severity === 'normal').length },
    release,
    risks: activeDefects.filter((d) => ['critical', 'major'].includes(d.severity)).map((d) => ({ id: d.id, title: d.title, severity: d.severity, priority: d.priority, status: d.status, projectId: d.projectId }))
  };
}
