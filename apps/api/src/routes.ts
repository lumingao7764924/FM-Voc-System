import type { FastifyInstance } from 'fastify';
import type {
  AnalysisBatchCreateInput,
  AppUserAccessUpdateInput,
  AppUserUpsertInput,
  EncryptedEnvelope,
  LoginRequest,
} from '@voc/shared';
import { canDeleteAnalysis } from '@voc/shared';
import { env } from './config.js';
import { clearSession, issueSession, requireUser, sessionAesKey } from './auth.js';
import { decryptPayload, encryptPayload } from './crypto.js';
import { createImportBatch } from './import/service.js';
import { enqueueImportJob } from './import/queue.js';
import { healBatchIfOrphaned } from './import/orphan.js';
import { fetchBatch, listBatches, updateBatchStatus } from './import/store.js';
import { processMappingUpload } from './mapping/service.js';
import { listCurrentMappings, listUnmappedSkus } from './mapping/store.js';
import { listReviews } from './review/store.js';
import { syncPendingReviewMappings } from './review/syncMapping.js';
import {
  getAnalyticsBreakdown,
  getAnalyticsOverview,
  getAnalyticsTrend,
} from './analytics/store.js';
import { createAnalysisBatch, getAnalysisBatchDetail } from './analysis/service.js';
import { enqueueAnalysisBatch } from './analysis/queue.js';
import { buildAnalysisReport } from './analysis/report.js';
import {
  clearAnalysisArtifacts,
  deleteAnalysisBatch,
  listAnalysisBatches,
} from './analysis/store.js';
import { listTaxonomy } from './taxonomy/store.js';
import {
  processTaxonomyUpload,
  upsertTaxonomyItem,
  createTaxonomyVersion,
  deleteTaxonomyVersion,
} from './taxonomy/service.js';
import { buildTaxonomyTemplateBuffer } from './taxonomy/parseWorkbook.js';
import { parseListQuery, queryStr } from './listQuery.js';
import type { IssueTaxonomyUpsertInput } from '@voc/shared';
import {
  ensureSeedAdmin,
  findUserByUsername,
  listUsers,
  deleteUser,
  resetUserPassword,
  toPolicy,
  upsertUser,
  verifyPassword,
} from './access/store.js';
import { assertAnyPage, assertPage, loadAccessForSession } from './access/policy.js';

async function readJsonBody<T>(request: { body: unknown }, userKey?: Buffer): Promise<T> {
  const body = request.body as EncryptedEnvelope | T;
  if (
    body &&
    typeof body === 'object' &&
    'v' in body &&
    (body as EncryptedEnvelope).v === 1 &&
    userKey
  ) {
    return decryptPayload<T>(userKey, body as EncryptedEnvelope);
  }
  return body as T;
}

function maybeEncrypt(replyPayload: unknown, userKey?: Buffer, wantEncrypt?: boolean) {
  if (wantEncrypt && userKey) return encryptPayload(userKey, replyPayload);
  return replyPayload;
}

