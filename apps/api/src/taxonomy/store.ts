import { BigQuery } from '@google-cloud/bigquery';
import {
  DEFAULT_TAXONOMY_VERSION,
  type IssueTaxonomyItem,
  type IssueTaxonomyListResponse,
} from '@voc/shared';
import { bqTimestampString } from '../bqValue.js';
import { env } from '../config.js';

/** 空版本占位行：保证版本出现在 DISTINCT 列表，列表接口会过滤掉 */
export const TAXONOMY_VERSION_MARKER_ID = '__taxonomy_version__';

const memoryByVersion = new Map<string, Map<string, Record<string, unknown>>>();

let bq: BigQuery | null = null;

function getBq(): BigQuery {
  if (!bq) bq = new BigQuery({ projectId: env.gcpProjectId });
  return bq;
}

function memMap(version: string) {
  let m = memoryByVersion.get(version);
  if (!m) {
    m = new Map();
    memoryByVersion.set(version, m);
  }
  return m;
}

function asStringArray(v: unknown): string[] {
  if (Array.isArray(v)) return v.map((x) => String(x)).filter(Boolean);
  if (typeof v === 'string' && v.trim()) return [v.trim()];
  return [];
}

function isVersionMarker(issueId: string) {
  return issueId === TAXONOMY_VERSION_MARKER_ID;
}

export function buildVersionMarkerRow(
  taxonomyVersion: string,
  opts: { validFrom: string; updatedBy: string },
): Record<string, unknown> {
  return {
    issue_id: TAXONOMY_VERSION_MARKER_ID,
    taxonomy_version: taxonomyVersion,
    parent_issue_id: null,
    issue_level: 0,
    issue_name_cn: '(version)',
    issue_name_en: null,
    issue_description: null,
    positive_examples: [],
    negative_examples: [],
    exclusion_rules: [],
    issue_owner_team: null,
    default_severity: null,
    is_safety_related: false,
    is_product_controllable: false,
    is_logistics_related: false,
    active_status: 'inactive',
    valid_from: opts.validFrom,
    valid_to: null,
    updated_by: opts.updatedBy,
    source_reference: 'version_marker',
  };
}

export function mapTaxonomyRow(r: Record<string, unknown>): IssueTaxonomyItem {
  return {
    issueId: String(r.issue_id ?? ''),
    taxonomyVersion: String(r.taxonomy_version ?? DEFAULT_TAXONOMY_VERSION),
    parentIssueId: r.parent_issue_id != null && String(r.parent_issue_id) ? String(r.parent_issue_id) : null,
    issueLevel: Number(r.issue_level ?? 0),
    issueNameCn: String(r.issue_name_cn ?? ''),
    issueNameEn: r.issue_name_en != null ? String(r.issue_name_en) : null,
    issueDescription: r.issue_description != null ? String(r.issue_description) : null,
    positiveExamples: asStringArray(r.positive_examples),
    negativeExamples: asStringArray(r.negative_examples),
    exclusionRules: asStringArray(r.exclusion_rules),
    issueOwnerTeam: r.issue_owner_team != null ? String(r.issue_owner_team) : null,
    defaultSeverity:
      r.default_severity == null || r.default_severity === ''
        ? null
        : Number(r.default_severity),
    isSafetyRelated: Boolean(r.is_safety_related),
    isProductControllable: Boolean(r.is_product_controllable),
    isLogisticsRelated: Boolean(r.is_logistics_related),
    activeStatus: String(r.active_status ?? 'active'),
    validFrom: bqTimestampString(r.valid_from) ?? new Date().toISOString(),
    sourceReference: r.source_reference != null ? String(r.source_reference) : null,
  };
}

export function memoryUpsertTaxonomy(row: Record<string, unknown>) {
  const version = String(row.taxonomy_version ?? DEFAULT_TAXONOMY_VERSION);
  const id = String(row.issue_id ?? '');
  if (!id) return;
  memMap(version).set(id, row);
}

export function memoryHasIssue(version: string, issueId: string) {
  return memMap(version).has(issueId);
}

export function memoryDeleteVersion(version: string) {
  memoryByVersion.delete(version);
}

export function memoryListTaxonomy(version: string): IssueTaxonomyItem[] {
  return [...memMap(version).values()]
    .map(mapTaxonomyRow)
    .filter((i) => i.activeStatus === 'active' && !isVersionMarker(i.issueId))
    .sort((a, b) => {
      if (a.issueLevel !== b.issueLevel) return a.issueLevel - b.issueLevel;
      return a.issueId.localeCompare(b.issueId);
    });
}

export function memoryListVersions(): string[] {
  return [...memoryByVersion.keys()].sort();
}

export async function listTaxonomyVersions(): Promise<string[]> {
  if (env.importDryRun) {
    const mem = memoryListVersions();
    return mem.length ? mem : [DEFAULT_TAXONOMY_VERSION];
  }
  const project = env.gcpProjectId;
  try {
    const [rows] = await getBq().query({
      query: `
        SELECT DISTINCT taxonomy_version
        FROM \`${project}.review_semantic.dim_issue_taxonomy\`
        WHERE valid_to IS NULL
        ORDER BY taxonomy_version
      `,
    });
    const versions = (rows as Record<string, unknown>[])
      .map((r) => String(r.taxonomy_version ?? ''))
      .filter(Boolean);
    const merged = new Set([...versions, ...memoryListVersions()]);
    return merged.size ? [...merged].sort() : [DEFAULT_TAXONOMY_VERSION];
  } catch (e) {
    console.warn('[taxonomy] list versions failed', e instanceof Error ? e.message : e);
    const mem = memoryListVersions();
    return mem.length ? mem : [DEFAULT_TAXONOMY_VERSION];
  }
}

