/**
 * AI 代理服务。
 * 对接 OpenAI Chat Completions 兼容协议，提供用例生成 / 根因分析 / 报告摘要三项技能。
 * API Key 使用 AES-256-GCM 加密落盘，调用时解密，永不回传浏览器。
 */
import { decrypt } from '../lib/crypto.js';

export function maskAiConfig(item) {
  const { apiKeyEncrypted, ...safe } = item;
  return { ...safe, keyConfigured: Boolean(apiKeyEncrypted) };
}

export function modelPrompt(task, input, report) {
  if (task === 'test_cases') return `你是一位资深测试工程师。根据以下需求生成结构化测试用例（标题、前置条件、步骤、预期、优先级、类型）。需求：\n${input}`;
  if (task === 'defect_analysis') return `你是一位资深质量工程师。分析以下缺陷，输出可能根因、修复建议和验证方案。缺陷：\n${input}`;
  return `请根据以下测试数据生成简洁的测试报告摘要，包含通过率、高风险、质量结论和建议。数据：\n${JSON.stringify(report)}`;
}

export async function callAi(config, task, input, report) {
  const apiKey = decrypt(config.apiKeyEncrypted);
  const base = config.baseUrl.replace(/\/$/, '');
  const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), 30000);
  try {
    const response = await fetch(`${base}/chat/completions`, {
      method: 'POST', signal: controller.signal,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model: config.model, temperature: 0.25, messages: [{ role: 'system', content: '请用简体中文回答，输出清晰、可执行的测试产物。' }, { role: 'user', content: modelPrompt(task, input, report) }] })
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result?.error?.message || `HTTP ${response.status}`);
    return result.choices?.[0]?.message?.content || '模型未返回有效内容。';
  } finally { clearTimeout(timeout); }
}
