import { BigQuery } from '@google-cloud/bigquery';
import bcrypt from 'bcryptjs';
import { randomUUID } from 'node:crypto';
import type {
  AccessFlags,
  AccessPolicy,
  AppPageKey,
  AppUserListItem,
} from '@voc/shared';
import {
  flagsFromPageKeys,
  normalizePageKeys,
} from '@voc/shared';
import { env } from '../config.js';

let bq: BigQuery | null = null;

function getBq(): BigQuery {
  if (!bq) bq = new BigQuery({ projectId: env.gcpProjectId });
  return bq;
}

export type StoredUser = {
  userId: string;
  username: string;
  displayName: string | null;
  passwordHash: string;
  status: 'active' | 'disabled' | 'deleted';
  isBootstrapAdmin: boolean;
};

export type StoredAccess = {
  accessId: string;
  userId: string;
  brandKeys: string[];
  countryCodes: string[];
  pageKeys: AppPageKey[] | '*';
  flags: AccessFlags;
  policyVersion: number;
  validTo: string | null;
  updatedAt: string | null;
};

type MemUser = StoredUser & { access: StoredAccess };

const memUsers = new Map<string, MemUser>();

/** 权限读缓存：每次业务请求都会 loadAccess，BQ 往返 ~1–2s；缓存显著降延迟（改权限时 invalidate） */
const ACCESS_CACHE_TTL_MS = 5 * 60_000;
const accessByUsername = new Map<
  string,
  { at: number; value: { user: StoredUser; access: StoredAccess } | null }
>();
const accessInflight = new Map<
  string,
  Promise<{ user: StoredUser; access: StoredAccess } | null>
>();

export function invalidateAccessCache(username?: string) {
  if (username) {
    const key = username.trim().toLowerCase();
    accessByUsername.delete(key);
    accessInflight.delete(key);
    return;
  }
  accessByUsername.clear();
  accessInflight.clear();
}

const FULL_PAGE_KEYS: AppPageKey[] | '*' = '*';
const FULL_FLAGS: AccessFlags = flagsFromPageKeys(FULL_PAGE_KEYS);

export function flagsFromRow(r: Record<string, unknown>): AccessFlags {
  return {
    viewReviewText: Boolean(r.can_view_review_text),
    viewMedia: Boolean(r.can_view_media),
    export: Boolean(r.can_export),
    editMapping: Boolean(r.can_edit_mapping),
    editTaxonomy: Boolean(r.can_edit_taxonomy),
    manageUsers: Boolean(r.can_manage_users),
  };
}

export function toPolicy(user: StoredUser, access: StoredAccess): AccessPolicy {
  const brands = access.brandKeys;
  const brandKeys: string[] | '*' =
    brands.includes('*') ? '*' : brands.map((b) => b.trim()).filter(Boolean);
  const pageKeys = access.pageKeys;
  return {
    userId: user.userId,
    username: user.username,
    displayName: user.displayName,
    brandKeys,
    countryCodes: access.countryCodes ?? [],
    pageKeys,
    flags: flagsFromPageKeys(pageKeys),
    policyVersion: access.policyVersion,
    isBootstrapAdmin: user.isBootstrapAdmin,
  };
}

function mapUserRow(r: Record<string, unknown>): StoredUser {
  const raw = String(r.status ?? '');
  const status: StoredUser['status'] =
    raw === 'disabled' ? 'disabled' : raw === 'deleted' ? 'deleted' : 'active';
  return {
    userId: String(r.user_id ?? ''),
    username: String(r.username ?? ''),
    displayName: r.display_name != null ? String(r.display_name) : null,
    passwordHash: String(r.password_hash ?? ''),
    status,
    isBootstrapAdmin: Boolean(r.is_bootstrap_admin),
  };
}

function mapAccessRow(r: Record<string, unknown>): StoredAccess {
  const brands = Array.isArray(r.brand_keys)
    ? (r.brand_keys as unknown[]).map((x) => String(x))
    : [];
  const countries = Array.isArray(r.country_codes)
    ? (r.country_codes as unknown[]).map((x) => String(x))
    : [];
  const legacy = flagsFromRow(r);
  const pageKeys = normalizePageKeys(r.page_keys, legacy);
  return {
    accessId: String(r.access_id ?? ''),
    userId: String(r.user_id ?? ''),
    brandKeys: brands,
    countryCodes: countries,
    pageKeys,
    flags: flagsFromPageKeys(pageKeys),
    policyVersion: Number(r.policy_version ?? 1) || 1,
    validTo: r.valid_to != null ? String((r.valid_to as { value?: string }).value ?? r.valid_to) : null,
    updatedAt:
      r.updated_at != null
        ? String((r.updated_at as { value?: string }).value ?? r.updated_at)
        : null,
  };
}

