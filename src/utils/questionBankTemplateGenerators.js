// src/utils/questionBankTemplateGenerators.js
// Client-side generators and download triggers for Question Bank official templates

import * as XLSX from 'xlsx';
import JSZip from 'jszip';

/**
 * Tạo dữ liệu Workbook Excel chuẩn cho Question Bank
 * @returns {XLSX.WorkBook}
 */
export const buildQuestionBankExcelWorkbook = () => {
  const excelData = [
    ['type', 'question', 'option_a', 'option_b', 'option_c', 'option_d', 'correct_answer', 'reference_answer', 'points'],
    ['single_choice', '3 + 4 bằng bao nhiêu?', '6', '7', '8', '9', 'B', '', 1],
    ['single_choice', 'Số nào liền sau số 19?', '18', '19', '20', '21', 'C', '', 1],
    ['fill_blank', '10 - 4 = _____', '', '', '', '', '6', '', 1],
    ['essay', 'Em hãy trình bày cách tính 12 + 8.', '', '', '', '', '', 'Học sinh nêu được cách tính phù hợp và kết quả bằng 20.', 2]
  ];

  const wsCauHoi = XLSX.utils.aoa_to_sheet(excelData);

  const huongDanData = [
    ['HƯỚNG DẪN NHẬP DỮ LIỆU CÂU HỎI VÀO QUESTION BANK (V2A)'],
    [''],
    ['1. CÁC DẠNG CÂU HỎI HỖ TRỢ TRONG FILE MẪU V2A:'],
    ['- single_choice: Trắc nghiệm 1 đáp án đúng (cần option_a, option_b...; correct_answer dùng A/B/C/D hoặc nội dung đáp án).'],
    ['- fill_blank: Điền khuyết (correct_answer là đáp án đúng).'],
    ['- essay: Tự luận (reference_answer là đáp án/gợi ý chấm tham khảo).'],
    [''],
    ['2. CÁC CỘT DỮ LIỆU TRONG SHEET CauHoi:'],
    ['- type: Dạng câu hỏi (bắt buộc: single_choice, fill_blank, essay).'],
    ['- question: Nội dung đề bài câu hỏi (bắt buộc).'],
    ['- option_a, option_b, option_c, option_d: Các lựa chọn cho câu hỏi trắc nghiệm.'],
    ['- correct_answer: Đáp án đúng cho trắc nghiệm hoặc điền khuyết.'],
    ['- reference_answer: Đáp án gợi ý tham khảo cho câu tự luận.'],
    ['- points: Số điểm tham khảo cho Bài tập học thuật (Question Bank V2A không sử dụng points làm quyền/phân loại).'],
    [''],
    ['3. LƯU Ý QUAN TRỌNG:'],
    ['- Không đổi tên các cột header trong sheet CauHoi.'],
    ['- Không thêm công thức Excel vào các ô dữ liệu.'],
    ['- Tối đa 100 câu/lần nhập theo parser hiện tại.'],
    ['- Dùng file .xlsx hoặc .csv khi nhập Excel vào hệ thống.']
  ];

  const wsHuongDan = XLSX.utils.aoa_to_sheet(huongDanData);

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, wsCauHoi, 'CauHoi');
  XLSX.utils.book_append_sheet(wb, wsHuongDan, 'HuongDan');

  return wb;
};

/**
 * Sinh buffer nhị phân Excel (dùng được trên cả Node.js và Browser)
 * @returns {Uint8Array}
 */
export const generateQuestionBankExcelBuffer = () => {
  const wb = buildQuestionBankExcelWorkbook();
  const rawArray = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  return new Uint8Array(rawArray);
};

/**
 * Tải file mẫu Excel chuẩn Question Bank hoàn toàn ở Client-side (Offline 100%, không gọi network)
 */
export const downloadQuestionBankExcelTemplate = () => {
  try {
    const buffer = generateQuestionBankExcelBuffer();
    const blob = new Blob([buffer], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    });
    triggerBlobDownload(blob, 'Mau_Nhap_Cau_Hoi_Question_Bank.xlsx');
  } catch (err) {
    console.error('Lỗi khi tải file mẫu Excel:', err);
  }
};

