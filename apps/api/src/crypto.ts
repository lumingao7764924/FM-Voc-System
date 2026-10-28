import { createHash, createHmac, randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';
import type { EncryptedEnvelope } from '@voc/shared';
import { env } from './config.js';

const ALGO = 'aes-256-gcm';

export function sha256Hex(input: string | Buffer): string {
  return createHash('sha256').update(input).digest('hex');
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(value, Object.keys(value as object).sort());
}

/** Derive per-session AES key from JWT subject + server secret (never sent as static FE key). */
export function deriveSessionKey(userId: string, tokenId: string): Buffer {
  return createHmac('sha256', env.sessionCryptoSecret)
    .update(`${userId}:${tokenId}`)
    .digest();
}

export function encryptPayload(sessionKey: Buffer, plain: unknown): EncryptedEnvelope {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGO, sessionKey, iv);
  const plaintext = Buffer.from(JSON.stringify(plain), 'utf8');
  const enc = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    v: 1,
    iv: iv.toString('base64url'),
    ct: Buffer.concat([enc, tag]).toString('base64url'),
  };
}

export function decryptPayload<T>(sessionKey: Buffer, envelope: EncryptedEnvelope): T {
  if (envelope.v !== 1) throw new Error('Unsupported envelope version');
  const iv = Buffer.from(envelope.iv, 'base64url');
  const data = Buffer.from(envelope.ct, 'base64url');
  const tag = data.subarray(data.length - 16);
  const ct = data.subarray(0, data.length - 16);
  const decipher = createDecipheriv(ALGO, sessionKey, iv);
  decipher.setAuthTag(tag);
  const plain = Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
  return JSON.parse(plain) as T;
}

export function randomToken(bytes = 24): string {
  return randomBytes(bytes).toString('base64url');
}