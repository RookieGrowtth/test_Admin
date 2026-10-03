/**
 * 用例域路由：JSON / Excel 批量导入、模板下载、导出、单条增改。
 */
import XLSX from 'xlsx-js-style';
import { randomUUID } from 'node:crypto';
import { state, saveState, audit } from '../core/state.js';
import { need, tokenProjectAllows } from '../core/auth.js';
import { json, failure, body, pick, asArray, sendXlsx } from '../lib/http.js';
import { CASE_IMPORT_HEADERS, createImportedCases, caseWorkbook, normalizeCaseType } from '../lib/excel.js';

export async function handle(req, res, url, ctx, parts) {
  const { auth, actor } = ctx;

  if (req.method === 'POST' && url.pathname === '/api/cases/import') {
    if (!need(res, auth, 'case:write')) return true;
    const input = await body(req); const rows = asArray(input.rows);
    if (!rows.length) return failure(res, 422, '导入文件中没有可用数据', 'validation_error'), true;
    if (rows.length > 1000) return failure(res, 422, '单次最多导入 1000 条测试用例', 'import_limit_exceeded'), true;
    const { imported, errors } = createImportedCases(rows, input, auth, actor);
    if (errors.length) return failure(res, 422, '导入失败：' + errors.length + ' 行数据不合法', 'import_validation_error', res.requestId, errors.slice(0, 20)), true;
    state.cases.push(...imported); audit(actor, 'case.import', '导入 ' + imported.length + ' 条用例');
    return json(res, 201, { imported: imported.length, cases: imported }), true;
  }

  if (req.method === 'POST' && url.pathname === '/api/cases/import-excel') {
    if (!need(res, auth, 'case:write')) return true;
    const input = await body(req); const projectId = String(input.projectId || ''); const base64 = String(input.fileBase64 || '').replace(/^data:[^;]+;base64,/, '');
    if (!projectId) return failure(res, 422, '请选择导入目标项目', 'validation_error'), true;
    if (!need(res, auth, 'case:write', projectId)) return true;
    if (!base64) return failure(res, 422, '请选择 Excel 文件', 'validation_error'), true;
    let rows;
    try { const workbook = XLSX.read(Buffer.from(base64, 'base64'), { type: 'buffer', cellDates: false }); const sheet = workbook.Sheets[workbook.SheetNames[0]]; rows = XLSX.utils.sheet_to_json(sheet, { defval: '', raw: false }); } catch { return failure(res, 422, 'Excel 文件无法读取，请使用 .xlsx 或 .xls 格式', 'invalid_excel'), true; }
    if (!rows.length) return failure(res, 422, 'Excel 中没有可用数据', 'validation_error'), true;
    if (rows.length > 1000) return failure(res, 422, '单次最多导入 1000 条测试用例', 'import_limit_exceeded'), true;
    const missingHeaders = CASE_IMPORT_HEADERS.filter((header) => !Object.prototype.hasOwnProperty.call(rows[0], header));
    if (missingHeaders.length) return failure(res, 422, 'Excel 表头不符合模板要求', 'excel_header_invalid', res.requestId, missingHeaders.map((field) => ({ field, message: '缺少列：' + field }))), true;
    const { imported, errors } = createImportedCases(rows, { projectId, caseType: input.caseType || 'functional' }, auth, actor);
    if (errors.length) return failure(res, 422, '导入失败：' + errors.length + ' 行数据不合法', 'import_validation_error', res.requestId, errors.slice(0, 20)), true;
    state.cases.push(...imported); audit(actor, 'case.import_excel', '导入 ' + imported.length + ' 条 Excel 用例');
    return json(res, 201, { imported: imported.length, cases: imported }), true;
  }

  if (req.method === 'GET' && url.pathname === '/api/cases/template') {
    if (!need(res, auth, 'case:write')) return true;
    sendXlsx(res, caseWorkbook([], { template: true }), 'test-case-template.xlsx');
    return true;
  }

  if (req.method === 'GET' && url.pathname === '/api/cases/export') {
    if (!need(res, auth, 'case:read')) return true;
    const type = url.searchParams.get('caseType'); const projectId = url.searchParams.get('projectId');
    const rows = state.cases.filter((item) => (!type || item.caseType === type) && (!projectId || item.projectId === projectId) && tokenProjectAllows(auth, item.projectId));
    sendXlsx(res, caseWorkbook(rows), 'test-cases.xlsx');
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/cases') {
    if (!need(res, auth, 'case:write')) return true;
    const input = await body(req);
    if (!input.projectId || !input.title) return failure(res, 422, '项目和用例标题不能为空', 'validation_error'), true;
    if (!need(res, auth, 'case:write', input.projectId)) return true;
    if (!state.projects.some(p => p.id === input.projectId)) return failure(res, 422, '项目不存在', 'validation_error'), true;
    const item = { id: randomUUID(), projectId: input.projectId, title: input.title, module: input.module || '未分类', caseType: normalizeCaseType(input.caseType), priority: input.priority || 'P1', tags: asArray(input.tags), precondition: input.precondition || '', steps: asArray(input.steps), status: 'active', createdBy: actor.id, createdAt: new Date().toISOString() };
    state.cases.push(item);
    audit(actor, 'case.create', item.title);
    return json(res, 201, item), true;
  }

  if (req.method === 'PUT' && parts[1] === 'cases' && parts[2]) {
    const item = state.cases.find((c) => c.id === parts[2]);
    if (!item) return failure(res, 404, '用例不存在', 'not_found'), true;
    if (!need(res, auth, 'case:write', item.projectId)) return true;
    Object.assign(item, pick(await body(req), ['title', 'module', 'caseType', 'priority', 'tags', 'precondition', 'steps', 'status']));
    audit(actor, 'case.update', item.title);
    saveState(state);
    return json(res, 200, item), true;
  }

  return false;
}
