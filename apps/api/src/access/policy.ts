import {
  canAccessAnyPage,
  canAccessPage,
  type AccessPolicy,
  type AppPageKey,
} from '@voc/shared';
import type { SessionUser } from '../auth.js';
import { findUserByUsername, toPolicy } from './store.js';

export function assertFlag(
  access: AccessPolicy,
  flag: keyof AccessPolicy['flags'],
  message = '没有权限执行此操作',
) {
  if (!access.flags[flag]) {
    throw Object.assign(new Error(message), { statusCode: 403 });
  }
}

export function assertPage(
  access: AccessPolicy,
  page: AppPageKey,
  message = '没有权限执行此操作',
) {
  if (!canAccessPage(access, page)) {
    throw Object.assign(new Error(message), { statusCode: 403 });
  }
}

export function assertAnyPage(
  access: AccessPolicy,
  pages: AppPageKey[],
  message = '没有权限执行此操作',
) {
  if (!canAccessAnyPage(access, pages)) {
    throw Object.assign(new Error(message), { statusCode: 403 });
  }
}

export async function loadAccessForSession(user: SessionUser): Promise<AccessPolicy> {
  const found = await findUserByUsername(user.username);
  if (!found) {
    throw Object.assign(new Error('账号不存在或已停用'), { statusCode: 401 });
  }
  return toPolicy(found.user, found.access);
}

/** 将策略品牌范围合入筛选：无权限时用不可能匹配的品牌 */
export function applyBrandScopeToFilterBrand(
  requestedBrand: string | undefined,
  access: AccessPolicy,
): { brand: string; allowedBrands: string[] | null; denyAll: boolean } {
  if (access.brandKeys === '*') {
    return {
      brand: (requestedBrand ?? '').trim(),
      allowedBrands: null,
      denyAll: false,
    };
  }
  if (!access.brandKeys.length) {
    return { brand: '', allowedBrands: [], denyAll: true };
  }
  const allowed = access.brandKeys.map((b) => b.toLowerCase());
  const req = (requestedBrand ?? '').trim().toLowerCase();
  if (req) {
    if (!allowed.includes(req)) {
      return { brand: '__denied__', allowedBrands: allowed, denyAll: true };
    }
    return { brand: req, allowedBrands: allowed, denyAll: false };
  }
  return { brand: '', allowedBrands: allowed, denyAll: false };
}
