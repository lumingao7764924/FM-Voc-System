import {
  DEFAULT_TAXONOMY_VERSION,
  type IssueTaxonomyUploadResult,
  type IssueTaxonomyUpsertInput,
  type IssueTaxonomyItem,
  type IssueTaxonomyVersionResult,
} from '@voc/shared';
import { env } from '../config.js';
import { parseTaxonomyWorkbook, type ParsedTaxonomyRow } from './parseWorkbook.js';
import * as store from './store.js';

function toBqRow(
  row: {
    issueId: string;
    parentIssueId: string | null;
    issueLevel: number;
    issueNameCn: string;
    issueNameEn: string | null;
    issueDescription: string | null;
    positiveExamples: string[];
    negativeExamples: string[];
    exclusionRules: string[];
    issueOwnerTeam: string | null;
    defaultSeverity: number | null;
    isSafetyRelated: boolean;
    isProductControllable: boolean;
    isLogisticsRelated: boolean;
    activeStatus: string;
  },
  opts: { taxonomyVersion: string; validFrom: string; updatedBy: string; sourceReference: string },
): Record<string, unknown> {
  return {
    issue_id: row.issueId,
    taxonomy_version: opts.taxonomyVersion,
    parent_issue_id: row.parentIssueId || null,
    issue_level: row.issueLevel,
    issue_name_cn: row.issueNameCn,
    issue_name_en: row.issueNameEn || null,
    issue_description: row.issueDescription || null,
    positive_examples: row.positiveExamples,
    negative_examples: row.negativeExamples,
    exclusion_rules: row.exclusionRules,
    issue_owner_team: row.issueOwnerTeam || null,
    default_severity: row.defaultSeverity,
    is_safety_related: row.isSafetyRelated,
    is_product_controllable: row.isProductControllable,
    is_logistics_related: row.isLogisticsRelated,
    active_status: row.activeStatus || 'active',
    valid_from: opts.validFrom,
    valid_to: null,
    updated_by: opts.updatedBy,
    source_reference: opts.sourceReference,
  };
}

function fromParsed(row: ParsedTaxonomyRow) {
  return {
    issueId: row.issueId,
    parentIssueId: row.parentIssueId || null,
    issueLevel: row.issueLevel,
    issueNameCn: row.issueNameCn,
    issueNameEn: row.issueNameEn || null,
    issueDescription: row.issueDescription || null,
    positiveExamples: row.positiveExamples,
    negativeExamples: row.negativeExamples,
    exclusionRules: row.exclusionRules,
    issueOwnerTeam: row.issueOwnerTeam || null,
    defaultSeverity: row.defaultSeverity,
    isSafetyRelated: row.isSafetyRelated,
    isProductControllable: row.isProductControllable,
    isLogisticsRelated: row.isLogisticsRelated,
    activeStatus: row.activeStatus,
  };
}

export async function processTaxonomyUpload(input: {
  buffer: Buffer;
  uploadedBy: string;
  taxonomyVersion?: string;
}): Promise<IssueTaxonomyUploadResult> {
  const taxonomyVersion = input.taxonomyVersion?.trim() || DEFAULT_TAXONOMY_VERSION;
  const { rows } = await parseTaxonomyWorkbook(input.buffer);
  if (rows.length === 0) {
    throw Object.assign(new Error('No data rows found in taxonomy workbook'), { statusCode: 400 });
  }

  const invalid = rows.filter((r) => r.parseErrorCodes.length > 0);
  if (invalid.length > 0) {
    const sample = invalid
      .slice(0, 5)
      .map((r) => `行 ${r.sourceRowNumber}: ${r.parseErrorCodes.join(',')}`)
      .join('；');
    throw Object.assign(new Error(`校验失败 ${invalid.length} 行。${sample}`), { statusCode: 400 });
  }

  const firstById = new Map<string, ParsedTaxonomyRow>();
  for (const row of rows) {
    if (!firstById.has(row.issueId)) firstById.set(row.issueId, row);
  }
  const unique = [...firstById.values()];
  const existing = await store.findExistingIssueIds(
    taxonomyVersion,
    unique.map((r) => r.issueId),
  );

  const validFrom = new Date().toISOString();
  let added = 0;
  let updated = 0;
  const overwriteIds: string[] = [];
  const bqRows: Record<string, unknown>[] = [];

  for (const row of unique) {
    const isUpdate = existing.has(row.issueId);
    if (isUpdate) {
      updated += 1;
      overwriteIds.push(row.issueId);
    } else {
      added += 1;
    }
    bqRows.push(
      toBqRow(fromParsed(row), {
        taxonomyVersion,
        validFrom,
        updatedBy: input.uploadedBy,
        sourceReference: 'excel',
      }),
    );
  }

  await store.invalidateAndInsertTaxonomy(taxonomyVersion, overwriteIds, bqRows, validFrom);

  return {
    taxonomyVersion,
    added,
    updated,
    totalRows: unique.length,
    dryRun: env.importDryRun,
    message: `新增 ${added}，覆盖 ${updated}${env.importDryRun ? '（干跑，未写 BigQuery）' : ''}`,
  };
}

