/**
 * 测试：SKU 映射与评论导入共用 apps/api/.env 的 IMPORT_DRY_RUN。
 * - true  → 对照表 + 评论都只写内存，不上传 BigQuery
 * - false → 两者都写 BigQuery（测试数据前缀 TEST-MAP-*）
 *
 * 运行：NODE_PATH=apps/api/node_modules npx tsx scripts/test-mapping-review-import.mts
 */
import ExcelJS from 'exceljs';
import { PRODUCT_MAPPING_HEADERS, REVIEW_IMPORT_HEADERS } from '@voc/shared';

// 不覆盖 IMPORT_DRY_RUN，交给 config 读 .env
const { env } = await import('../apps/api/src/config.ts');
const { processMappingUpload } = await import('../apps/api/src/mapping/service.ts');
const { createImportBatch, processImportFile } = await import('../apps/api/src/import/service.ts');

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

const stamp = Date.now().toString(36);
const SKU_HIT = `TEST-MAP-HIT-${stamp}`;
const SKU_MISS = `TEST-MAP-MISS-${stamp}`;

async function buildMappingXlsx(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('01_内部SKU主数据');
  ws.addRow([...PRODUCT_MAPPING_HEADERS]);
  ws.addRow(PRODUCT_MAPPING_HEADERS.map(() => '中文'));
  ws.addRow([
    'skt',
    'TEST-MAP-SPU',
    SKU_HIT,
    '映射测试产品',
    'map-test-product',
    '',
    '',
    'sku',
    `script-test-${stamp}`,
  ]);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

async function buildReviewXlsx(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('01_评论导入');
  ws.addRow([...REVIEW_IMPORT_HEADERS]);
  ws.addRow(REVIEW_IMPORT_HEADERS.map(() => '提示'));

  const base = {
    brand_key: 'skt',
    platform: 'amazon',
    country_code: 'US',
    store_id: '',
    source_channel_label: 'test',
    review_date: '2026-09-01',
    rating: '5',
    review_title: 'title',
    platform_product_name: 'p',
    asin: '',
    platform_product_id: '',
    media_urls: '',
    source_updated_at: '',
    helpful_vote_count: '',
    seller_reply_text: '',
  };

  // 行1：应命中映射 → confirmed，不计入 unmapped
  ws.addRow(
    REVIEW_IMPORT_HEADERS.map((h) => {
      if (h === 'source_review_id') return `rid-hit-${stamp}`;
      if (h === 'review_text') return `hit review ${stamp}`;
      if (h === 'platform_sku') return SKU_HIT;
      return (base as Record<string, string>)[h] ?? '';
    }),
  );
  // 行2：未命中 → pending，计入 unmapped
  ws.addRow(
    REVIEW_IMPORT_HEADERS.map((h) => {
      if (h === 'source_review_id') return `rid-miss-${stamp}`;
      if (h === 'review_text') return `miss review ${stamp}`;
      if (h === 'platform_sku') return SKU_MISS;
      return (base as Record<string, string>)[h] ?? '';
    }),
  );
  // 行3：店铺评论（无 platform_sku）→ 不计入 unmapped
  ws.addRow(
    REVIEW_IMPORT_HEADERS.map((h) => {
      if (h === 'source_review_id') return `rid-store-${stamp}`;
      if (h === 'review_text') return `store review ${stamp}`;
      if (h === 'platform_sku') return '';
      return (base as Record<string, string>)[h] ?? '';
    }),
  );

  return Buffer.from(await wb.xlsx.writeBuffer());
}

async function main() {
  console.log('=== 评论导入 × 产品映射 测试 ===');
  console.log(`IMPORT_DRY_RUN=${env.importDryRun}（SKU 映射与评论导入共用此开关）`);
  if (!env.importDryRun) {
    console.log('将写入 BigQuery/GCS；测试 SKU 前缀 TEST-MAP-*');
  } else {
    console.log('干跑：对照表与评论均只写内存');
  }

  // 1) 先入库一条内部 SKU 映射（同样受 IMPORT_DRY_RUN 控制）
  const mapResult = await processMappingUpload({
    buffer: await buildMappingXlsx(),
    uploadedBy: 'script-tester',
  });
  console.log('映射上传:', mapResult.message, `sku=${SKU_HIT}`, `dryRun=${mapResult.dryRun}`);
  assert(mapResult.dryRun === env.importDryRun, '映射结果 dryRun 应与 env 一致');
  assert(mapResult.added + mapResult.updated === 1, '映射应写入 1 条');

  // 2) 再走评论导入（与线上同一 processImportFile）
  const batch = await createImportBatch({
    requestIdempotencyKey: `map-test-${stamp}`,
    sourceFileName: `map-review-test-${stamp}.xlsx`,
    uploadedBy: 'script-tester',
  });
  const summary = await processImportFile({
    importBatchId: batch.importBatchId,
    buffer: await buildReviewXlsx(),
    contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    uploadedBy: 'script-tester',
  });

  console.log('评论导入结果:', {
    importBatchId: summary.importBatchId,
    importStatus: summary.importStatus,
    totalRows: summary.totalRows,
    newRows: summary.newRows,
    unmappedRows: summary.unmappedRows,
    quarantinedRows: summary.quarantinedRows,
    duplicateRows: summary.duplicateRows,
  });

  assert(summary.importStatus === 'completed', `状态应为 completed，实际 ${summary.importStatus}`);
  assert(summary.totalRows === 3, `总行应为 3，实际 ${summary.totalRows}`);
  assert(summary.newRows === 3, `成功入库应为 3，实际 ${summary.newRows}`);
  // 仅未命中的那 1 条商品评论计 unmapped；命中 + 店铺不计
  assert(
    summary.unmappedRows === 1,
    `待映射应为 1（仅 ${SKU_MISS}），实际 ${summary.unmappedRows} — 映射匹配未生效`,
  );

  console.log('\n通过 ✅ 评论导入时已按映射表匹配（命中 1 / 未命中 1 / 店铺不计）');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
