/**
 * 加密与安全工具库。
 * 密码哈希（scrypt）、会话令牌签名（HMAC-SHA256）、
 * API Key 对称加密（AES-256-GCM）、TOTP 双因素认证。
 */
import { createHmac, randomBytes, createCipheriv, createDecipheriv, scryptSync, timingSafeEqual } from 'node:crypto';
import { tokenKey } from '../config/index.js';

/* --- 密码哈希 --- */
export function passwordRecord(password) {
  const salt = randomBytes(16).toString('hex');
  return { salt, hash: scryptSync(password, salt, 64).toString('hex') };
}
export function validPassword(password, record) {
  if (!record || typeof password !== 'string') return false;
  const actual = Buffer.from(scryptSync(password, record.salt, 64).toString('hex'), 'hex');
  const expected = Buffer.from(record.hash, 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/* --- 会话令牌（HMAC 签名的 base64url payload） --- */
export function tokenFor(user) {
  const payload = Buffer.from(JSON.stringify({ typ: 'session', sub: user.id, pv: user.passwordVersion || 0, exp: Date.now() + 8 * 60 * 60 * 1000 })).toString('base64url');
  const signature = createHmac('sha256', tokenKey).update(payload).digest('base64url');
  return payload + '.' + signature;
}

/* --- API Key 对称加密（AES-256-GCM） --- */
export function encrypt(value) {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', tokenKey, iv);
  const encrypted = Buffer.concat([c.update(value, 'utf8'), c.final()]);
  return `${iv.toString('base64url')}.${c.getAuthTag().toString('base64url')}.${encrypted.toString('base64url')}`;
}
export function decrypt(payload) {
  const [iv, tag, ciphertext] = payload.split('.').map((v) => Buffer.from(v, 'base64url'));
  const d = createDecipheriv('aes-256-gcm', tokenKey, iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(ciphertext), d.final()]).toString('utf8');
}

/* --- TOTP（RFC 6238，兼容 Google / Microsoft Authenticator） --- */
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export function base32(buffer) {
  let output = ''; let bits = 0; let value = 0;
  for (const byte of buffer) { value = (value << 8) | byte; bits += 8; while (bits >= 5) { output += B32[(value >>> (bits - 5)) & 31]; bits -= 5; } }
  if (bits) output += B32[(value << (5 - bits)) & 31];
  return output;
}
export function base32Bytes(value) {
  const clean = String(value || '').toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = 0; let current = 0; const out = [];
  for (const char of clean) { current = (current << 5) | B32.indexOf(char); bits += 5; if (bits >= 8) { out.push((current >>> (bits - 8)) & 255); bits -= 8; } }
  return Buffer.from(out);
}
export function verifyTotp(secret, code) {
  if (!/^\d{6}$/.test(String(code || ''))) return false;
  const key = base32Bytes(secret);
  const epoch = Math.floor(Date.now() / 30000);
  for (const offset of [-1, 0, 1]) {
    const counter = Buffer.alloc(8); counter.writeBigUInt64BE(BigInt(epoch + offset));
    const hash = createHmac('sha1', key).update(counter).digest();
    const start = hash[19] & 15;
    const expected = String((((hash[start] & 127) << 24 | hash[start + 1] << 16 | hash[start + 2] << 8 | hash[start + 3]) % 1000000)).padStart(6, '0');
    if (timingSafeEqual(Buffer.from(expected), Buffer.from(String(code)))) return true;
  }
  return false;
}
