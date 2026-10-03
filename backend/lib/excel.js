/**
 * Excel / CSV 用例导入导出工具库。
 * 统一表头规范、导入行归一化、批量导入校验与工作簿渲染（含样式）。
 */
import XLSX from 'xlsx-js-style';
import { randomUUID } from 'node:crypto';
import { CASE_TYPES } from '../config/index.js';
import { state } from '../core/state.js';
import { tokenProjectAllows } from '../core/auth.js';

/* --- 导入导出表头规范 --- */
export const CASE_IMPORT_HEADERS = ['用例编号', '业务模块', '是否冒烟', '用例标题', '优先级', '前置准备', '步骤', '预期结果', '执行结果'];

/* --- 字段归一化 --- */
export function normalizeCaseType(value) { return CASE_TYPES.includes(value) ? value : 'functional'; }
export function normalizeSmoke(value) { return ['是', 'yes', 'true', '1', 'y', '冒烟'].includes(String(value ?? '').trim().toLowerCase()); }
function csvEscape(value) { const text = String(value ?? ''); return /[",\n]/.test(text) ? '"' + text.replaceAll('"', '""') + '"' : text; }

/* --- 导出行映射 --- */
export function caseExportRow(c) { return { '用例编号': c.externalId || c.id, '业务模块': c.module || '', '是否冒烟': c.smoke || (c.tags || []).includes('冒烟') ? '是' : '否', '用例标题': c.title, '优先级': c.priority || 'P1', '前置准备': c.precondition || '', '步骤': (c.steps || []).map((step) => step.action).join('\n'), '预期结果': (c.steps || []).map((step) => step.expected).join('\n'), '执行结果': c.executionResult || '' }; }
export function caseCsv(c) { return CASE_IMPORT_HEADERS.map((header) => csvEscape(caseExportRow(c)[header])).join(','); }

/* --- 工作簿渲染（带表头样式、冻结首行、自动筛选与填写说明页） --- */
export function caseWorkbook(rows = [], { template = false } = {}) {
  const sample = { '用例编号': 'TC-MT-001', '业务模块': '合约交易左侧', '是否冒烟': '是', '用例标题': 'WebSocket 连接成功', '优先级': 'P0', '前置准备': 'App / Web 已启动', '步骤': '进入行情首页\n等待 WebSocket 消息', '预期结果': '左侧行情列表加载完成\n价格与涨跌幅实时更新', '执行结果': '' };
  const data = template ? [sample] : rows.map(caseExportRow);
  const sheet = XLSX.utils.json_to_sheet(data, { header: CASE_IMPORT_HEADERS });
  sheet['!cols'] = [{ wch: 16 }, { wch: 22 }, { wch: 12 }, { wch: 32 }, { wch: 11 }, { wch: 30 }, { wch: 36 }, { wch: 46 }, { wch: 30 }];
  sheet['!rows'] = [{ hpt: 28 }, ...data.map(() => ({ hpt: 48 }))];
  sheet['!autofilter'] = { ref: `A1:I${Math.max(2, data.length + 1)}` };
  sheet['!views'] = [{ state: 'frozen', ySplit: 1, topLeftCell: 'A2', showGridLines: false }];
  for (let column = 0; column < CASE_IMPORT_HEADERS.length; column += 1) {
    const cell = sheet[XLSX.utils.encode_cell({ r: 0, c: column })];
    if (cell) cell.s = { font: { bold: true, color: { rgb: 'FFFFFF' } }, fill: { fgColor: { rgb: '1F4E78' } }, alignment: { horizontal: 'center', vertical: 'center', wrapText: true } };
  }
  for (let row = 1; row <= data.length; row += 1) for (let column = 0; column < CASE_IMPORT_HEADERS.length; column += 1) {
    const cell = sheet[XLSX.utils.encode_cell({ r: row, c: column })];
    if (cell) cell.s = { alignment: { vertical: 'top', wrapText: true }, border: { bottom: { style: 'thin', color: { rgb: 'D9E2F3' } } } };
  }
  const workbook = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(workbook, sheet, '测试用例');
  const help = XLSX.utils.aoa_to_sheet([['填写说明'], ['1. 请完整保留“测试用例”工作表的表头名称与顺序。'], ['2. 是否冒烟填写：是 或 否；优先级填写：P0 / P1 / P2 / P3。'], ['3. 多个步骤和预期结果请在同一单元格内换行，并一一对应。'], ['4. 执行结果可暂留空，执行后可补充备注。']]);
  help['!cols'] = [{ wch: 96 }]; help['!rows'] = [{ hpt: 26 }, { hpt: 32 }, { hpt: 30 }, { hpt: 42 }, { hpt: 30 }]; help['!views'] = [{ showGridLines: false }];
  for (let row = 0; row < 5; row += 1) { const cell = help[XLSX.utils.encode_cell({ r: row, c: 0 })]; if (cell) cell.s = { font: { bold: row === 0, color: { rgb: row === 0 ? 'FFFFFF' : '243B5A' } }, fill: { fgColor: { rgb: row === 0 ? '1F4E78' : 'F6F9FC' } }, alignment: { vertical: 'center', wrapText: true } }; }
  XLSX.utils.book_append_sheet(workbook, help, '填写说明');
  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx', compression: true });
}

/* --- 导入行归一化（兼容中英文表头） --- */
export function standardImportRow(row) { const title = row['用例标题'] ?? row.title; const module = row['业务模块'] ?? row.module; const precondition = row['前置准备'] ?? row.precondition; const stepText = String(row['步骤'] ?? row.steps ?? '').trim(); const expectedText = String(row['预期结果'] ?? '').trim(); const actions = stepText.split(/\r?\n/).filter(Boolean); const expected = expectedText.split(/\r?\n/).filter(Boolean); return { ...row, title, module, precondition, caseType: row.caseType, priority: row['优先级'] ?? row.priority, steps: expectedText ? actions.map((action, index) => ({ action: action.trim(), expected: (expected[index] || expected[expected.length - 1] || '').trim() })) : row.steps, externalId: row['用例编号'] ?? row.externalId, smoke: normalizeSmoke(row['是否冒烟'] ?? row.smoke), executionResult: row['执行结果'] ?? row.executionResult }; }

/* --- 批量导入校验与构建 --- */
export function createImportedCases(rows, input, auth, actor) { const imported = []; const errors = []; rows.forEach((source, index) => { const row = standardImportRow(source); const rowNumber = index + 2; const projectId = String(row.projectId || input.projectId || ''); const title = String(row.title || '').trim(); const module = String(row.module || '').trim(); const caseType = String(row.caseType || input.caseType || 'functional').trim(); const priority = String(row.priority || 'P1').trim(); const rawSteps = Array.isArray(row.steps) ? row.steps : String(row.steps || '').split(/\r?\n/).filter(Boolean); if (!projectId || !state.projects.some((item) => item.id === projectId) || !tokenProjectAllows(auth, projectId)) { errors.push({ row: rowNumber, field: 'projectId', message: '项目不存在或令牌无权访问' }); return; } if (!title) { errors.push({ row: rowNumber, field: 'title', message: '用例标题不能为空' }); return; } if (!module) { errors.push({ row: rowNumber, field: 'module', message: '业务模块不能为空' }); return; } if (!CASE_TYPES.includes(caseType)) { errors.push({ row: rowNumber, field: 'caseType', message: '用例类型必须为 functional、api、ui、performance、security 或 compatibility' }); return; } if (!['P0', 'P1', 'P2', 'P3'].includes(priority)) { errors.push({ row: rowNumber, field: 'priority', message: '优先级必须为 P0、P1、P2 或 P3' }); return; } if (!rawSteps.length) { errors.push({ row: rowNumber, field: 'steps', message: '至少需要一条测试步骤' }); return; } if (rawSteps.some(step => !validImportedStep(step))) { errors.push({ row: rowNumber, field: 'steps', message: '步骤格式不正确，请填写步骤与预期结果，或使用：操作 | 预期' }); return; } const steps = rawSteps.map((step) => { if (typeof step === 'object' && step) return { action: String(step.action || '').trim(), expected: String(step.expected || '').trim() }; const [action, ...expected] = step.split('|'); return { action: action.trim(), expected: expected.join('|').trim() }; }); const tags = Array.isArray(row.tags) ? row.tags : String(row.tags || '').split(/[|,，]/).map((tag) => tag.trim()).filter(Boolean); if (row.smoke && !tags.includes('冒烟')) tags.push('冒烟'); imported.push({ id: randomUUID(), projectId, title, module, caseType, priority, tags, precondition: String(row.precondition || ''), steps, externalId: String(row.externalId || '').trim(), smoke: Boolean(row.smoke), executionResult: String(row.executionResult || ''), status: 'active', createdBy: actor.id, createdAt: new Date().toISOString() }); }); return { imported, errors }; }

export function validImportedStep(step) {
  if (typeof step === 'string') return step.includes('|') && Boolean(step.split('|')[0].trim()) && Boolean(step.split('|').slice(1).join('|').trim());
  return Boolean(step && typeof step === 'object' && !Array.isArray(step) && String(step.action || '').trim() && String(step.expected || '').trim());
}
