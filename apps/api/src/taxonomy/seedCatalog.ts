/**
 * 美妆护肤差评问题分类树（与 VOC skill「差评说明」对齐）。
 * 来源：差评相关.xlsx → references/差评说明.md + build_voc_report CLASS_RULES
 * 业务复核后可在「问题分类树」页编辑；不是医学/真伪已证实结论。
 */
export type SeedIssue = {
  issueId: string;
  parentIssueId: string | null;
  issueLevel: 1 | 2;
  issueNameCn: string;
  issueNameEn?: string;
  issueDescription?: string;
  positiveExamples?: string[];
  issueOwnerTeam?: string;
  isSafetyRelated?: boolean;
  isProductControllable?: boolean;
  isLogisticsRelated?: boolean;
  defaultSeverity?: number;
};

type L1Def = {
  id: string;
  cn: string;
  en: string;
  owner: string;
  safety?: boolean;
  logistics?: boolean;
  product?: boolean;
  children: Array<{
    id: string;
    cn: string;
    en: string;
    desc?: string;
    examples?: string[];
    safety?: boolean;
    severity?: number;
  }>;
};

/** 美妆护肤市场：5 大类 + 二级（与现网差评归因一致） */
const BEAUTY_L1: L1Def[] = [
  {
    id: 'l1_packaging',
    cn: '包材质量问题',
    en: 'Packaging quality',
    owner: 'product',
    product: true,
    children: [
      {
        id: 'l2_seal_defect',
        cn: '密封缺陷',
        en: 'Seal defect',
        examples: ['漏液', 'Leaking', '漏粉', '溢出', '密封贴破损'],
        severity: 4,
      },
      {
        id: 'l2_component_fail',
        cn: '功能组件失效',
        en: 'Component failure',
        examples: ['泵头按不出', 'Pump Broken', '喷嘴堵塞', '泥膜棒无法旋转', '盖子无法拧紧'],
        severity: 4,
      },
      {
        id: 'l2_physical_damage',
        cn: '物理破损/裂纹',
        en: 'Physical damage/crack',
        examples: ['盖子开裂', 'Broken Cap', '瓶身变形', '粉扑裂纹', '粉饼表面碎裂'],
        severity: 4,
      },
      {
        id: 'l2_pack_craft',
        cn: '包材工艺瑕疵',
        en: 'Packaging craft defect',
        examples: ['印刷脱落', '瓶底异物', '容量标注不准', '注塑毛刺'],
        severity: 3,
      },
    ],
  },
  {
    id: 'l1_product_experience',
    cn: '产品使用体验感不满意',
    en: 'Product usage experience',
    owner: 'product',
    product: true,
    children: [
      {
        id: 'l2_stability',
        cn: '稳定性/变质',
        en: 'Stability/spoilage',
        examples: ['氧化变色', 'Yellowing', '水油分离', '分层', '析出', '异物感'],
        severity: 4,
      },
      {
        id: 'l2_sensory',
        cn: '感官/肤感异常',
        en: 'Sensory/texture issue',
        examples: ['刺鼻异味', '太粘', '太干', '厚重卡粉', '结块', '颗粒感', '拔干'],
        severity: 3,
      },
      {
        id: 'l2_efficacy',
        cn: '功效/妆效落差',
        en: 'Efficacy/finish gap',
        examples: ['不持久', 'Not Long Lasting', '不显色', '不防水', '控油不明显', '美白不明显', '没效果'],
        severity: 3,
      },
      {
        id: 'l2_safety',
        cn: '安全性/过敏',
        en: 'Safety/allergy',
        examples: ['过敏', '红肿', '刺痛', 'Stinging', '灼烧感', '长痘', '起皮'],
        safety: true,
        severity: 5,
      },
      {
        id: 'l2_poor_quality',
        cn: '质量差',
        en: 'Poor quality',
        examples: ['质量差', 'poor quality', 'cheap quality'],
        severity: 3,
      },
    ],
  },
  {
    id: 'l1_logistics',
    cn: '物流问题',
    en: 'Logistics',
    owner: 'logistics',
    logistics: true,
    children: [
      {
        id: 'l2_delivery_fail',
        cn: '交付异常',
        en: 'Delivery failure',
        examples: ['签收未收到', '包裹丢失', 'never received'],
        severity: 4,
      },
      {
        id: 'l2_shipping_delay',
        cn: '物流时效',
        en: 'Shipping delay',
        examples: ['运输时间过长', '延误', '轨迹停滞', '清关慢'],
        severity: 3,
      },
      {
        id: 'l2_arrive_damaged',
        cn: '到货即损',
        en: 'Damaged on arrival',
        examples: ['arrived broken', '运输破损', '到货破损'],
        severity: 4,
      },
      {
        id: 'l2_wrong_missing',
        cn: '错漏发',
        en: 'Wrong/missing shipment',
        examples: ['仓内错发', '漏发', 'wrong item', 'missing'],
        severity: 4,
      },
      {
        id: 'l2_logistics_return',
        cn: '物流异常回退',
        en: 'Logistics return anomaly',
        examples: ['物流回退', '退回发件地'],
        severity: 3,
      },
    ],
  },
  {
    id: 'l1_cs',
    cn: '客服问题',
    en: 'Customer service',
    owner: 'cs',
    children: [
      {
        id: 'l2_cs_response',
        cn: '响应时效',
        en: 'Response time',
        examples: ['长时间无人回复', '回复滞后', '反复催促'],
        severity: 3,
      },
      {
        id: 'l2_cs_expertise',
        cn: '专业度不足',
        en: 'Lack of expertise',
        examples: ['答非所问', '不熟悉政策', '信息前后矛盾'],
        severity: 3,
      },
      {
        id: 'l2_cs_attitude',
        cn: '服务态度问题',
        en: 'Service attitude',
        examples: ['语气敷衍', '推诿责任', '争执'],
        severity: 3,
      },
      {
        id: 'l2_cs_after_sales',
        cn: '售后处理',
        en: 'After-sales handling',
        examples: ['退款困难', '不及时升级', '解决方案不满意'],
        severity: 3,
      },
    ],
  },
  {
    id: 'l1_other',
    cn: '其他问题',
    en: 'Other',
    owner: 'ops',
    children: [
      {
        id: 'l2_price_promo',
        cn: '价格/促销落差',
        en: 'Price/promo gap',
        examples: ['差价退款', '未收到赠品', '折扣不一致', '性价比低'],
        severity: 2,
      },
      {
        id: 'l2_no_reason',
        cn: '无理由',
        en: 'No reason given',
        examples: ['差评理由空白', '退货选择无理由'],
        severity: 1,
      },
      {
        id: 'l2_expectation',
        cn: '认知/预期落差',
        en: 'Expectation mismatch',
        examples: ['产地争议', '看错描述', '主观不喜欢', '买错色号'],
        severity: 2,
      },
      {
        id: 'l2_process',
        cn: '流程流转',
        en: 'Process friction',
        examples: ['流程复杂', '所需时间长'],
        severity: 2,
      },
      {
        id: 'l2_vs_claim',
        cn: '与宣传不符',
        en: 'Not as advertised',
        examples: ['虚假宣传', '与官网不符', 'false advertising'],
        severity: 3,
      },
    ],
  },
];

