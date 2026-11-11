import { randomBytes } from 'node:crypto';
import { BigQuery } from '@google-cloud/bigquery';
import { env } from '../config.js';

const SHARE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const TOKEN_BYTES = 9; // ~12 字符 base64url，短且难猜

export type ReportShareLink = {
  token: string;
  batchId: string;
  createdBy: string | null;
  createdAt: string;
  expiresAt: string;
};

const memoryShares = new Map<string, ReportShareLink>();

let bq: BigQuery | null = null;
function getBq(): BigQuery {
  if (!bq) bq = new BigQuery({ projectId: env.gcpProjectId });
  return bq;
}

function shareTable() {
  return `\`${env.gcpProjectId}.review_control.report_share_link\``;
}

function newToken(): string {
  return randomBytes(TOKEN_BYTES).toString('base64url');
}

function nowIso() {
  return new Date().toISOString();
}

export function isShareExpired(link: ReportShareLink, now = Date.now()): boolean {
  return new Date(link.expiresAt).getTime() <= now;
}

/** 创建 7 天有效短链；不暴露 batchId */
export async function createReportShareLink(input: {
  batchId: string;
  createdBy: string | null;
}): Promise<ReportShareLink> {
  const createdAt = nowIso();
  const expiresAt = new Date(Date.now() + SHARE_TTL_MS).toISOString();
  let token = newToken();
  // 极低概率碰撞时重试
  for (let i = 0; i < 3; i += 1) {
    if (!memoryShares.has(token)) break;
    token = newToken();
  }

  const row: ReportShareLink = {
    token,
    batchId: input.batchId,
    createdBy: input.createdBy,
    createdAt,
    expiresAt,
  };
  memoryShares.set(token, row);

  if (!env.importDryRun) {
    try {
      await getBq().query({
        query: `
          INSERT INTO ${shareTable()}
            (share_token, batch_id, created_by, created_at, expires_at)
          VALUES
            (@token, @batchId, @createdBy, TIMESTAMP(@createdAt), TIMESTAMP(@expiresAt))
        `,
        params: {
          token: row.token,
          batchId: row.batchId,
          createdBy: row.createdBy,
          createdAt: row.createdAt,
          expiresAt: row.expiresAt,
        },
      });
    } catch (e) {
      memoryShares.delete(token);
      throw e;
    }
  }

  return row;
}

export async function getReportShareLink(
  token: string,
): Promise<ReportShareLink | null> {
  const t = token.trim();
  if (!t) return null;

  const mem = memoryShares.get(t);
  if (mem) {
    if (isShareExpired(mem)) {
      memoryShares.delete(t);
      return null;
    }
    return mem;
  }

  if (env.importDryRun) return null;

  try {
    const [rows] = await getBq().query({
      query: `
        SELECT share_token, batch_id, created_by, created_at, expires_at
        FROM ${shareTable()}
        WHERE share_token = @token
        LIMIT 1
      `,
      params: { token: t },
    });
    const r = (rows as Record<string, unknown>[])[0];
    if (!r) return null;

    const createdAtRaw = r.created_at;
    const expiresAtRaw = r.expires_at;
    const createdAt =
      createdAtRaw && typeof createdAtRaw === 'object' && 'value' in createdAtRaw
        ? String((createdAtRaw as { value: string }).value)
        : String(createdAtRaw ?? '');
    const expiresAt =
      expiresAtRaw && typeof expiresAtRaw === 'object' && 'value' in expiresAtRaw
        ? String((expiresAtRaw as { value: string }).value)
        : String(expiresAtRaw ?? '');

    const link: ReportShareLink = {
      token: String(r.share_token ?? t),
      batchId: String(r.batch_id ?? ''),
      createdBy: r.created_by != null ? String(r.created_by) : null,
      createdAt,
      expiresAt,
    };
    if (!link.batchId || isShareExpired(link)) return null;
    memoryShares.set(t, link);
    return link;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/Not found: Table|not found/i.test(msg)) {
      console.warn('[share] report_share_link table missing; run sql/ddl/011_report_share_link.sql');
      return null;
    }
    throw e;
  }
}