/**
 * Tạo JSZip instance chứa cấu trúc OpenXML DOCX chuẩn
 * @returns {JSZip}
 */
export const buildQuestionBankDocxZip = () => {
  const wordLines = [
    '[TRẮC NGHIỆM]',
    '',
    'Câu hỏi: 3 + 4 bằng bao nhiêu?',
    'A. 6',
    'B. 7',
    'C. 8',
    'D. 9',
    'Đáp án: B',
    'Điểm: 1',
    '',
    '[TRẮC NGHIỆM]',
    '',
    'Câu hỏi: Số nào liền sau số 19?',
    'A. 18',
    'B. 19',
    'C. 20',
    'D. 21',
    'Đáp án: C',
    'Điểm: 1',
    '',
    '[ĐIỀN KHUYẾT]',
    '',
    'Câu hỏi: 10 - 4 = _____',
    'Đáp án: 6',
    'Điểm: 1',
    '',
    '[TỰ LUẬN]',
    '',
    'Câu hỏi: Em hãy trình bày cách tính 12 + 8.',
    'Đáp án tham khảo: Học sinh nêu được cách tính phù hợp và kết quả bằng 20.',
    'Điểm: 2',
    '',
    'HƯỚNG DẪN',
    '',
    '- Giữ nguyên các nhãn:',
    '  [TRẮC NGHIỆM]',
    '  [ĐIỀN KHUYẾT]',
    '  [TỰ LUẬN]',
    '',
    '- Không đổi:',
    '  Câu hỏi:',
    '  Đáp án:',
    '  Đáp án tham khảo:',
    '  Điểm:',
    '',
    '- Mỗi câu cách nhau ít nhất 1 dòng trống.'
  ];

  function escapeXml(str) {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  const paragraphsXml = wordLines.map(line => {
    if (!line.trim()) {
      return '<w:p/>';
    }
    return `<w:p><w:r><w:t xml:space="preserve">${escapeXml(line)}</w:t></w:r></w:p>`;
  }).join('\n');

  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
            xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <w:body>
    ${paragraphsXml}
    <w:sectPr/>
  </w:body>
</w:document>`;

  const contentTypesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`;

  const relsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

  const docRelsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
</Relationships>`;

  const zip = new JSZip();
  zip.file('[Content_Types].xml', contentTypesXml);
  zip.file('_rels/.rels', relsXml);
  zip.file('word/document.xml', documentXml);
  zip.file('word/_rels/document.xml.rels', docRelsXml);

  return zip;
};

/**
 * Sinh buffer nhị phân DOCX OpenXML (dùng được trên cả Node.js và Browser)
 * @returns {Promise<Uint8Array>}
 */
export const generateQuestionBankDocxBuffer = async () => {
  const zip = buildQuestionBankDocxZip();
  return await zip.generateAsync({ type: 'uint8array' });
};

/**
 * Tải file mẫu Word (.docx) chuẩn Question Bank hoàn toàn ở Client-side (Offline 100%, không gọi network)
 */
export const downloadQuestionBankWordTemplate = async () => {
  try {
    const buffer = await generateQuestionBankDocxBuffer();
    const blob = new Blob([buffer], {
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    });
    triggerBlobDownload(blob, 'Mau_Nhap_Cau_Hoi_Question_Bank.docx');
  } catch (err) {
    console.error('Lỗi khi tải file mẫu Word:', err);
  }
};

/**
 * Helper kích hoạt download Blob trên trình duyệt mà không cần network
 * @param {Blob} blob
 * @param {string} filename
 */
export const triggerBlobDownload = (blob, filename) => {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1500);
};

export default {
  buildQuestionBankExcelWorkbook,
  generateQuestionBankExcelBuffer,
  downloadQuestionBankExcelTemplate,
  buildQuestionBankDocxZip,
  generateQuestionBankDocxBuffer,
  downloadQuestionBankWordTemplate,
  triggerBlobDownload
};