/** @deprecated 方案 §8.3 通用候选；美妆业务请用 buildBeautySkincareSeedIssues */
export function buildSchema83SeedIssues(): SeedIssue[] {
  return buildBeautySkincareSeedIssues();
}

export function buildBeautySkincareSeedIssues(): SeedIssue[] {
  const out: SeedIssue[] = [];
  for (const l1 of BEAUTY_L1) {
    out.push({
      issueId: l1.id,
      parentIssueId: null,
      issueLevel: 1,
      issueNameCn: l1.cn,
      issueNameEn: l1.en,
      issueDescription: `美妆护肤差评大类：${l1.cn}`,
      issueOwnerTeam: l1.owner,
      isSafetyRelated: Boolean(l1.safety),
      isProductControllable: Boolean(l1.product),
      isLogisticsRelated: Boolean(l1.logistics),
      defaultSeverity: l1.safety ? 5 : 3,
      positiveExamples: [],
    });
    for (const c of l1.children) {
      out.push({
        issueId: c.id,
        parentIssueId: l1.id,
        issueLevel: 2,
        issueNameCn: c.cn,
        issueNameEn: c.en,
        issueDescription: c.desc,
        positiveExamples: c.examples ?? [],
        issueOwnerTeam: l1.owner,
        isSafetyRelated: Boolean(c.safety || l1.safety),
        isProductControllable: Boolean(l1.product),
        isLogisticsRelated: Boolean(l1.logistics),
        defaultSeverity: c.severity ?? (c.safety ? 5 : 3),
      });
    }
  }
  return out;
}
