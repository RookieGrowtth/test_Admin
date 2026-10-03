import test from 'node:test';
import assert from 'node:assert/strict';

process.env.APP_SECRET = 'ai-generation-unit-test-secret-not-for-production';
const { encrypt } = await import('../backend/lib/crypto.js');
const { generateCasesWithFallback, validateGeneratedCases } = await import('../backend/services/ai.js');

const source = '用户使用邮箱和密码登录，认证成功后进入账户首页。';
const requirement = {
  module: '账号登录', title: '邮箱密码登录', source_quote: source,
  preconditions: ['用户已注册'], trigger: '提交邮箱和密码',
  observable_results: ['进入账户首页'], exceptions: [], open_questions: []
};

function sse(content) {
  const encoder = new TextEncoder();
  const frames = [
    { choices: [{ delta: { content }, finish_reason: null }] },
    { choices: [{ delta: {}, finish_reason: 'stop' }] }
  ].map((item) => `data: ${JSON.stringify(item)}\n\n`).join('') + 'data: [DONE]\n\n';
  return new Response(new ReadableStream({ start(controller) { controller.enqueue(encoder.encode(frames)); controller.close(); } }), {
    headers: { 'Content-Type': 'text/event-stream' }
  });
}

function generationResponse(kind) {
  const value = kind === 'extract'
    ? { requirements: [requirement] }
    : { test_cases: [{ module: '账号登录', title: '有效邮箱和密码登录成功', caseType: 'functional', priority: 'P1', smoke: true, precondition: '已注册有效用户', tags: [], requirement_ids: ['REQ-001'], steps: [{ action: '输入有效邮箱和密码并提交登录', expected: '系统认证成功并进入账户首页' }] }] };
  return sse(JSON.stringify(value));
}

const config = (id, name, enabled = false) => ({
  id, name, enabled, provider: 'test-provider', model: id, baseUrl: 'https://models.invalid/v1', apiKeyEncrypted: encrypt('test-key')
});

test('quality gate accepts grounded and fully traceable generated cases', () => {
  const cases = [{ module: '账号登录', title: '有效邮箱和密码登录成功', caseType: 'functional', priority: 'P1', smoke: true,
    precondition: '已注册有效用户', tags: [], requirement_ids: ['REQ-001'],
    steps: [{ action: '提交有效邮箱和密码', expected: '进入账户首页' }] }];
  const result = validateGeneratedCases(cases, [{ id: 'REQ-001' }]);
  assert.deepEqual(result.errors, []);
  assert.equal(result.cases[0].tags.includes('REQ-001'), true);
});

test('quality gate blocks missing requirement coverage and duplicate cases', () => {
  const candidate = { module: '账号登录', title: '有效登录', caseType: 'functional', priority: 'P1', precondition: '有账户',
    requirement_ids: ['REQ-001'], steps: [{ action: '提交', expected: '成功' }] };
  const result = validateGeneratedCases([candidate, { ...candidate }], [{ id: 'REQ-001' }, { id: 'REQ-002' }]);
  assert.ok(result.errors.some((error) => error.includes('REQ-002')));
  assert.ok(result.errors.some((error) => error.includes('重复')));
});

test('quality gate rejects unsupported numeric thresholds', () => {
  const result = validateGeneratedCases([{
    module: '额度校验', title: '检查额度限制', caseType: 'functional', priority: 'P1', precondition: '账户可用',
    requirement_ids: ['REQ-001'], steps: [{ action: '提交金额 10000', expected: '系统接受该金额' }]
  }], [{ id: 'REQ-001', source_quote: '单笔金额不得超过 1000 元。', preconditions: [], observable_results: [], exceptions: [] }]);
  assert.ok(result.errors.some((error) => error.includes('未支持的数字或阈值')));
});

test('generation uses the completed SSE response and returns a preview without persistence', async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  const calls = [];
  globalThis.fetch = async (_url, options) => {
    const payload = JSON.parse(options.body); calls.push(payload);
    const kind = payload.messages[0].content.includes('需求分析师') ? 'extract' : 'generate';
    return generationResponse(kind);
  };
  const result = await generateCasesWithFallback(config('primary', '主模型', true), null, source);
  assert.equal(calls.length, 2);
  assert.ok(calls.every((call) => call.stream === true));
  assert.equal(result.cases.length, 1);
  assert.equal(result.requirements[0].id, 'REQ-001');
  assert.equal(result.fallbackUsed, false);
});

test('a primary upstream failure actually routes all generation stages to the selected fallback', async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  const models = [];
  globalThis.fetch = async (_url, options) => {
    const payload = JSON.parse(options.body); models.push(payload.model);
    if (payload.model === 'primary') return new Response(JSON.stringify({ error: { message: '502 upstream unavailable' } }), {
      status: 502, headers: { 'Content-Type': 'application/json' }
    });
    const kind = payload.messages[0].content.includes('需求分析师') ? 'extract' : 'generate';
    return generationResponse(kind);
  };
  const result = await generateCasesWithFallback(config('primary', '主模型', true), config('fallback', '备用模型'), source);
  assert.equal(result.fallbackUsed, true);
  assert.equal(result.model, 'fallback');
  assert.deepEqual(models, ['primary', 'fallback', 'fallback']);
});

test('cancelling a generation aborts upstream work instead of starting the fallback', async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  let calls = 0;
  globalThis.fetch = async (_url, options) => {
    calls += 1;
    return await new Promise((_, reject) => options.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true }));
  };
  const controller = new AbortController();
  const generation = generateCasesWithFallback(config('primary', '主模型', true), config('fallback', '备用模型'), source, controller.signal);
  setTimeout(() => controller.abort(), 5);
  await assert.rejects(generation, (error) => error.name === 'AbortError');
  assert.equal(calls, 1);
});
