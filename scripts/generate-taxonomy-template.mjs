/**
 * 生成美妆护肤问题分类树 Excel（可直接在「问题分类树」页导入）
 * 运行：NODE_PATH=apps/api/node_modules node scripts/generate-taxonomy-template.mjs
 */
import ExcelJS from 'exceljs';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..');

const HEADERS = [
  'issue_id',
  'parent_issue_id',
  'issue_level',
  'issue_name_cn',
  'issue_name_en',
  'issue_description',
  'positive_examples',
  'negative_examples',
  'exclusion_rules',
  'issue_owner_team',
  'default_severity',
  'is_safety_related',
  'is_product_controllable',
  'is_logistics_related',
  'active_status',
];

/** 与 apps/api/src/taxonomy/seedCatalog.ts 美妆护肤树一致 */
const TREE = [
  {
    id: 'l1_packaging',
    cn: '包材质量问题',
    en: 'Packaging quality',
    owner: 'product',
    product: true,
    children: [
      ['l2_seal_defect', '密封缺陷', 'Seal defect', '漏液|Leaking|漏粉|溢出|密封贴破损', 4],
      ['l2_component_fail', '功能组件失效', 'Component failure', '泵头按不出|Pump Broken|喷嘴堵塞|泥膜棒无法旋转|盖子无法拧紧', 4],
      ['l2_physical_damage', '物理破损/裂纹', 'Physical damage/crack', '盖子开裂|Broken Cap|瓶身变形|粉扑裂纹|粉饼表面碎裂', 4],
      ['l2_pack_craft', '包材工艺瑕疵', 'Packaging craft defect', '印刷脱落|瓶底异物|容量标注不准|注塑毛刺', 3],
    ],
  },
  {
    id: 'l1_product_experience',
    cn: '产品使用体验感不满意',
    en: 'Product usage experience',
    owner: 'product',
    product: true,
    children: [
      ['l2_stability', '稳定性/变质', 'Stability/spoilage', '氧化变色|Yellowing|水油分离|分层|析出|异物感', 4],
      ['l2_sensory', '感官/肤感异常', 'Sensory/texture issue', '刺鼻异味|太粘|太干|厚重卡粉|结块|颗粒感|拔干', 3],
      ['l2_efficacy', '功效/妆效落差', 'Efficacy/finish gap', '不持久|Not Long Lasting|不显色|不防水|控油不明显|美白不明显|没效果', 3],
      ['l2_safety', '安全性/过敏', 'Safety/allergy', '过敏|红肿|刺痛|Stinging|灼烧感|长痘|起皮', 5, true],
      ['l2_poor_quality', '质量差', 'Poor quality', '质量差|poor quality|cheap quality', 3],
    ],
  },
  {
    id: 'l1_logistics',
    cn: '物流问题',
    en: 'Logistics',
    owner: 'logistics',
    logistics: true,
    children: [
      ['l2_delivery_fail', '交付异常', 'Delivery failure', '签收未收到|包裹丢失|never received', 4],
      ['l2_shipping_delay', '物流时效', 'Shipping delay', '运输时间过长|延误|轨迹停滞|清关慢', 3],
      ['l2_arrive_damaged', '到货即损', 'Damaged on arrival', 'arrived broken|运输破损|到货破损', 4],
      ['l2_wrong_missing', '错漏发', 'Wrong/missing shipment', '仓内错发|漏发|wrong item|missing', 4],
      ['l2_logistics_return', '物流异常回退', 'Logistics return anomaly', '物流回退|退回发件地', 3],
    ],
  },
  {
    id: 'l1_cs',
    cn: '客服问题',
    en: 'Customer service',
    owner: 'cs',
    children: [
      ['l2_cs_response', '响应时效', 'Response time', '长时间无人回复|回复滞后|反复催促', 3],
      ['l2_cs_expertise', '专业度不足', 'Lack of expertise', '答非所问|不熟悉政策|信息前后矛盾', 3],
      ['l2_cs_attitude', '服务态度问题', 'Service attitude', '语气敷衍|推诿责任|争执', 3],
      ['l2_cs_after_sales', '售后处理', 'After-sales handling', '退款困难|不及时升级|解决方案不满意', 3],
    ],
  },
  {
    id: 'l1_other',
    cn: '其他问题',
    en: 'Other',
    owner: 'ops',
    children: [
      ['l2_price_promo', '价格/促销落差', 'Price/promo gap', '差价退款|未收到赠品|折扣不一致|性价比低', 2],
      ['l2_no_reason', '无理由', 'No reason given', '差评理由空白|退货选择无理由', 1],
      ['l2_expectation', '认知/预期落差', 'Expectation mismatch', '产地争议|看错描述|主观不喜欢|买错色号', 2],
      ['l2_process', '流程流转', 'Process friction', '流程复杂|所需时间长', 2],
      ['l2_vs_claim', '与宣传不符', 'Not as advertised', '虚假宣传|与官网不符|false advertising', 3],
    ],
  },
];

function yn(v) {
  return v ? 'yes' : 'no';
}

async function main() {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'fm-voc-system';
  const tip = wb.addWorksheet('00_说明');
  tip.getColumn(1).width = 18;
  tip.getColumn(2).width = 72;
  [
    ['美妆护肤问题分类树', ''],
    ['来源', 'VOC 差评说明（SKT/TP 现网归因大类/二级）'],
    ['用途', '导入工作台「分析 → 问题分类树」；版本建议填 v1'],
    ['规则', '第 1 行英文列名勿改；第 2 行为提示行；数据从第 3 行起'],
  ].forEach((line, i) => {
    tip.getRow(i + 1).getCell(1).value = line[0];
    tip.getRow(i + 1).getCell(2).value = line[1];
  });

  const ws = wb.addWorksheet('01_问题分类');
  ws.addRow(HEADERS);
  ws.addRow([
    '提示行可删',
    '',
    '',
    '中文名',
    '英文名',
    '说明',
    '样例用|分隔',
    '',
    '',
    '责任域',
    '1-5',
    'yes/no',
    'yes/no',
    'yes/no',
    'active',
  ]);

  for (const l1 of TREE) {
    ws.addRow([
      l1.id,
      '',
      1,
      l1.cn,
      l1.en,
      `美妆护肤差评大类：${l1.cn}`,
      '',
      '',
      '',
      l1.owner,
      l1.safety ? 5 : 3,
      yn(l1.safety),
      yn(l1.product),
      yn(l1.logistics),
      'active',
    ]);
    for (const c of l1.children) {
      const [id, cn, en, examples, sev, safety] = c;
      ws.addRow([
        id,
        l1.id,
        2,
        cn,
        en,
        '',
        examples,
        '',
        '',
        l1.owner,
        sev,
        yn(safety),
        yn(l1.product),
        yn(l1.logistics),
        'active',
      ]);
    }
  }

  const targets = [
    join(root, 'docs/templates/voc_issue_taxonomy_beauty_skincare_v1.xlsx'),
    join(root, 'apps/web/public/templates/voc_issue_taxonomy_beauty_skincare_v1.xlsx'),
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
