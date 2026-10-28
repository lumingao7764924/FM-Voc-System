import { Readable } from 'node:stream';
import ExcelJS from 'exceljs';
import { normalizeOoxmlBuffer } from './normalizeOoxml.js';

/**
 * 安全加载 xlsx：校验魔数，并把带命名空间前缀 / `t="d"` ISO 日期的导出
 * 收成 ExcelJS 能读的 OOXML，再用 read(stream) 加载。
 */
export async function loadWorkbookFromBuffer(input: Buffer): Promise<ExcelJS.Workbook> {
  const raw = Buffer.isBuffer(input) ? input : Buffer.from(input);
  if (!raw.length) {
    throw Object.assign(new Error('上传文件为空，请重新选择 xlsx'), { statusCode: 400 });
  }

  // ZIP / OOXML：PK
  const isZip = raw[0] === 0x50 && raw[1] === 0x4b;
  // 旧版 .xls（OLE）：D0 CF 11 E0
  const isOle = raw[0] === 0xd0 && raw[1] === 0xcf && raw[2] === 0x11 && raw[3] === 0xe0;
  if (isOle) {
    throw Object.assign(
      new Error('不支持旧版 .xls，请用 Excel「另存为」成 .xlsx 后再上传'),
      { statusCode: 400 },
    );
  }
  if (!isZip) {
    throw Object.assign(
      new Error('文件不是有效的 .xlsx（可能是 CSV/HTML 改后缀）。请用系统模板或 Excel 另存为 .xlsx'),
      { statusCode: 400 },
    );
  }

  const buf = await normalizeOoxmlBuffer(raw);
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.read(Readable.from(buf));
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/sheets|workbook|zip|end of central directory|invalid/i.test(msg)) {
      throw Object.assign(
        new Error(
          `无法解析 Excel（${msg}）。请确认是未损坏的 .xlsx，且用本系统模板或 Excel 另存为后再试`,
        ),
        { statusCode: 400 },
      );
    }
    throw e;
  }

  if (!wb.worksheets?.length) {
    throw Object.assign(new Error('工作簿没有可用工作表'), { statusCode: 400 });
  }
  return wb;
}
