import * as XLSX from 'xlsx';

/**
 * Sanitizes values to prevent spreadsheet formula injection attacks (CSV/Excel Injection).
 * Any text value starting with '=', '+', '-', '@' (excluding valid numeric strings) is prefixed with an apostrophe.
 */
export function sanitizeForFormulaInjection(val) {
  if (val === null || val === undefined) return '';
  if (typeof val === 'number' || typeof val === 'boolean') return val;
  const str = String(val);
  const trimmed = str.trimStart();
  if (trimmed.length > 0 && ['=', '+', '-', '@'].includes(trimmed[0])) {
    // Retain clean numeric values e.g. "-10", "+5.5"
    if (/^[+-]?\d+(\.\d+)?$/.test(trimmed)) {
      return str;
    }
    return `'${str}`;
  }
  return str;
}

/**
 * Escapes a single cell value for standard RFC-4180 CSV output.
 */
export function escapeCsvValue(value) {
  if (value === null || value === undefined) return '';
  const sanitized = sanitizeForFormulaInjection(value);
  const str = String(sanitized);
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/**
 * Formats question types to teacher-friendly Vietnamese labels.
 */
export function formatQuestionType(type) {
  switch (type) {
    case 'single_choice':
      return 'Trắc nghiệm đơn';
    case 'true_false':
      return 'Đúng/Sai';
    case 'multiple_choice':
      return 'Nhiều đáp án';
    case 'short_answer':
      return 'Tự luận ngắn';
    default:
      return type || 'N/A';
  }
}

/**
 * Formats option distribution summary for CSV/Excel export.
 * Short answer questions strictly mask student raw text.
 */
export function formatOptionDistribution(question) {
  if (!question) return '';
  if (question.question_type === 'short_answer') {
    return 'Tự luận ngắn - không xuất câu trả lời thô';
  }
  if (Array.isArray(question.option_distribution) && question.option_distribution.length > 0) {
    return question.option_distribution.map((opt) => {
      const isCorrect = opt.is_correct_option ?? opt.is_correct ?? false;
      const correctTag = isCorrect ? ' [Đúng]' : '';
      const text = sanitizeForFormulaInjection(opt.option_text || 'Lựa chọn');
      const count = opt.selection_count ?? 0;
      const percent = opt.selection_percent ?? 0;
      return `${text}: ${count} (${percent}%)${correctTag}`;
    }).join(' | ');
  }
  return '';
}

/**
 * Sanitizes room code or title into a safe filename part.
 */
export function sanitizeFilenamePart(value, defaultValue = 'competition') {
  if (!value || typeof value !== 'string') return defaultValue;
  const cleaned = value.replace(/[\/\\:*?"<>|\x00-\x1F\x7F]/g, '').trim().replace(/\s+/g, '-');
  return cleaned || defaultValue;
}

/**
 * Deterministic timestamp formatter for filenames (YYYYMMDD-HHmmss).
 */
export function formatExportTimestamp(date = new Date()) {
  const d = date instanceof Date ? date : new Date(date);
  const pad = (n) => String(n).padStart(2, '0');
  const yyyy = d.getFullYear();
  const mm = pad(d.getMonth() + 1);
  const dd = pad(d.getDate());
  const hh = pad(d.getHours());
  const min = pad(d.getMinutes());
  const ss = pad(d.getSeconds());
  return `${yyyy}${mm}${dd}-${hh}${min}${ss}`;
}

/**
 * Resolves the display name for export and print.
 * When isAnonymized is true, returns 'Thí sinh N' strictly based on array position.
 */
export function getExportDisplayName(row, index, isAnonymized = false) {
  if (isAnonymized) {
    return `Thí sinh ${index + 1}`;
  }
  return (row && row.display_name) ? row.display_name : 'Thí sinh';
}

/**
 * Pure filter for leaderboard rows based on backend rank.
 * Preserves exact original row ordering and tie groups. Zero rank recalculation.
 */
export function filterLeaderboardByRank(leaderboardData, topN = 'all') {
  if (!Array.isArray(leaderboardData)) return [];
  if (topN === 'all' || topN === null || topN === undefined) {
    return [...leaderboardData];
  }
  const numericLimit = Number(topN);
  if (!Number.isFinite(numericLimit) || numericLimit <= 0) {
    return [...leaderboardData];
  }
  return leaderboardData.filter((row) => {
    if (!row || typeof row !== 'object') return false;
    if (row.rank === null || row.rank === undefined) return false;
    const rankNum = Number(row.rank);
    return Number.isFinite(rankNum) && rankNum <= numericLimit;
  });
}

/**
 * Builds plain-text leaderboard summary for copying to clipboard.
 * Preserves backend rank ties and respects current anonymization mode. Zero PII.
 */
export function buildLeaderboardClipboardText({
  title = 'Đấu Trường Tri Thức',
  leaderboardData = [],
  topN = 'all',
  isAnonymized = false
}) {
  const safeTitle = (title || 'Đấu Trường Tri Thức').trim();
  const filtered = filterLeaderboardByRank(leaderboardData, topN);

  const lines = [`KẾT QUẢ ĐẤU TRƯỜNG: ${safeTitle}`];

  if (filtered.length === 0) {
    lines.push('(Chưa có dữ liệu bảng xếp hạng)');
    return lines.join('\n');
  }

  for (let index = 0; index < filtered.length; index++) {
    const row = filtered[index];
    const rank = row?.rank;
    const displayName = getExportDisplayName(row, index, isAnonymized);
    const score = Number(row?.total_score || 0);
    if (rank === null || rank === undefined || rank === '') {
      lines.push(`${displayName} — ${score} điểm`);
    } else {
      lines.push(`${rank}. ${displayName} — ${score} điểm`);
    }
  }

  return lines.join('\n');
}

/**
 * Calculates deterministic column widths for an XLSX worksheet AoA.
 * Safe for Unicode Vietnamese characters, numbers, nulls, and multiline cells.
 */
export function calculateWorksheetColumnWidths(aoaRows, options = {}) {
  if (!Array.isArray(aoaRows) || aoaRows.length === 0) return [];

  const minWidth = typeof options.minWidth === 'number' ? options.minWidth : 10;
  const defaultMaxWidth = typeof options.defaultMaxWidth === 'number' ? options.defaultMaxWidth : 42;
  const padding = typeof options.padding === 'number' ? options.padding : 3;
  const columnMaxOverrides = options.columnMaxOverrides || {};

  let maxCols = 0;
  for (const row of aoaRows) {
    if (Array.isArray(row) && row.length > maxCols) {
      maxCols = row.length;
    }
  }

  const colWidths = [];

  for (let colIdx = 0; colIdx < maxCols; colIdx++) {
    let maxCellLength = 0;
    const colMax = typeof columnMaxOverrides[colIdx] === 'number'
      ? columnMaxOverrides[colIdx]
      : defaultMaxWidth;

    for (const row of aoaRows) {
      if (!Array.isArray(row) || colIdx >= row.length) continue;
      const cell = row[colIdx];
      if (cell === null || cell === undefined) continue;

      const strVal = String(cell);
      // Handle multiline strings safely
      const lines = strVal.split(/\r\n|\r|\n/);
      for (const line of lines) {
        const charCount = Array.from(line).length;
        if (charCount > maxCellLength) {
          maxCellLength = charCount;
        }
      }
    }

    const calculatedWidth = Math.max(minWidth, maxCellLength + padding);
    const finalWidth = Math.min(calculatedWidth, colMax);
    colWidths.push({ wch: finalWidth });
  }

  return colWidths;
}

/**
 * Builds Leaderboard CSV string with UTF-8 BOM.
 * Preserves exact PostgreSQL backend rank (e.g. 1, 1, 3). Zero recalculation.
 */
export function buildLeaderboardCsv({
  title = 'Đấu Trường Tri Thức',
  roomCode = '',
  leaderboardData = [],
  topN = 'all',
  exportedAt = new Date().toLocaleString('vi-VN'),
  isAnonymized = false
}) {
  const filtered = filterLeaderboardByRank(leaderboardData, topN);
  const safeTitle = sanitizeForFormulaInjection(title);
  const safeRoomCode = sanitizeForFormulaInjection(roomCode);
  const safeExportedAt = sanitizeForFormulaInjection(exportedAt);

  const lines = [
    `\uFEFF"TÊN ĐẤU TRƯỜNG",${escapeCsvValue(safeTitle)}`,
    `"MÃ PHÒNG",${escapeCsvValue(safeRoomCode)}`,
    `"THỜI GIAN XUẤT",${escapeCsvValue(safeExportedAt)}`,
    `"TỔNG SỐ THÍ SINH",${filtered.length}`,
    '',
    'Hạng,Tên Thí Sinh,Tổng Điểm,Số Câu Đúng,Thời Gian Phản Hồi (giây),Loại Thí Sinh'
  ];

  for (let index = 0; index < filtered.length; index++) {
    const row = filtered[index];
    const rank = row.rank ?? '';
    const rawName = getExportDisplayName(row, index, isAnonymized);
    const name = escapeCsvValue(rawName);
    const score = Number(row.total_score || 0);
    const correct = Number(row.correct_count || 0);
    const responseTimeSec = (Number(row.total_response_time_ms || 0) / 1000).toFixed(2);
    const userType = row.is_guest === true ? 'Khách' : 'Tài khoản';

    lines.push(`${rank},${name},${score},${correct},${responseTimeSec},${escapeCsvValue(userType)}`);
  }

  return lines.join('\r\n');
}

/**
 * Builds Analytics CSV string with UTF-8 BOM.
 * Aggregates only, zero PII, zero student raw answers.
 */
export function buildAnalyticsCsv({
  title = 'Đấu Trường Tri Thức',
  roomCode = '',
  analyticsData = null,
  exportedAt = new Date().toLocaleString('vi-VN')
}) {
  const summary = analyticsData?.summary || {};
  const questions = Array.isArray(analyticsData?.questions) ? analyticsData.questions : [];

  const safeTitle = sanitizeForFormulaInjection(title);
  const safeRoomCode = sanitizeForFormulaInjection(roomCode);
  const safeExportedAt = sanitizeForFormulaInjection(exportedAt);

  const lines = [
    `\uFEFF"BÁO CÁO PHÂN TÍCH CÂU HỎI"`,
    `"TÊN ĐẤU TRƯỜNG",${escapeCsvValue(safeTitle)}`,
    `"MÃ PHÒNG",${escapeCsvValue(safeRoomCode)}`,
    `"THỜI GIAN XUẤT",${escapeCsvValue(safeExportedAt)}`,
    `"TỔNG SỐ CÂU",${summary.total_questions ?? questions.length}`,
    `"TỔNG THÍ SINH CUỐI PHIÊN",${summary.final_roster_count ?? 0}`,
    `"TỶ LỆ ĐÚNG TOÀN BÀI",${summary.overall_accuracy_percent ?? 0}%`,
    '',
    'STT Câu,Dạng Câu Hỏi,Nội Dung Câu Hỏi,Điểm Tối Đa,Tổng Thí Sinh,Đã Nộp,Chưa Nộp,Số Lượt Đúng,Số Lượt Sai,Tỷ Lệ Đúng (%),Điểm TB,Thời Gian TB (giây),Phân Bố Lựa Chọn'
  ];

  for (const q of questions) {
    const order = q.question_order ?? '';
    const typeLabel = escapeCsvValue(formatQuestionType(q.question_type));
    const text = escapeCsvValue(q.question_text || '');
    const points = Number(q.points ?? 0);
    const totalRoster = Number(q.final_roster_count ?? summary.final_roster_count ?? 0);
    const answered = Number(q.answered_count ?? 0);
    const unanswered = Number(q.unanswered_count ?? 0);
    const correct = Number(q.correct_count ?? 0);
    const incorrect = Number(q.incorrect_count ?? 0);
    const accuracy = Number(q.accuracy_percent ?? 0);
    const avgPoints = Number(q.average_points ?? 0);
    const avgTimeSec = (Number(q.average_response_time_ms || 0) / 1000).toFixed(2);
    const distribution = escapeCsvValue(formatOptionDistribution(q));

    lines.push(`${order},${typeLabel},${text},${points},${totalRoster},${answered},${unanswered},${correct},${incorrect},${accuracy},${avgPoints},${avgTimeSec},${distribution}`);
  }

  return lines.join('\r\n');
}

/**
 * Triggers client-side browser download for CSV string.
 * Automatically cleans up the created object URL.
 */
export function downloadCsv(content, filename) {
  if (typeof window === 'undefined' || !window.document) return false;
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', filename);
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return true;
}

/**
 * Builds XLSX Workbook with exactly two sheets:
 * Sheet 1: Bang Xep Hang
 * Sheet 2: Phan Tich Cau Hoi
 */
export function buildCompetitionWorkbook({
  title = 'Đấu Trường Tri Thức',
  roomCode = '',
  leaderboardData = [],
  analyticsData = null,
  topN = 'all',
  exportedAt = new Date().toLocaleString('vi-VN'),
  isAnonymized = false
}) {
  const wb = XLSX.utils.book_new();
  const filteredLeaderboard = filterLeaderboardByRank(leaderboardData, topN);

  // ----------------------------------------------------
  // Sheet 1: Bang Xep Hang
  // ----------------------------------------------------
  const leaderboardAoA = [
    ['TÊN ĐẤU TRƯỜNG', sanitizeForFormulaInjection(title)],
    ['MÃ PHÒNG', sanitizeForFormulaInjection(roomCode)],
    ['THỜI GIAN XUẤT', sanitizeForFormulaInjection(exportedAt)],
    ['TỔNG SỐ THÍ SINH', filteredLeaderboard.length],
    [],
    ['Hạng', 'Tên Thí Sinh', 'Tổng Điểm', 'Số Câu Đúng', 'Thời Gian Phản Hồi (giây)', 'Loại Thí Sinh']
  ];

  for (let index = 0; index < filteredLeaderboard.length; index++) {
    const row = filteredLeaderboard[index];
    const rawName = getExportDisplayName(row, index, isAnonymized);
    leaderboardAoA.push([
      row.rank ?? '',
      sanitizeForFormulaInjection(rawName),
      Number(row.total_score || 0),
      Number(row.correct_count || 0),
      Number((Number(row.total_response_time_ms || 0) / 1000).toFixed(2)),
      row.is_guest === true ? 'Khách' : 'Tài khoản'
    ]);
  }

  const wsLeaderboard = XLSX.utils.aoa_to_sheet(leaderboardAoA);
  wsLeaderboard['!cols'] = calculateWorksheetColumnWidths(leaderboardAoA, {
    minWidth: 10,
    defaultMaxWidth: 42,
    padding: 3
  });
  XLSX.utils.book_append_sheet(wb, wsLeaderboard, 'Bang Xep Hang');

  // ----------------------------------------------------
  // Sheet 2: Phan Tich Cau Hoi
  // ----------------------------------------------------
  const summary = analyticsData?.summary || {};
  const questions = Array.isArray(analyticsData?.questions) ? analyticsData.questions : [];

  const analyticsAoA = [
    ['BÁO CÁO PHÂN TÍCH CÂU HỎI', ''],
    ['TÊN ĐẤU TRƯỜNG', sanitizeForFormulaInjection(title)],
    ['MÃ PHÒNG', sanitizeForFormulaInjection(roomCode)],
    ['THỜI GIAN XUẤT', sanitizeForFormulaInjection(exportedAt)],
    ['TỔNG SỐ CÂU', summary.total_questions ?? questions.length],
    ['TỔNG THÍ SINH CUỐI PHIÊN', summary.final_roster_count ?? 0],
    ['TỶ LỆ ĐÚNG TOÀN BÀI (%)', summary.overall_accuracy_percent ?? 0],
    [],
    ['STT Câu', 'Dạng Câu Hỏi', 'Nội Dung Câu Hỏi', 'Điểm Tối Đa', 'Tổng Thí Sinh', 'Đã Nộp', 'Chưa Nộp', 'Số Lượt Đúng', 'Số Lượt Sai', 'Tỷ Lệ Đúng (%)', 'Điểm TB', 'Thời Gian TB (giây)', 'Phân Bố Lựa Chọn']
  ];

  for (const q of questions) {
    analyticsAoA.push([
      q.question_order ?? '',
      formatQuestionType(q.question_type),
      sanitizeForFormulaInjection(q.question_text || ''),
      Number(q.points ?? 0),
      Number(q.final_roster_count ?? summary.final_roster_count ?? 0),
      Number(q.answered_count ?? 0),
      Number(q.unanswered_count ?? 0),
      Number(q.correct_count ?? 0),
      Number(q.incorrect_count ?? 0),
      Number(q.accuracy_percent ?? 0),
      Number(q.average_points ?? 0),
      Number((Number(q.average_response_time_ms || 0) / 1000).toFixed(2)),
      sanitizeForFormulaInjection(formatOptionDistribution(q))
    ]);
  }

  const wsAnalytics = XLSX.utils.aoa_to_sheet(analyticsAoA);
  wsAnalytics['!cols'] = calculateWorksheetColumnWidths(analyticsAoA, {
    minWidth: 10,
    defaultMaxWidth: 42,
    padding: 3,
    columnMaxOverrides: {
      2: 60, // Nội Dung Câu Hỏi max 60
      12: 55 // Phân Bố Lựa Chọn max 55
    }
  });
  XLSX.utils.book_append_sheet(wb, wsAnalytics, 'Phan Tich Cau Hoi');

  return wb;
}

/**
 * Downloads the XLSX workbook via browser-supported binary writing.
 */
export function downloadCompetitionXlsx(workbook, filename) {
  if (typeof window === 'undefined') return false;
  XLSX.writeFile(workbook, filename);
  return true;
}
