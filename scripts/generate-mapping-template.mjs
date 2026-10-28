/**
 * 生成内部 SKU 主数据导入模板 voc_product_mapping_template.xlsx
 * 定位：公司内部产品目录（与平台无关）；评论导入时用 platform_sku 与此表 internal_sku 匹配。
 * 运行：NODE_PATH=apps/api/node_modules node scripts/generate-mapping-template.mjs
 */
import ExcelJS from 'exceljs';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..');

const HEADERS_EN = [
  'brand_key',
  'internal_spu',
  'internal_sku',
  'product_name_cn',
  'product_name_en',
  'shade_code',
  'shade_name',
  'mapping_granularity',
  'source_reference',
];

const HEADERS_ZH = [
  '品牌键',
  '内部SPU',
  '内部SKU',
  '中文名(可空)',
  '英文名(可空)',
  '色号(可空)',
  '色号名(可空)',
  '粒度',
  '来源说明',
];

const EXAMPLES = [
  [
    'skt',
    'SKINTIFIC-123',
    'SKINTIFIC-1231',
    '唇部精华',
    'peptide-brightening-lip-serum',
    '',
    '',
    'sku',
    '示例，上传前请删',
  ],
  [
    'skt',
    'SKINTIFIC-123',
    'SKINTIFIC-12310U',
    '唇部精华',
    'peptide-brightening-lip-serum',
    '',
    '',
    'sku',
    '示例，上传前请删',
  ],
];

function styleHeaderRow(row) {
  row.font = { bold: true };
  row.alignment = { vertical: 'middle', wrapText: true };
  row.height = 22;
}

function styleExampleRow(row) {
  row.font = { color: { argb: 'FF666666' } };
}

async function buildWorkbook() {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'fm-voc-system';
  wb.created = new Date();

  const guide = wb.addWorksheet('00_请先看这里');
  guide.getColumn(1).width = 20;
  guide.getColumn(2).width = 76;
  const guideLines = [
    ['内部 SKU 主数据模板', ''],
    ['这是什么', '公司内部的 SPU/SKU 产品目录，与 Amazon/TikTok 等平台无关。'],
    ['怎么用来映射评论', '评论 Excel 里的 platform_sku 列，与本表 internal_sku 匹配；命中则写入内部 SPU/中文名等。'],
    ['填写规则', '第 1 行英文列名勿改；第 2 行中文说明；数据从第 3 行起。同 SPU 多 SKU 时可合并 brand/SPU/名称列。'],
    ['必填', 'brand_key、internal_spu、internal_sku、mapping_granularity。中英文名至少填一个即可。'],
    ['组合装', '含 + 的组合 SKU 整行保留、不拆分；没有 SPU 的套组不要写入本表。'],
    ['mapping_granularity', 'sku = 到变体/单 SKU；spu = 只到 SPU。'],
    ['source_reference', '会入库（dim_product_mapping.source_reference）；可填表名或「手工维护」。'],
    ['notes', '不入库，本模板已去掉该列。'],
    ['已有数据', '桌面 voc_internal_sku_master_from_差评相关.xlsx 由差评相关.xlsx 转换而来。'],
  ];
  guideLines.forEach((line, i) => {
    const row = guide.getRow(i + 1);
    row.getCell(1).value = line[0];
    row.getCell(2).value = line[1];
    if (i === 0) row.font = { bold: true, size: 14 };
  });

  const ws = wb.addWorksheet('01_内部SKU主数据');
  ws.views = [{ state: 'frozen', ySplit: 2 }];
  HEADERS_EN.forEach((h, i) => {
    ws.getColumn(i + 1).width = Math.max(14, h.length + 2);
  });

  const r1 = ws.getRow(1);
  HEADERS_EN.forEach((h, i) => {
    r1.getCell(i + 1).value = h;
  });
  styleHeaderRow(r1);

  const r2 = ws.getRow(2);
  HEADERS_ZH.forEach((h, i) => {
    r2.getCell(i + 1).value = h;
  });
  styleHeaderRow(r2);

  EXAMPLES.forEach((ex, idx) => {
    const row = ws.getRow(3 + idx);
    ex.forEach((v, i) => {
      row.getCell(i + 1).value = v;
    });
    styleExampleRow(row);
  });
  // demo merge for example SPU
  ws.mergeCells(3, 1, 4, 1);
  ws.mergeCells(3, 2, 4, 2);
  ws.mergeCells(3, 4, 4, 4);
  ws.mergeCells(3, 5, 4, 5);

  return wb;
}

async function main() {
  const wb = await buildWorkbook();
  const targets = [
    join(root, 'docs/templates/voc_product_mapping_template.xlsx'),
    join(root, 'apps/web/public/templates/voc_product_mapping_template.xlsx'),
  ];
  for (const out of targets) {
    mkdirSync(dirname(out), { recursive: true });
    await wb.xlsx.writeFile(out);
    console.log('wrote', out);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