function pageKeysToArray(pageKeys: AppPageKey[] | '*'): string[] {
  return pageKeys === '*' ? ['*'] : [...pageKeys];
}

export async function hashPassword(password: string) {
  return bcrypt.hash(password, 10);
}

export async function verifyPassword(password: string, hash: string) {
  return bcrypt.compare(password, hash);
}

function isStreamingBufferError(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e);
  return /streaming buffer/i.test(msg);
}

/** 每人取最新账号行 + 最新权限行（避免依赖 UPDATE 关闭旧行） */
function latestUserAccessCte(project: string): string {
  return `
    WITH latest_user AS (
      SELECT *
      FROM \`${project}.review_control.app_user\`
      QUALIFY ROW_NUMBER() OVER (
        PARTITION BY user_id
        ORDER BY updated_at DESC
      ) = 1
    ),
    latest_access AS (
      SELECT *
      FROM \`${project}.review_control.app_user_access\`
      QUALIFY ROW_NUMBER() OVER (
        PARTITION BY user_id
        ORDER BY policy_version DESC, valid_from DESC, updated_at DESC
      ) = 1
    )
  `;
}

/** 尽力关闭旧 access；streaming buffer 时跳过，读侧用 policy_version 取最新 */
async function tryInvalidateAccess(userId: string, now: string, actorId: string) {
  try {
    await getBq().query({
      query: `
        UPDATE \`${env.gcpProjectId}.review_control.app_user_access\`
        SET valid_to = @now, updated_at = @now, updated_by = @actor
        WHERE user_id = @userId AND valid_to IS NULL
      `,
      params: { now, actor: actorId, userId },
    });
  } catch (e) {
    if (isStreamingBufferError(e)) {
      console.warn(
        '[access] invalidate old access skipped (streaming buffer); latest policy_version wins',
      );
      return;
    }
    throw e;
  }
}

/** 尽力 UPDATE 用户；失败则追加一行（读侧按 updated_at 取最新） */
async function writeUserRow(row: {
  userId: string;
  username: string;
  displayName: string | null;
  passwordHash: string;
  status: string;
  isBootstrapAdmin: boolean;
  now: string;
  actorId: string;
  notes?: string | null;
  exists: boolean;
}) {
  if (row.exists) {
    try {
      await getBq().query({
        query: `
          UPDATE \`${env.gcpProjectId}.review_control.app_user\`
          SET username = @username,
              display_name = @displayName,
              password_hash = @passwordHash,
              status = @status,
              updated_at = @now,
              updated_by = @actor
          WHERE user_id = @userId
            AND updated_at = (
              SELECT MAX(updated_at)
              FROM \`${env.gcpProjectId}.review_control.app_user\`
              WHERE user_id = @userId
            )
        `,
        params: {
          userId: row.userId,
          username: row.username,
          displayName: row.displayName,
          passwordHash: row.passwordHash,
          status: row.status,
          now: row.now,
          actor: row.actorId,
        },
      });
      return;
    } catch (e) {
      if (!isStreamingBufferError(e)) throw e;
      console.warn('[access] UPDATE app_user skipped (streaming buffer); appending new row');
    }
  }

  await getBq().dataset('review_control').table('app_user').insert([
    {
      user_id: row.userId,
      username: row.username,
      display_name: row.displayName,
      password_hash: row.passwordHash,
      status: row.status,
      is_bootstrap_admin: row.isBootstrapAdmin,
      created_at: row.now,
      updated_at: row.now,
      created_by: row.actorId,
      updated_by: row.actorId,
      notes: row.notes ?? null,
    },
  ]);
}