export async function listTaxonomy(opts: {
  taxonomyVersion?: string;
}): Promise<IssueTaxonomyListResponse> {
  const versions = await listTaxonomyVersions();
  const taxonomyVersion = opts.taxonomyVersion?.trim() || versions[0] || DEFAULT_TAXONOMY_VERSION;

  const fromMemory = (): IssueTaxonomyListResponse => {
    const items = memoryListTaxonomy(taxonomyVersion);
    return {
      taxonomyVersion,
      versions: versions.includes(taxonomyVersion)
        ? versions
        : [...versions, taxonomyVersion].sort(),
      items,
      total: items.length,
    };
  };

  if (env.importDryRun) return fromMemory();

  const project = env.gcpProjectId;
  try {
    const [rows] = await getBq().query({
      query: `
        SELECT *
        FROM \`${project}.review_semantic.dim_issue_taxonomy\`
        WHERE taxonomy_version = @version
          AND valid_to IS NULL
          AND active_status = 'active'
          AND issue_id != @marker
        ORDER BY issue_level, issue_id
      `,
      params: { version: taxonomyVersion, marker: TAXONOMY_VERSION_MARKER_ID },
    });
    const items = (rows as Record<string, unknown>[]).map(mapTaxonomyRow);
    const memExtra = memoryListTaxonomy(taxonomyVersion).filter(
      (m) => !items.some((i) => i.issueId === m.issueId),
    );
    const merged = [...items, ...memExtra];
    return {
      taxonomyVersion,
      versions,
      items: merged,
      total: merged.length,
    };
  } catch (e) {
    console.warn('[taxonomy] list failed, memory fallback', e instanceof Error ? e.message : e);
    return fromMemory();
  }
}

export async function findExistingIssueIds(
  taxonomyVersion: string,
  issueIds: string[],
): Promise<Set<string>> {
  const unique = [...new Set(issueIds.filter(Boolean))];
  const found = new Set<string>();
  for (const id of unique) {
    if (memoryHasIssue(taxonomyVersion, id)) found.add(id);
  }
  if (env.importDryRun || unique.length === 0) return found;

  const project = env.gcpProjectId;
  try {
    const [rows] = await getBq().query({
      query: `
        SELECT issue_id
        FROM \`${project}.review_semantic.dim_issue_taxonomy\`
        WHERE taxonomy_version = @version
          AND valid_to IS NULL
          AND issue_id IN UNNEST(@ids)
      `,
      params: { version: taxonomyVersion, ids: unique },
    });
    for (const r of rows as Record<string, unknown>[]) {
      const id = String(r.issue_id ?? '');
      if (id) found.add(id);
    }
  } catch (e) {
    console.warn('[taxonomy] find existing failed', e instanceof Error ? e.message : e);
  }
  return found;
}

export async function invalidateAndInsertTaxonomy(
  taxonomyVersion: string,
  overwriteIds: string[],
  newRows: Record<string, unknown>[],
  validFrom: string,
): Promise<void> {
  for (const row of newRows) memoryUpsertTaxonomy(row);

  if (env.importDryRun) return;

  const project = env.gcpProjectId;
  const table = getBq().dataset('review_semantic').table('dim_issue_taxonomy');

  if (overwriteIds.length > 0) {
    try {
      await getBq().query({
        query: `
          UPDATE \`${project}.review_semantic.dim_issue_taxonomy\`
          SET valid_to = @validFrom
          WHERE taxonomy_version = @version
            AND valid_to IS NULL
            AND issue_id IN UNNEST(@ids)
        `,
        params: { validFrom, version: taxonomyVersion, ids: overwriteIds },
      });
    } catch (e) {
      console.warn('[taxonomy] invalidate failed', e instanceof Error ? e.message : e);
      throw Object.assign(new Error('BigQuery invalidate taxonomy failed'), { statusCode: 500 });
    }
  }

  const chunk = 200;
  for (let i = 0; i < newRows.length; i += chunk) {
    try {
      await table.insert(newRows.slice(i, i + chunk), { ignoreUnknownValues: true });
    } catch (e) {
      const detail = e instanceof Error ? e.message : String(e);
      throw Object.assign(new Error(`BigQuery insert dim_issue_taxonomy failed — ${detail}`), {
        statusCode: 500,
      });
    }
  }
}

export async function closeEntireTaxonomyVersion(
  taxonomyVersion: string,
  validTo: string,
): Promise<void> {
  memoryDeleteVersion(taxonomyVersion);
  if (env.importDryRun) return;

  const project = env.gcpProjectId;
  try {
    await getBq().query({
      query: `
        UPDATE \`${project}.review_semantic.dim_issue_taxonomy\`
        SET valid_to = @validTo
        WHERE taxonomy_version = @version
          AND valid_to IS NULL
      `,
      params: { validTo, version: taxonomyVersion },
    });
  } catch (e) {
    console.warn('[taxonomy] close version failed', e instanceof Error ? e.message : e);
    throw Object.assign(new Error('BigQuery delete taxonomy version failed'), { statusCode: 500 });
  }
}

export function nextTaxonomyVersionName(existing: string[]): string {
  let max = 0;
  for (const v of existing) {
    const m = /^v(\d+)$/i.exec(v.trim());
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `v${max + 1}`;
}