export async function registerRoutes(app: FastifyInstance) {
  await ensureSeedAdmin().catch((e) =>
    app.log.warn({ err: e }, 'ensureSeedAdmin failed'),
  );

  app.get('/api/health', async () => ({
    ok: true,
    dryRun: env.importDryRun,
    project: env.gcpProjectId,
  }));

  app.post('/api/auth/login', async (request, reply) => {
    const body = (request.body ?? {}) as LoginRequest;
    const username = (body.username ?? '').trim();
    const password = body.password ?? '';
    const found = await findUserByUsername(username);
    if (!found || !(await verifyPassword(password, found.user.passwordHash))) {
      return reply.code(401).send({ error: 'unauthorized', message: '用户名或密码错误' });
    }
    const access = toPolicy(found.user, found.access);
    const session = await issueSession(reply, found.user.username, found.user.userId);
    return {
      userId: session.userId,
      username: session.username,
      sessionKey: session.sessionKey,
      access,
    };
  });

  app.post('/api/auth/logout', async (request, reply) => {
    clearSession(reply);
    return { ok: true };
  });

  app.get('/api/auth/me', async (request, reply) => {
    try {
      const user = await requireUser(request);
      const access = await loadAccessForSession(user);
      return { userId: user.userId, username: user.username, access };
    } catch {
      return reply.code(401).send({ error: 'unauthorized', message: 'Not logged in' });
    }
  });

  app.get('/api/admin/users', async (request, reply) => {
    const user = await requireUser(request);
    const access = await loadAccessForSession(user);
    assertPage(access, 'settings.accounts');
    const enc = request.headers['x-voc-encrypted'] === '1';
    return maybeEncrypt({ items: await listUsers() }, sessionAesKey(user), enc);
  });

  app.post('/api/admin/users', async (request, reply) => {
    const user = await requireUser(request);
    const access = await loadAccessForSession(user);
    assertPage(access, 'settings.accounts');
    const enc = request.headers['x-voc-encrypted'] === '1';
    const body = await readJsonBody<AppUserUpsertInput>(request, sessionAesKey(user));
    try {
      const item = await upsertUser({
        ...body,
        actorId: user.userId,
      });
      return maybeEncrypt(item, sessionAesKey(user), enc);
    } catch (err) {
      const code = (err as Error & { statusCode?: number }).statusCode ?? 500;
      return reply.code(code).send({
        error: code === 400 ? 'bad_request' : 'user_failed',
        message: err instanceof Error ? err.message : 'Save user failed',
      });
    }
  });

  app.put('/api/admin/users/:userId', async (request, reply) => {
    const user = await requireUser(request);
    const access = await loadAccessForSession(user);
    assertPage(access, 'settings.accounts');
    const enc = request.headers['x-voc-encrypted'] === '1';
    const { userId } = request.params as { userId: string };
    const body = await readJsonBody<AppUserUpsertInput>(request, sessionAesKey(user));
    try {
      const item = await upsertUser({
        ...body,
        userId,
        actorId: user.userId,
      });
      return maybeEncrypt(item, sessionAesKey(user), enc);
    } catch (err) {
      const code = (err as Error & { statusCode?: number }).statusCode ?? 500;
      return reply.code(code).send({
        error: code === 400 ? 'bad_request' : 'user_failed',
        message: err instanceof Error ? err.message : 'Update user failed',
      });
    }
  });

  app.put('/api/admin/users/:userId/access', async (request, reply) => {
    const user = await requireUser(request);
    const access = await loadAccessForSession(user);
    assertPage(access, 'settings.permissions');
    const enc = request.headers['x-voc-encrypted'] === '1';
    const { userId } = request.params as { userId: string };
    const body = await readJsonBody<AppUserAccessUpdateInput>(request, sessionAesKey(user));
    const users = await listUsers();
    const target = users.find((u) => u.userId === userId);
    if (!target) {
      return reply.code(404).send({ error: 'not_found', message: '用户不存在' });
    }
    if (target.isBootstrapAdmin) {
      return reply.code(403).send({
        error: 'forbidden',
        message: '超级管理员账号不可编辑或修改权限',
      });
    }
    try {
      const item = await upsertUser({
        userId,
        username: target.username,
        displayName: target.displayName,
        status: target.status === 'disabled' ? 'disabled' : 'active',
        brandKeys: body.brandKeys,
        countryCodes: body.countryCodes,
        pageKeys: body.pageKeys,
        actorId: user.userId,
      });
      return maybeEncrypt(item, sessionAesKey(user), enc);
    } catch (err) {
      const code = (err as Error & { statusCode?: number }).statusCode ?? 500;
      return reply.code(code).send({
        error: code === 400 ? 'bad_request' : 'user_failed',
        message: err instanceof Error ? err.message : 'Update access failed',
      });
    }
  });

  app.post('/api/admin/users/:userId/password', async (request, reply) => {
    const user = await requireUser(request);
    const access = await loadAccessForSession(user);
    assertPage(access, 'settings.accounts');
    const { userId } = request.params as { userId: string };
    const body = await readJsonBody<{ password: string }>(request, sessionAesKey(user));
    try {
      await resetUserPassword(userId, body.password ?? '', user.userId);
      return { ok: true };
    } catch (err) {
      const code = (err as Error & { statusCode?: number }).statusCode ?? 500;
      return reply.code(code).send({
        error: code === 400 ? 'bad_request' : 'user_failed',
        message: err instanceof Error ? err.message : 'Reset password failed',
      });
    }
  });

  app.delete('/api/admin/users/:userId', async (request, reply) => {
    const user = await requireUser(request);
    const access = await loadAccessForSession(user);
    assertPage(access, 'settings.accounts');
    const { userId } = request.params as { userId: string };
    try {
      await deleteUser(userId, user.userId);
      return { ok: true };
    } catch (err) {
      const code = (err as Error & { statusCode?: number }).statusCode ?? 500;
      return reply.code(code).send({
        error:
          code === 400 ? 'bad_request' : code === 403 ? 'forbidden' : code === 404 ? 'not_found' : 'user_failed',
        message: err instanceof Error ? err.message : 'Delete user failed',
      });
    }
  });

  app.get('/api/imports', async (request, reply) => {
    const user = await requireUser(request);
    const access = await loadAccessForSession(user);
    assertAnyPage(access, ['reviews.import', 'reviews.history']);
    const enc = request.headers['x-voc-encrypted'] === '1';
    const query = request.query as Record<string, unknown>;
    const list = parseListQuery(query);
    const result = await listBatches({
      limit: list.pageSize,
      offset: list.offset,
      page: list.page,
      pageSize: list.pageSize,
      q: list.q,
      status: queryStr(query, 'status'),
    });
    const healed = await Promise.all(result.items.map((b) => healBatchIfOrphaned(b)));
    return maybeEncrypt({ ...result, items: healed }, sessionAesKey(user), enc);
  });

  app.post('/api/imports', async (request, reply) => {
    const user = await requireUser(request);
    const access = await loadAccessForSession(user);
    assertPage(access, 'reviews.import');
    const key = sessionAesKey(user);
    const enc = request.headers['x-voc-encrypted'] === '1';
    const body = await readJsonBody<{
      requestIdempotencyKey: string;
      sourceFileName: string;
    }>(request, enc ? key : undefined);

    const batch = await createImportBatch({
      requestIdempotencyKey: body.requestIdempotencyKey,
      sourceFileName: body.sourceFileName,
      uploadedBy: user.userId,
    });
    return maybeEncrypt(batch, key, enc);
  });

  app.post('/api/imports/:id/file', async (request, reply) => {
    const user = await requireUser(request);
    const access = await loadAccessForSession(user);
    assertPage(access, 'reviews.import');
    const { id } = request.params as { id: string };
    const existing = await fetchBatch(id);
    if (!existing) {
      return reply.code(404).send({ error: 'not_found', message: 'Batch not found' });
    }
    if (existing.importStatus !== 'awaiting_upload' && existing.importStatus !== 'failed') {
      return reply.code(409).send({ error: 'conflict', message: 'Batch not awaiting upload' });
    }

    const file = await request.file();
    if (!file) {
      return reply.code(400).send({ error: 'bad_request', message: 'file required' });
    }
    const buffer = await file.toBuffer();
    if (buffer.byteLength > 20 * 1024 * 1024) {
      return reply.code(400).send({ error: 'bad_request', message: 'file exceeds 20MiB' });
    }

    // Accept file, mark queued, return immediately — parse/write runs in background.
    await updateBatchStatus(id, { importStatus: 'queued' });
    enqueueImportJob({
      importBatchId: id,
      buffer,
      contentType: file.mimetype,
      uploadedBy: user.userId,
    });

    const accepted = (await fetchBatch(id)) ?? { ...existing, importStatus: 'queued' as const };
    const enc = request.headers['x-voc-encrypted'] === '1';
    return maybeEncrypt(accepted, sessionAesKey(user), enc);
  });

  app.get('/api/imports/:id', async (request, reply) => {
    const user = await requireUser(request);
    const access = await loadAccessForSession(user);
    assertAnyPage(access, ['reviews.import', 'reviews.history']);
    const { id } = request.params as { id: string };
    const batch = await fetchBatch(id);
    if (!batch) return reply.code(404).send({ error: 'not_found', message: 'Batch not found' });
    const healed = await healBatchIfOrphaned(batch);
    const enc = request.headers['x-voc-encrypted'] === '1';
    return maybeEncrypt(healed, sessionAesKey(user), enc);
  });

  // —— 评论列表 ——

  app.get('/api/reviews', async (request, reply) => {
    const user = await requireUser(request);
    const access = await loadAccessForSession(user);
    assertAnyPage(access, ['reviews.list', 'analytics']);
    const enc = request.headers['x-voc-encrypted'] === '1';
    const query = request.query as Record<string, unknown>;
    const list = parseListQuery(query);
    const result = await listReviews({
      limit: list.pageSize,
      offset: list.offset,
      page: list.page,
      pageSize: list.pageSize,
      dateFrom: queryStr(query, 'dateFrom'),
      dateTo: queryStr(query, 'dateTo'),
      brand: queryStr(query, 'brand'),
      spu: queryStr(query, 'spu'),
      sku: queryStr(query, 'sku'),
      country: queryStr(query, 'country'),
      platform: queryStr(query, 'platform'),
      mapped: queryStr(query, 'mapped'),
      q: list.q,
      ratingMin: queryStr(query, 'ratingMin'),
      ratingMax: queryStr(query, 'ratingMax'),
      access,
    });
    return maybeEncrypt(result, sessionAesKey(user), enc);
  });

  // —— 评论分析（轨道 A，只读聚合）——

  app.get('/api/analytics/overview', async (request, reply) => {
    const user = await requireUser(request);
    const access = await loadAccessForSession(user);
    assertPage(access, 'analytics');
    const enc = request.headers['x-voc-encrypted'] === '1';
    const query = request.query as Record<string, unknown>;
    const result = await getAnalyticsOverview({
      dateFrom: queryStr(query, 'dateFrom'),
      dateTo: queryStr(query, 'dateTo'),
      brand: queryStr(query, 'brand'),
      spu: queryStr(query, 'spu'),
      sku: queryStr(query, 'sku'),
      country: queryStr(query, 'country'),
      platform: queryStr(query, 'platform'),
      mapped: queryStr(query, 'mapped'),
      ratingMin: queryStr(query, 'ratingMin'),
      ratingMax: queryStr(query, 'ratingMax'),
      access,
    });
    return maybeEncrypt(result, sessionAesKey(user), enc);
  });

  app.get('/api/analytics/trend', async (request, reply) => {
    const user = await requireUser(request);
    const access = await loadAccessForSession(user);
    assertPage(access, 'analytics');
    const enc = request.headers['x-voc-encrypted'] === '1';
    const query = request.query as Record<string, unknown>;
    const result = await getAnalyticsTrend({
      dateFrom: queryStr(query, 'dateFrom'),
      dateTo: queryStr(query, 'dateTo'),
      brand: queryStr(query, 'brand'),
      spu: queryStr(query, 'spu'),
      sku: queryStr(query, 'sku'),
      country: queryStr(query, 'country'),
      platform: queryStr(query, 'platform'),
      mapped: queryStr(query, 'mapped'),
      ratingMin: queryStr(query, 'ratingMin'),
      ratingMax: queryStr(query, 'ratingMax'),
      granularity: queryStr(query, 'granularity'),
      access,
    });
    return maybeEncrypt(result, sessionAesKey(user), enc);
  });

  app.get('/api/analytics/breakdown', async (request, reply) => {
    const user = await requireUser(request);
    const access = await loadAccessForSession(user);
    assertPage(access, 'analytics');
    const enc = request.headers['x-voc-encrypted'] === '1';
    const query = request.query as Record<string, unknown>;
    const list = parseListQuery(query, { defaultPageSize: 10 });
    const result = await getAnalyticsBreakdown({
      dateFrom: queryStr(query, 'dateFrom'),
      dateTo: queryStr(query, 'dateTo'),
      brand: queryStr(query, 'brand'),
      spu: queryStr(query, 'spu'),
      sku: queryStr(query, 'sku'),
      country: queryStr(query, 'country'),
      platform: queryStr(query, 'platform'),
      mapped: queryStr(query, 'mapped'),
      ratingMin: queryStr(query, 'ratingMin'),
      ratingMax: queryStr(query, 'ratingMax'),
      dimension: queryStr(query, 'dimension'),
      page: list.page,
      pageSize: list.pageSize,
      offset: list.offset,
      access,
    });
    return maybeEncrypt(result, sessionAesKey(user), enc);
  });

  // —— 差评语义分析（Step 5：按当前筛选跑批）——

  app.post('/api/analysis/batches', async (request, reply) => {
    const user = await requireUser(request);
    const access = await loadAccessForSession(user);
    assertPage(access, 'analytics');
    const enc = request.headers['x-voc-encrypted'] === '1';
    try {
      const body = await readJsonBody<AnalysisBatchCreateInput>(request, sessionAesKey(user));
      const summary = await createAnalysisBatch({
        filters: body ?? {},
        access,
        createdBy: user.username,
      });
      if (summary.total > 0) {
        enqueueAnalysisBatch(summary.batchId);
      }
      return maybeEncrypt(summary, sessionAesKey(user), enc);
    } catch (e) {
      const err = e as { message?: string };
      return reply.code(500).send({
        error: 'analysis_batch_failed',
        message: err.message || 'Create analysis batch failed',
      });
    }
  });

  app.get('/api/analysis/batches', async (request, reply) => {
    const user = await requireUser(request);
    const access = await loadAccessForSession(user);
    assertAnyPage(access, ['analytics', 'analytics.history']);
    const enc = request.headers['x-voc-encrypted'] === '1';
    const list = parseListQuery(request.query as Record<string, unknown>, {
      defaultPageSize: 20,
    });
    const result = await listAnalysisBatches({
      page: list.page,
      pageSize: list.pageSize,
    });
    return maybeEncrypt(result, sessionAesKey(user), enc);
  });

  app.get('/api/analysis/batches/:id', async (request, reply) => {
    const user = await requireUser(request);
    const access = await loadAccessForSession(user);
    assertAnyPage(access, ['analytics', 'analytics.history']);
    const enc = request.headers['x-voc-encrypted'] === '1';
    const { id } = request.params as { id: string };
    const detail = await getAnalysisBatchDetail(id);
    if (!detail) {
      return reply.code(404).send({ error: 'not_found', message: '分析批次不存在或已过期' });
    }
    return maybeEncrypt(detail, sessionAesKey(user), enc);
  });

  app.get('/api/analysis/batches/:id/report', async (request, reply) => {
    const user = await requireUser(request);
    const access = await loadAccessForSession(user);
    assertAnyPage(access, ['analytics', 'analytics.history']);
    const enc = request.headers['x-voc-encrypted'] === '1';
    const { id } = request.params as { id: string };
    try {
      const report = await buildAnalysisReport(id);
      if (!report) {
        return reply.code(404).send({ error: 'not_found', message: '分析批次不存在或已过期' });
      }
      return maybeEncrypt(report, sessionAesKey(user), enc);
    } catch (e) {
      const err = e as { message?: string };
      return reply.code(500).send({
        error: 'analysis_report_failed',
        message: err.message || 'Build analysis report failed',
      });
    }
  });

  app.delete('/api/analysis/batches/:id', async (request, reply) => {
    const user = await requireUser(request);
    const access = await loadAccessForSession(user);
    if (!canDeleteAnalysis(access)) {
      return reply.code(403).send({
        error: 'forbidden',
        message: '需要「删除 AI 分析」权限',
      });
    }
    const enc = request.headers['x-voc-encrypted'] === '1';
    const { id } = request.params as { id: string };
    try {
      const result = await deleteAnalysisBatch(id);
      return maybeEncrypt(result, sessionAesKey(user), enc);
    } catch (e) {
      const err = e as { message?: string };
      return reply.code(500).send({
        error: 'analysis_delete_failed',
        message: err.message || 'Delete analysis batch failed',
      });
    }
  });

  /** 需「删除 AI 分析」权限（或 bootstrap admin） */
  app.post('/api/analysis/clear', async (request, reply) => {
    const user = await requireUser(request);
    const access = await loadAccessForSession(user);
    if (!canDeleteAnalysis(access)) {
      return reply.code(403).send({
        error: 'forbidden',
        message: '需要「删除 AI 分析」权限',
      });
    }
    const enc = request.headers['x-voc-encrypted'] === '1';
    try {
      const result = await clearAnalysisArtifacts();
      const bqPart = result.bigQuery
        ? `BQ 批次 ${result.bigQuery.batch} / run ${result.bigQuery.analysisRun} / 片段 ${result.bigQuery.segment} / 问题 ${result.bigQuery.issue}`
        : '干跑仅清内存';
      return maybeEncrypt(
        {
          ...result,
          message: result.dryRun
            ? `已清空内存分析产物（批次 ${result.memory.batchCount}）。${bqPart}`
            : `已清空 AI 分析产物（${bqPart}）。`,
        },
        sessionAesKey(user),
        enc,
      );
    } catch (e) {
      const err = e as { message?: string };
      return reply.code(500).send({
        error: 'analysis_clear_failed',
        message: err.message || 'Clear analysis artifacts failed',
      });
    }
  });

  app.post('/api/reviews/sync-mapping', async (request, reply) => {
    const user = await requireUser(request);
    const access = await loadAccessForSession(user);
    assertPage(access, 'products.import');
    const enc = request.headers['x-voc-encrypted'] === '1';
    try {
      const result = await syncPendingReviewMappings();
      return maybeEncrypt(result, sessionAesKey(user), enc);
    } catch (e) {
      const err = e as { message?: string };
      return reply.code(500).send({
        error: 'sync_mapping_failed',
        message: err.message || 'Sync mapping failed',
      });
    }
  });

  // —— 产品映射（内部 SKU 主数据）——

  app.get('/api/mappings', async (request, reply) => {
    const user = await requireUser(request);
    const access = await loadAccessForSession(user);
    assertAnyPage(access, ['products.list', 'products.import']);
    const enc = request.headers['x-voc-encrypted'] === '1';
    const query = request.query as Record<string, unknown>;
    const list = parseListQuery(query);
    const scope = access.brandKeys === '*' ? null : access.brandKeys;
    let brand = queryStr(query, 'brand');
    if (scope && scope.length && brand && !scope.map((b) => b.toLowerCase()).includes(brand.toLowerCase())) {
      brand = '__denied__';
    }
    const result = await listCurrentMappings({
      limit: list.pageSize,
      offset: list.offset,
      page: list.page,
      pageSize: list.pageSize,
      brand,
      q: list.q,
    });
    return maybeEncrypt(result, sessionAesKey(user), enc);
  });

  app.get('/api/mappings/unmapped', async (request, reply) => {
    const user = await requireUser(request);
    const access = await loadAccessForSession(user);
    assertPage(access, 'products.import');
    const enc = request.headers['x-voc-encrypted'] === '1';
    const query = request.query as Record<string, unknown>;
    const list = parseListQuery(query);
    const result = await listUnmappedSkus({
      limit: list.pageSize,
      offset: list.offset,
      page: list.page,
      pageSize: list.pageSize,
      brand: queryStr(query, 'brand'),
      q: list.q,
      status: queryStr(query, 'status'),
    });
    return maybeEncrypt(result, sessionAesKey(user), enc);
  });

  app.post('/api/mappings/file', async (request, reply) => {
    const user = await requireUser(request);
    const access = await loadAccessForSession(user);
    assertPage(access, 'products.import');
    const file = await request.file();
    if (!file) {
      return reply.code(400).send({ error: 'bad_request', message: 'file required' });
    }
    const buffer = await file.toBuffer();
    if (buffer.byteLength > 20 * 1024 * 1024) {
      return reply.code(400).send({ error: 'bad_request', message: 'file exceeds 20MiB' });
    }

    try {
      const result = await processMappingUpload({
        buffer,
        uploadedBy: user.userId,
      });
      const enc = request.headers['x-voc-encrypted'] === '1';
      return maybeEncrypt(result, sessionAesKey(user), enc);
    } catch (e) {
      const err = e as { statusCode?: number; message?: string };
      const code =
        err.statusCode && err.statusCode >= 400 && err.statusCode < 600 ? err.statusCode : 500;
      return reply.code(code).send({
        error: code === 400 ? 'bad_request' : 'mapping_failed',
        message: err.message || 'Mapping upload failed',
      });
    }
  });

  app.get('/api/taxonomy', async (request, reply) => {
    const user = await requireUser(request);
    const access = await loadAccessForSession(user);
    assertPage(access, 'taxonomy');
    const enc = request.headers['x-voc-encrypted'] === '1';
    const query = request.query as Record<string, unknown>;
    const result = await listTaxonomy({
      taxonomyVersion: queryStr(query, 'version') || undefined,
    });
    return maybeEncrypt(result, sessionAesKey(user), enc);
  });

  app.get('/api/taxonomy/template', async (request, reply) => {
    const user = await requireUser(request);
    const access = await loadAccessForSession(user);
    assertPage(access, 'taxonomy');
    const buf = await buildTaxonomyTemplateBuffer();
    reply.header(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    reply.header(
      'Content-Disposition',
      'attachment; filename="voc_issue_taxonomy_template.xlsx"',
    );
    return reply.send(buf);
  });

  app.post('/api/taxonomy/file', async (request, reply) => {
    const user = await requireUser(request);
    const access = await loadAccessForSession(user);
    assertPage(access, 'taxonomy');
    const file = await request.file();
    if (!file) {
      return reply.code(400).send({ error: 'bad_request', message: 'file required' });
    }
    const buffer = await file.toBuffer();
    if (buffer.byteLength > 20 * 1024 * 1024) {
      return reply.code(400).send({ error: 'bad_request', message: 'file exceeds 20MiB' });
    }
    const query = request.query as Record<string, unknown>;
    try {
      const result = await processTaxonomyUpload({
        buffer,
        uploadedBy: user.userId,
        taxonomyVersion: queryStr(query, 'version') || undefined,
      });
      const enc = request.headers['x-voc-encrypted'] === '1';
      return maybeEncrypt(result, sessionAesKey(user), enc);
    } catch (e) {
      const err = e as { statusCode?: number; message?: string };
      const code =
        err.statusCode && err.statusCode >= 400 && err.statusCode < 600 ? err.statusCode : 500;
      return reply.code(code).send({
        error: code === 400 ? 'bad_request' : 'taxonomy_failed',
        message: err.message || 'Taxonomy upload failed',
      });
    }
  });

  app.post('/api/taxonomy', async (request, reply) => {
    const user = await requireUser(request);
    const access = await loadAccessForSession(user);
    assertPage(access, 'taxonomy');
    const enc = request.headers['x-voc-encrypted'] === '1';
    try {
      const body = await readJsonBody<IssueTaxonomyUpsertInput>(request, sessionAesKey(user));
      const item = await upsertTaxonomyItem({ body, updatedBy: user.userId });
      return maybeEncrypt(item, sessionAesKey(user), enc);
    } catch (e) {
      const err = e as { statusCode?: number; message?: string };
      const code =
        err.statusCode && err.statusCode >= 400 && err.statusCode < 600 ? err.statusCode : 500;
      return reply.code(code).send({
        error: code === 400 ? 'bad_request' : 'taxonomy_failed',
        message: err.message || 'Taxonomy save failed',
      });
    }
  });

  app.post('/api/taxonomy/versions', async (request, reply) => {
    const user = await requireUser(request);
    const access = await loadAccessForSession(user);
    assertPage(access, 'taxonomy');
    const enc = request.headers['x-voc-encrypted'] === '1';
    try {
      const result = await createTaxonomyVersion({ updatedBy: user.userId });
      return maybeEncrypt(result, sessionAesKey(user), enc);
    } catch (e) {
      const err = e as { statusCode?: number; message?: string };
      const code =
        err.statusCode && err.statusCode >= 400 && err.statusCode < 600 ? err.statusCode : 500;
      return reply.code(code).send({
        error: code === 400 ? 'bad_request' : 'taxonomy_failed',
        message: err.message || 'Create taxonomy version failed',
      });
    }
  });

  app.delete('/api/taxonomy/versions/:version', async (request, reply) => {
    const user = await requireUser(request);
    const access = await loadAccessForSession(user);
    assertPage(access, 'taxonomy');
    const enc = request.headers['x-voc-encrypted'] === '1';
    const { version } = request.params as { version: string };
    try {
      const result = await deleteTaxonomyVersion({ taxonomyVersion: version });
      return maybeEncrypt(result, sessionAesKey(user), enc);
    } catch (e) {
      const err = e as { statusCode?: number; message?: string };
      const code =
        err.statusCode && err.statusCode >= 400 && err.statusCode < 600 ? err.statusCode : 500;
      return reply.code(code).send({
        error: code === 400 || code === 404 ? 'bad_request' : 'taxonomy_failed',
        message: err.message || 'Delete taxonomy version failed',
      });
    }
  });
}