async function insertAccessRow(input: {
  accessId: string;
  userId: string;
  brands: string[];
  countries: string[];
  pageKeys: AppPageKey[] | '*';
  policyVersion: number;
  now: string;
  actorId: string;
}) {
  const flags = flagsFromPageKeys(input.pageKeys);
  await getBq().dataset('review_control').table('app_user_access').insert([
    {
      access_id: input.accessId,
      user_id: input.userId,
      brand_keys: input.brands,
      country_codes: input.countries,
      page_keys: pageKeysToArray(input.pageKeys),
      can_view_review_text: flags.viewReviewText,
      can_view_media: flags.viewMedia,
      can_export: flags.export,
      can_edit_mapping: flags.editMapping,
      can_edit_taxonomy: flags.editTaxonomy,
      can_manage_users: flags.manageUsers,
      policy_version: input.policyVersion,
      valid_from: input.now,
      valid_to: null,
      updated_at: input.now,
      updated_by: input.actorId,
    },
  ]);
}

/** 干跑内存种子：超级管理员 */
function ensureMemAdmin() {
  if (memUsers.size > 0) return;
  const userId = 'usr_admin';
  const access: StoredAccess = {
    accessId: 'acc_usr_admin_v1',
    userId,
    brandKeys: ['*'],
    countryCodes: [],
    pageKeys: '*',
    flags: { ...FULL_FLAGS },
    policyVersion: 1,
    validTo: null,
    updatedAt: new Date().toISOString(),
  };
  // 同步 hash 会在 ensureSeedAdmin 里异步写入；此处占位，seed 会覆盖
  memUsers.set('admin', {
    userId,
    username: 'admin',
    displayName: '系统管理员',
    passwordHash: '',
    status: 'active',
    isBootstrapAdmin: true,
    access,
  });
}

export async function findUserByUsername(username: string): Promise<{
  user: StoredUser;
  access: StoredAccess;
} | null> {
  const key = username.trim().toLowerCase();
  if (!key) return null;

  if (env.importDryRun) {
    ensureMemAdmin();
    const m = memUsers.get(key);
    if (!m || !m.passwordHash) return null;
    if (m.status !== 'active') return null;
    return { user: m, access: m.access };
  }

  const cached = accessByUsername.get(key);
  if (cached && Date.now() - cached.at < ACCESS_CACHE_TTL_MS) {
    return cached.value;
  }

  const pending = accessInflight.get(key);
  if (pending) return pending;

  const load = (async (): Promise<{ user: StoredUser; access: StoredAccess } | null> => {
    const project = env.gcpProjectId;
    const [rows] = await getBq().query({
      query: `
        ${latestUserAccessCte(project)}
        SELECT u.*, a.access_id, a.brand_keys, a.country_codes,
          a.can_view_review_text, a.can_view_media, a.can_export,
          a.can_edit_mapping, a.can_edit_taxonomy, a.can_manage_users,
          a.page_keys, a.policy_version, a.valid_to, a.updated_at AS access_updated_at
        FROM latest_user u
        JOIN latest_access a ON a.user_id = u.user_id
        WHERE LOWER(u.username) = @username
          AND IFNULL(u.status, 'active') != 'deleted'
        LIMIT 1
      `,
      params: { username: key },
    });
    const row = (rows as Record<string, unknown>[])[0];
    if (!row) {
      accessByUsername.set(key, { at: Date.now(), value: null });
      return null;
    }
    const user = mapUserRow(row);
    if (user.status !== 'active') {
      accessByUsername.set(key, { at: Date.now(), value: null });
      return null;
    }
    const access = mapAccessRow({
      ...row,
      updated_at: row.access_updated_at,
    });
    const value = { user, access };
    accessByUsername.set(key, { at: Date.now(), value });
    return value;
  })();

  accessInflight.set(key, load);
  try {
    return await load;
  } finally {
    accessInflight.delete(key);
  }
}

