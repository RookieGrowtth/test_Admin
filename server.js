/**
 * AI-TestHub 服务入口（瘦启动器）。
 * 仅负责：请求追踪、CORS、预检、静态托管、鉴权上下文构建、路由分发与全局异常兜底。
 * 业务逻辑全部下沉至 backend/ 分层模块（config / lib / core / services / routes）。
 */
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { PORT } from './backend/config/index.js';
import { staticFile, failure } from './backend/lib/http.js';
import { readToken } from './backend/core/auth.js';
import { dispatch } from './backend/routes/index.js';

const server = http.createServer(async (req, res) => {
  res.requestId = randomUUID();
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  /* --- CORS --- */
  const origin = req.headers.origin;
  const allowed = (process.env.ALLOWED_ORIGINS || '').split(',').map((x) => x.trim()).filter(Boolean);
  if (origin && allowed.includes(origin)) res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }

  /* --- 静态资源 --- */
  if (!url.pathname.startsWith('/api/')) return staticFile(req, res, url.pathname);

  /* --- 鉴权上下文 + 路由分发 --- */
  const auth = readToken((req.headers.authorization || '').replace(/^Bearer\s+/i, ''));
  const actor = auth?.user || null;
  try {
    await dispatch(req, res, url, { auth, actor });
  } catch (error) {
    console.error(`[${res.requestId}] ${error.stack || error.message}`);
    failure(res, 400, error.message || '请求处理失败', 'bad_request');
  }
});

server.listen(PORT, '127.0.0.1', () => console.log(`AI-TestHub is running at http://localhost:${PORT}`));