export async function upsertTaxonomyItem(input: {
  body: IssueTaxonomyUpsertInput;
  updatedBy: string;
}): Promise<IssueTaxonomyItem> {
  const taxonomyVersion = input.body.taxonomyVersion?.trim() || DEFAULT_TAXONOMY_VERSION;
  const nameCn = (input.body.issueNameCn ?? '').trim();
  if (!nameCn) {
    throw Object.assign(new Error('issue_name_cn required'), { statusCode: 400 });
  }
  const level = Number(input.body.issueLevel);
  if (![1, 2, 3].includes(level)) {
    throw Object.assign(new Error('issue_level must be 1, 2 or 3'), { statusCode: 400 });
  }
  let issueId = (input.body.issueId ?? '').trim();
  if (!issueId) {
    const base = nameCn
      .toLowerCase()
      .replace(/\s+/g, '_')
      .replace(/[^a-z0-9_\u4e00-\u9fff-]/g, '')
      .slice(0, 48);
    issueId = `l${level}_${base || 'issue'}`;
  }
  const parent = (input.body.parentIssueId ?? '').trim() || null;
  if (level >= 2 && !parent) {
    throw Object.assign(new Error('L2/L3 需要 parent_issue_id'), { statusCode: 400 });
  }
  if (level === 1 && parent) {
    throw Object.assign(new Error('L1 不应有 parent_issue_id'), { statusCode: 400 });
  }

  const existing = await store.findExistingIssueIds(taxonomyVersion, [issueId]);
  const validFrom = new Date().toISOString();
  const row = toBqRow(
    {
      issueId,
      parentIssueId: parent,
      issueLevel: level,
      issueNameCn: nameCn,
      issueNameEn: input.body.issueNameEn?.trim() || null,
      issueDescription: input.body.issueDescription?.trim() || null,
      positiveExamples: input.body.positiveExamples ?? [],
      negativeExamples: input.body.negativeExamples ?? [],
      exclusionRules: input.body.exclusionRules ?? [],
      issueOwnerTeam: input.body.issueOwnerTeam?.trim() || null,
      defaultSeverity: input.body.defaultSeverity ?? null,
      isSafetyRelated: Boolean(input.body.isSafetyRelated),
      isProductControllable: Boolean(input.body.isProductControllable),
      isLogisticsRelated: Boolean(input.body.isLogisticsRelated),
      activeStatus: input.body.activeStatus === 'inactive' ? 'inactive' : 'active',
    },
    {
      taxonomyVersion,
      validFrom,
      updatedBy: input.updatedBy,
      sourceReference: 'manual',
    },
  );

  await store.invalidateAndInsertTaxonomy(
    taxonomyVersion,
    existing.has(issueId) ? [issueId] : [],
    [row],
    validFrom,
  );

  return store.mapTaxonomyRow(row);
}

export async function createTaxonomyVersion(input: {
  updatedBy: string;
}): Promise<IssueTaxonomyVersionResult> {
  const existing = await store.listTaxonomyVersions();
  const taxonomyVersion = store.nextTaxonomyVersionName(existing);
  if (existing.includes(taxonomyVersion)) {
    throw Object.assign(new Error(`版本 ${taxonomyVersion} 已存在`), { statusCode: 400 });
  }
  const validFrom = new Date().toISOString();
  const marker = store.buildVersionMarkerRow(taxonomyVersion, {
    validFrom,
    updatedBy: input.updatedBy,
  });
  await store.invalidateAndInsertTaxonomy(taxonomyVersion, [], [marker], validFrom);
  const versions = await store.listTaxonomyVersions();
  return {
    taxonomyVersion,
    versions: versions.includes(taxonomyVersion)
      ? versions
      : [...versions, taxonomyVersion].sort(),
    dryRun: env.importDryRun,
    message: `已创建空版本 ${taxonomyVersion}${env.importDryRun ? '（干跑）' : ''}，可导入分类表`,
  };
}

export async function deleteTaxonomyVersion(input: {
  taxonomyVersion: string;
}): Promise<IssueTaxonomyVersionResult> {
  const version = input.taxonomyVersion.trim();
  if (!version) {
    throw Object.assign(new Error('version required'), { statusCode: 400 });
  }
  const existing = await store.listTaxonomyVersions();
  if (!existing.includes(version)) {
    throw Object.assign(new Error(`版本 ${version} 不存在`), { statusCode: 404 });
  }
  if (existing.length <= 1) {
    throw Object.assign(new Error('至少保留一个版本'), { statusCode: 400 });
  }
  const validTo = new Date().toISOString();
  await store.closeEntireTaxonomyVersion(version, validTo);
  const versions = (await store.listTaxonomyVersions()).filter((v) => v !== version);
  const next = versions[0] || DEFAULT_TAXONOMY_VERSION;
  return {
    taxonomyVersion: next,
    versions: versions.length ? versions : [DEFAULT_TAXONOMY_VERSION],
    dryRun: env.importDryRun,
    message: `已删除版本 ${version}${env.importDryRun ? '（干跑）' : ''}`,
  };
}
