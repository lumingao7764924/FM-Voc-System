import { SignJWT, jwtVerify } from 'jose';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { env } from './config.js';
import { deriveSessionKey, randomToken } from './crypto.js';

const COOKIE_NAME = 'voc_session';
const CSRF_COOKIE = 'voc_csrf';
const encoder = new TextEncoder();

export interface SessionUser {
  userId: string;
  username: string;
  tokenId: string;
}

export async function issueSession(
  reply: FastifyReply,
  username: string,
  userId?: string,
) {
  const resolvedUserId = userId?.trim() || `user_${username}`;
  const tokenId = randomToken(16);
  const csrf = randomToken(16);
  const jwt = await new SignJWT({ username, tokenId })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(resolvedUserId)
    .setIssuedAt()
    .setExpirationTime('12h')
    .sign(encoder.encode(env.jwtSecret));

  reply.setCookie(COOKIE_NAME, jwt, {
    httpOnly: true,
    secure: env.cookieSecure,
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 12,
  });
  reply.setCookie(CSRF_COOKIE, csrf, {
    httpOnly: false,
    secure: env.cookieSecure,
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 12,
  });

  const sessionKey = deriveSessionKey(resolvedUserId, tokenId).toString('base64url');
  return { userId: resolvedUserId, username, sessionKey, csrf };
}

export function clearSession(reply: FastifyReply) {
  reply.clearCookie(COOKIE_NAME, { path: '/' });
  reply.clearCookie(CSRF_COOKIE, { path: '/' });
}

export async function readSession(request: FastifyRequest): Promise<SessionUser | null> {
  const token = request.cookies?.[COOKIE_NAME];
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, encoder.encode(env.jwtSecret));
    const userId = payload.sub;
    const username = payload.username as string | undefined;
    const tokenId = payload.tokenId as string | undefined;
    if (!userId || !username || !tokenId) return null;
    return { userId, username, tokenId };
  } catch {
    return null;
  }
}

export function assertCsrf(request: FastifyRequest) {
  if (request.method === 'GET' || request.method === 'HEAD' || request.method === 'OPTIONS') {
    return;
  }
  const header = request.headers['x-csrf-token'];
  const cookie = request.cookies?.[CSRF_COOKIE];
  if (!header || !cookie || header !== cookie) {
    const err = new Error('CSRF validation failed');
    (err as Error & { statusCode?: number }).statusCode = 403;
    throw err;
  }
}

export function sessionAesKey(user: SessionUser): Buffer {
  return deriveSessionKey(user.userId, user.tokenId);
}

export async function requireUser(request: FastifyRequest): Promise<SessionUser> {
  assertCsrf(request);
  const user = await readSession(request);
  if (!user) {
    const err = new Error('Unauthorized');
    (err as Error & { statusCode?: number }).statusCode = 401;
    throw err;
  }
  return user;
}