export async function listUsers(): Promise<AppUserListItem[]> {
  if (env.importDryRun) {
    ensureMemAdmin();
    return [...memUsers.values()].map((m) => ({
      userId: m.userId,
      username: m.username,
      displayName: m.displayName,
      status: m.status,
      isBootstrapAdmin: m.isBootstrapAdmin,
      brandKeys: m.access.brandKeys.includes('*') ? '*' : m.access.brandKeys,
      countryCodes: m.access.countryCodes,
      pageKeys: m.access.pageKeys,
      flags: m.access.flags,
      policyVersion: m.access.policyVersion,
      updatedAt: m.access.updatedAt,
    }));
  }

  const project = env.gcpProjectId;
  const [rows] = await getBq().query({
    query: `
      ${latestUserAccessCte(project)}
      SELECT u.*, a.access_id, a.brand_keys, a.country_codes,
        a.can_view_review_text, a.can_view_media, a.can_export,
        a.can_edit_mapping, a.can_edit_taxonomy, a.can_manage_users,
        a.page_keys, a.policy_version, a.valid_to, a.updated_at AS access_updated_at
      FROM latest_user u
      LEFT JOIN latest_access a ON a.user_id = u.user_id
      WHERE IFNULL(u.status, 'active') != 'deleted'
      ORDER BY u.username
    `,
  });
  return (rows as Record<string, unknown>[]).map((row) => {
    const user = mapUserRow(row);
    const access = row.access_id
      ? mapAccessRow({ ...row, updated_at: row.access_updated_at })
      : null;
    return {
      userId: user.userId,
      username: user.username,
      displayName: user.displayName,
      status: user.status,
      isBootstrapAdmin: user.isBootstrapAdmin,
      brandKeys: access
        ? access.brandKeys.includes('*')
          ? '*'
          : access.brandKeys
        : [],
      countryCodes: access?.countryCodes ?? [],
      pageKeys: access?.pageKeys ?? [],
      flags: access?.flags ?? flagsFromPageKeys([]),
      policyVersion: access?.policyVersion ?? 0,
      updatedAt: access?.updatedAt ?? null,
    };
  });
}

function brandKeysToArray(brandKeys: string[] | '*'): string[] {
  return brandKeys === '*' ? ['*'] : [...brandKeys];
}

export async function upsertUser(input: {
  userId?: string;
  username: string;
  password?: string;
  displayName?: string | null;
  status?: 'active' | 'disabled';
  brandKeys: string[] | '*';
  countryCodes?: string[];
  pageKeys: AppPageKey[] | '*';
  actorId: string;
}): Promise<AppUserListItem> {
  const username = input.username.trim().toLowerCase();
  if (!username) throw Object.assign(new Error('用户名不能为空'), { statusCode: 400 });

  const now = new Date().toISOString();
  const userId = input.userId?.trim() || `usr_${username.replace(/[^a-z0-9_]/gi, '_')}`;
  const status = input.status === 'disabled' ? 'disabled' : 'active';
  const brands = brandKeysToArray(input.brandKeys);
  const countries = input.countryCodes ?? [];
  const pageKeys = normalizePageKeys(
    input.pageKeys === '*' ? ['*'] : input.pageKeys,
  );
  const flags = flagsFromPageKeys(pageKeys);

  if (env.importDryRun) {
    ensureMemAdmin();
    const existing = [...memUsers.values()].find((u) => u.userId === userId || u.username === username);
    let passwordHash = existing?.passwordHash ?? '';
    if (input.password?.trim()) {
      passwordHash = await hashPassword(input.password.trim());
    } else if (!passwordHash) {
      throw Object.assign(new Error('新建账号必须设置密码'), { statusCode: 400 });
    }
    const access: StoredAccess = {
      accessId: existing?.access.accessId ?? `acc_${userId}_v1`,
      userId,
      brandKeys: brands,
      countryCodes: countries,
      pageKeys,
      flags,
      policyVersion: (existing?.access.policyVersion ?? 0) + 1,
      validTo: null,
      updatedAt: now,
    };
    const user: MemUser = {
      userId,
      username,
      displayName: input.displayName ?? null,
      passwordHash,
      status,
      isBootstrapAdmin: existing?.isBootstrapAdmin ?? false,
      access,
    };
    if (existing && existing.username !== username) memUsers.delete(existing.username);
    memUsers.set(username, user);
    invalidateAccessCache(username);
    if (existing?.username) invalidateAccessCache(existing.username);
    return {
      userId,
      username,
      displayName: user.displayName,
      status,
      isBootstrapAdmin: user.isBootstrapAdmin,
      brandKeys: brands.includes('*') ? '*' : brands,
      countryCodes: countries,
      pageKeys,
      flags,
      policyVersion: access.policyVersion,
      updatedAt: now,
    };
  }

  const project = env.gcpProjectId;
  const [existingRows] = await getBq().query({
    query: `
      ${latestUserAccessCte(project)}
      SELECT u.user_id, u.username, u.password_hash, u.is_bootstrap_admin,
        a.policy_version
      FROM latest_user u
      LEFT JOIN latest_access a ON a.user_id = u.user_id
      WHERE (u.user_id = @userId OR LOWER(u.username) = @username)
        AND IFNULL(u.status, 'active') != 'deleted'
      LIMIT 1
    `,
    params: { userId, username },
  });
  const existing = (existingRows as Record<string, unknown>[])[0];
  let passwordHash = existing ? String(existing.password_hash ?? '') : '';
  if (input.password?.trim()) {
    passwordHash = await hashPassword(input.password.trim());
  } else if (!passwordHash) {
    throw Object.assign(new Error('新建账号必须设置密码'), { statusCode: 400 });
  }

  const isBootstrapAdmin = existing ? Boolean(existing.is_bootstrap_admin) : false;
  const resolvedUserId = existing ? String(existing.user_id) : userId;

  if (existing && isBootstrapAdmin) {
    throw Object.assign(new Error('超级管理员账号不可编辑或修改权限'), { statusCode: 403 });
  }

  await tryInvalidateAccess(resolvedUserId, now, input.actorId);

  await writeUserRow({
    userId: resolvedUserId,
    username,
    displayName: input.displayName ?? null,
    passwordHash,
    status,
    isBootstrapAdmin,
    now,
    actorId: input.actorId,
    exists: Boolean(existing),
  });

  const nextVer = Number(existing?.policy_version ?? 0) + 1;
  const accessId = `acc_${resolvedUserId}_${Date.now()}`;
  await insertAccessRow({
    accessId,
    userId: resolvedUserId,
    brands,
    countries,
    pageKeys,
    policyVersion: nextVer,
    now,
    actorId: input.actorId,
  });

  invalidateAccessCache(username);
  if (existing?.username) invalidateAccessCache(String(existing.username));

  return {
    userId: resolvedUserId,
    username,
    displayName: input.displayName ?? null,
    status,
    isBootstrapAdmin,
    brandKeys: brands.includes('*') ? '*' : brands,
    countryCodes: countries,
    pageKeys,
    flags,
    policyVersion: nextVer,
    updatedAt: now,
  };
}

