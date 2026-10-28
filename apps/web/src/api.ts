export function getCookie(name: string): string | null {
  const m = document.cookie.match(new RegExp(`(?:^|; )${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}=([^;]*)`));
  return m ? decodeURIComponent(m[1]) : null;
}

function b64urlToBytes(s: string): Uint8Array {
  const pad = '='.repeat((4 - (s.length % 4)) % 4);
  const b64 = (s + pad).replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function bytesToB64url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

let sessionKeyB64: string | null = sessionStorage.getItem('voc_session_key');
let redirectingToLogin = false;

export function setSessionKey(key: string | null) {
  sessionKeyB64 = key;
  if (key) sessionStorage.setItem('voc_session_key', key);
  else sessionStorage.removeItem('voc_session_key');
}

export function getSessionKey() {
  return sessionKeyB64;
}

/** 会话失效：清本地密钥并回到登录页（登录页本身 / 登录请求不跳） */
function handleUnauthorized(path: string) {
  setSessionKey(null);
  if (typeof window === 'undefined') return;
  if (window.location.pathname.startsWith('/login')) return;
  if (path.startsWith('/api/auth/login')) return;
  if (redirectingToLogin) return;
  redirectingToLogin = true;
  const next = `${window.location.pathname}${window.location.search}`;
  const q = next && next !== '/' ? `?next=${encodeURIComponent(next)}` : '';
  window.location.assign(`/login${q}`);
}

async function importAesKey(): Promise<CryptoKey | null> {
  if (!sessionKeyB64) return null;
  const raw = b64urlToBytes(sessionKeyB64);
  return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

export async function encryptJson(plain: unknown): Promise<{ v: 1; iv: string; ct: string } | null> {
  const key = await importAesKey();
  if (!key) return null;
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(JSON.stringify(plain));
  const ctBuf = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoded);
  return { v: 1, iv: bytesToB64url(iv), ct: bytesToB64url(new Uint8Array(ctBuf)) };
}

export async function decryptJson<T>(envelope: { v: 1; iv: string; ct: string }): Promise<T> {
  const key = await importAesKey();
  if (!key) throw new Error('No session key');
  const iv = b64urlToBytes(envelope.iv);
  const ct = b64urlToBytes(envelope.ct);
  const plainBuf = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct);
  return JSON.parse(new TextDecoder().decode(plainBuf)) as T;
}

export async function apiFetch<T>(
  path: string,
  options: RequestInit & { json?: unknown; encrypt?: boolean } = {},
): Promise<T> {
  const headers = new Headers(options.headers);
  const csrf = getCookie('voc_csrf');
  if (csrf) headers.set('x-csrf-token', csrf);

  const wantEncrypt = options.encrypt !== false && Boolean(sessionKeyB64);
  if (wantEncrypt) headers.set('x-voc-encrypted', '1');

  let body = options.body;
  if (options.json !== undefined) {
    const enc = wantEncrypt ? await encryptJson(options.json) : null;
    if (enc) {
      headers.set('content-type', 'application/json');
      body = JSON.stringify(enc);
    } else {
      headers.set('content-type', 'application/json');
      body = JSON.stringify(options.json);
    }
  }

  const res = await fetch(path, {
    ...options,
    headers,
    body,
    credentials: 'include',
  });

  const text = await res.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { message: text };
    }
  }

  if (res.status === 401) {
    handleUnauthorized(path);
  }

  if (
    data &&
    typeof data === 'object' &&
    'v' in data &&
    (data as { v: number }).v === 1 &&
    'iv' in data &&
    'ct' in data
  ) {
    try {
      data = await decryptJson(data as { v: 1; iv: string; ct: string });
    } catch {
      if (res.status === 401) {
        throw new Error('登录已失效，请重新登录');
      }
      throw new Error('响应解密失败');
    }
  }

  if (!res.ok) {
    const msg =
      data && typeof data === 'object' && 'message' in data
        ? String((data as { message: string }).message)
        : res.statusText;
    throw new Error(
      msg || (res.status === 401 ? '登录已失效，请重新登录' : '请求失败'),
    );
  }
  return data as T;
}