/**
 * HTTP 基础设施。
 * 统一 JSON 响应、错误模型、请求体解析、静态文件托管、分页集合与通用小工具。
 */
import { existsSync, readFileSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { randomUUID } from 'node:crypto';
import { publicDir, templatesDir } from '../config/index.js';

/* --- 通用小工具 --- */
export function pick(source, keys) { return Object.fromEntries(keys.filter((key) => source[key] !== undefined).map((key) => [key, source[key]])); }
export function asArray(value) { return Array.isArray(value) ? value : []; }

/* --- 响应 --- */
export function json(res, status, body, requestId = null) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...(requestId ? { 'X-Request-Id': requestId } : {}) });
  res.end(JSON.stringify(body));
}
export function failure(res, status, message, code = 'request_failed', requestId = res.requestId || randomUUID(), details = undefined) {
  json(res, status, { error: { code, message, requestId, ...(details ? { details } : {}) } }, requestId);
}

/* --- 请求体解析（限制 8MB，供 Excel Base64 上传） --- */
export async function body(req) {
  let raw = '';
  for await (const part of req) { raw += part; if (raw.length > 8 * 1024 * 1024) throw new Error('请求体过大：Excel 文件最大支持 6MB'); }
  try { return raw ? JSON.parse(raw) : {}; } catch { throw new Error('Request body must be valid JSON'); }
}

/* --- 分页集合（v1 稳定集成层） --- */
export function collection(items, url, mapper = (item) => item) {
  const page = Math.max(1, Number(url.searchParams.get('page') || 1));
  const pageSize = Math.min(100, Math.max(1, Number(url.searchParams.get('pageSize') || 50)));
  const total = items.length; const offset = (page - 1) * pageSize;
  return { items: items.slice(offset, offset + pageSize).map(mapper), page, pageSize, total };
}

/* --- Excel 下载 --- */
export function sendXlsx(res, buffer, filename) {
  res.writeHead(200, { 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Content-Disposition': `attachment; filename="${filename}"`, 'Cache-Control': 'no-store' });
  res.end(buffer);
}

/* --- 静态文件与模板托管 --- */
export function staticFile(req, res, pathname) {
  if (pathname.startsWith('/templates/')) {
    const templateFile = normalize(join(templatesDir, pathname.slice('/templates/'.length)));
    if (!templateFile.startsWith(templatesDir) || !existsSync(templateFile)) { failure(res, 404, '模板不存在', 'not_found'); return; }
    res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="test-cases-template.csv"', 'Cache-Control': 'no-cache' });
    return res.end(readFileSync(templateFile));
  }
  const candidate = pathname === '/' ? '/index.html' : pathname;
  const file = normalize(join(publicDir, candidate));
  if (!file.startsWith(publicDir) || !existsSync(file)) { failure(res, 404, '页面不存在', 'not_found'); return; }
  const mime = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml' }[extname(file)] || 'application/octet-stream';
  res.writeHead(200, { 'Content-Type': mime, 'Cache-Control': 'no-cache' });
  res.end(readFileSync(file));
}