/** 软删除：写入 status=deleted；避开 BQ streaming buffer 硬 DELETE */
export async function deleteUser(userId: string, actorId: string): Promise<void> {
  if (!userId.trim()) {
    throw Object.assign(new Error('用户不存在'), { statusCode: 404 });
  }
  if (userId === actorId) {
    throw Object.assign(new Error('不能删除当前登录账号'), { statusCode: 400 });
  }

  if (env.importDryRun) {
    ensureMemAdmin();
    const hit = [...memUsers.values()].find((u) => u.userId === userId);
    if (!hit) throw Object.assign(new Error('用户不存在'), { statusCode: 404 });
    if (hit.isBootstrapAdmin) {
      throw Object.assign(new Error('超级管理员账号不可编辑或修改权限'), { statusCode: 403 });
    }
    memUsers.delete(hit.username);
    invalidateAccessCache(hit.username);
    return;
  }

  const project = env.gcpProjectId;
  const now = new Date().toISOString();
  const [rows] = await getBq().query({
    query: `
      ${latestUserAccessCte(project)}
      SELECT u.*
      FROM latest_user u
      WHERE u.user_id = @userId
        AND IFNULL(u.status, 'active') != 'deleted'
      LIMIT 1
    `,
    params: { userId },
  });
  const row = (rows as Record<string, unknown>[])[0];
  if (!row) throw Object.assign(new Error('用户不存在'), { statusCode: 404 });
  const user = mapUserRow(row);
  if (user.isBootstrapAdmin) {
    throw Object.assign(new Error('超级管理员账号不可编辑或修改权限'), { statusCode: 403 });
  }

  await tryInvalidateAccess(user.userId, now, actorId);
  await writeUserRow({
    userId: user.userId,
    username: user.username,
    displayName: user.displayName,
    passwordHash: user.passwordHash,
    status: 'deleted',
    isBootstrapAdmin: user.isBootstrapAdmin,
    now,
    actorId,
    exists: true,
    notes: 'soft deleted',
  });
  invalidateAccessCache(user.username);
}

export async function resetUserPassword(userId: string, password: string, actorId: string) {
  if (!password.trim()) {
    throw Object.assign(new Error('密码不能为空'), { statusCode: 400 });
  }
  const hash = await hashPassword(password.trim());
  const now = new Date().toISOString();

  if (env.importDryRun) {
    ensureMemAdmin();
    const hit = [...memUsers.values()].find((u) => u.userId === userId);
    if (!hit) throw Object.assign(new Error('用户不存在'), { statusCode: 404 });
    hit.passwordHash = hash;
    return;
  }

  const project = env.gcpProjectId;
  const [rows] = await getBq().query({
    query: `
      ${latestUserAccessCte(project)}
      SELECT u.*
      FROM latest_user u
      WHERE u.user_id = @userId
      LIMIT 1
    `,
    params: { userId },
  });
  const row = (rows as Record<string, unknown>[])[0];
  if (!row) throw Object.assign(new Error('用户不存在'), { statusCode: 404 });
  const user = mapUserRow(row);
  if (user.isBootstrapAdmin) {
    throw Object.assign(new Error('超级管理员账号不可编辑或修改权限'), { statusCode: 403 });
  }

  await writeUserRow({
    userId: user.userId,
    username: user.username,
    displayName: user.displayName,
    passwordHash: hash,
    status: user.status,
    isBootstrapAdmin: user.isBootstrapAdmin,
    now,
    actorId,
    exists: true,
  });
  invalidateAccessCache(user.username);
}

/**
 * 确保超级管理员存在：admin / 19970222，全品牌 + 全权限。
 * 写真库时写入 BQ；干跑写内存。
 * 用 DML INSERT…WHERE NOT EXISTS + 进程内 singleflight，避免启动/脚本并发双插。
 */
let seedAdminInflight: Promise<void> | null = null;

export async function ensureSeedAdmin(): Promise<void> {
  if (seedAdminInflight) return seedAdminInflight;
  seedAdminInflight = (async () => {
    const username = 'admin';
    const password = '19970222';

    if (env.importDryRun) {
      ensureMemAdmin();
      const m = memUsers.get(username);
      if (m && !m.passwordHash) {
        m.passwordHash = await hashPassword(password);
      }
      return;
    }

    invalidateAccessCache(username);
    const found = await findUserByUsername(username);
    if (found) return;

    const hash = await hashPassword(password);
    const now = new Date().toISOString();
    const userId = 'usr_admin';
    const project = env.gcpProjectId;

    try {
      // DML 比 streaming insert 更能看见刚写入的行，降低「查不到再插一条」
      await getBq().query({
        query: `
          INSERT INTO \`${project}.review_control.app_user\` (
            user_id, username, display_name, password_hash, status,
            is_bootstrap_admin, created_at, updated_at, created_by, updated_by, notes
          )
          SELECT
            @userId, @username, @displayName, @passwordHash, 'active',
            TRUE, @now, @now, 'system', 'system', 'seed super admin'
          FROM (SELECT 1)
          WHERE NOT EXISTS (
            SELECT 1 FROM \`${project}.review_control.app_user\`
            WHERE LOWER(username) = LOWER(@username)
              AND IFNULL(status, 'active') != 'deleted'
          )
        `,
        params: {
          userId,
          username,
          displayName: '系统管理员',
          passwordHash: hash,
          now,
        },
      });
      await getBq().query({
        query: `
          INSERT INTO \`${project}.review_control.app_user_access\` (
            access_id, user_id, brand_keys, country_codes, page_keys,
            can_view_review_text, can_view_media, can_export,
            can_edit_mapping, can_edit_taxonomy, can_manage_users,
            policy_version, valid_from, valid_to, updated_at, updated_by
          )
          SELECT
            @accessId, @userId, ['*'], [], ['*'],
            TRUE, FALSE, FALSE, TRUE, TRUE, TRUE,
            1, @now, CAST(NULL AS TIMESTAMP), @now, 'system'
          FROM (SELECT 1)
          WHERE NOT EXISTS (
            SELECT 1 FROM \`${project}.review_control.app_user_access\`
            WHERE user_id = @userId AND valid_to IS NULL
          )
        `,
        params: {
          accessId: 'acc_usr_admin_v1',
          userId,
          now,
        },
      });
      invalidateAccessCache(username);
      console.info(`[access] seeded super admin ${username} into ${project}.review_control`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (!/Already Exists|duplicate/i.test(msg)) {
        console.warn('[access] seed admin failed', msg);
      }
    }
  })();

  try {
    await seedAdminInflight;
  } finally {
    seedAdminInflight = null;
  }
}

export { FULL_FLAGS, randomUUID };
