import React, { useState, useRef, useEffect } from 'react';
import { Download, FileSpreadsheet, Printer, ChevronDown, FileText, CheckCircle2, Copy } from 'lucide-react';
import {
  buildLeaderboardCsv,
  buildAnalyticsCsv,
  downloadCsv,
  buildCompetitionWorkbook,
  downloadCompetitionXlsx,
  buildLeaderboardClipboardText,
  sanitizeFilenamePart,
  formatExportTimestamp
} from '../../utils/competitionExport.js';

export function HostExportControls({
  sessionTitle = 'Đấu Trường Tri Thức',
  roomCode = '',
  leaderboardData = [],
  analyticsData = null,
  onPrint = null,
  isAnonymized = false,
  onAnonymizedChange = null,
  exportTopN = 'all',
  onExportTopNChange = null,
  printOrientation = 'portrait',
  onPrintOrientationChange = null
}) {
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [successToast, setSuccessToast] = useState(null);
  const dropdownRef = useRef(null);

  // Close dropdown on outside click
  useEffect(() => {
    function handleClickOutside(event) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setIsDropdownOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const triggerToast = (msg) => {
    setSuccessToast(msg);
    setTimeout(() => setSuccessToast(null), 3000);
  };

  const hasLeaderboard = Array.isArray(leaderboardData) && leaderboardData.length > 0;
  const hasAnalytics = Boolean(analyticsData && Array.isArray(analyticsData.questions));

  const safeCode = sanitizeFilenamePart(roomCode, 'competition');
  const timestamp = formatExportTimestamp();

  // Export Leaderboard CSV (filtered by exportTopN)
  const handleExportLeaderboardCsv = () => {
    if (!hasLeaderboard) return;
    const csv = buildLeaderboardCsv({
      title: sessionTitle,
      roomCode,
      leaderboardData,
      topN: exportTopN,
      isAnonymized
    });
    const filename = `dau-truong-${safeCode}-bang-xep-hang-${timestamp}.csv`;
    downloadCsv(csv, filename);
    setIsDropdownOpen(false);
    triggerToast('Đã xuất file Bảng xếp hạng (.csv)');
  };

  // Export Analytics CSV (always whole-session aggregate)
  const handleExportAnalyticsCsv = () => {
    if (!hasAnalytics) return;
    const csv = buildAnalyticsCsv({
      title: sessionTitle,
      roomCode,
      analyticsData
    });
    const filename = `dau-truong-${safeCode}-phan-tich-${timestamp}.csv`;
    downloadCsv(csv, filename);
    setIsDropdownOpen(false);
    triggerToast('Đã xuất file Phân tích câu hỏi (.csv)');
  };

  // Export Full XLSX Workbook (Sheet 1 filtered by exportTopN, Sheet 2 full analytics)
  const handleExportXlsx = () => {
    if (!hasLeaderboard || !hasAnalytics) return;
    const wb = buildCompetitionWorkbook({
      title: sessionTitle,
      roomCode,
      leaderboardData,
      analyticsData,
      topN: exportTopN,
      isAnonymized
    });
    const filename = `dau-truong-${safeCode}-bao-cao-${timestamp}.xlsx`;
    downloadCompetitionXlsx(wb, filename);
    triggerToast('Đã xuất file Báo cáo tổng hợp (.xlsx)');
  };

  // Copy Results to Clipboard
  const handleCopyResults = async () => {
    if (!hasLeaderboard) return;
    const text = buildLeaderboardClipboardText({
      title: sessionTitle,
      leaderboardData,
      topN: exportTopN,
      isAnonymized
    });

    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
        await navigator.clipboard.writeText(text);
        triggerToast('Đã sao chép kết quả');
        return;
      }
      throw new Error('Clipboard API not available');
    } catch (_err) {
      // Fallback: temporary off-screen textarea
      let success = false;
      let textarea = null;
      try {
        if (typeof document !== 'undefined') {
          textarea = document.createElement('textarea');
          textarea.value = text;
          textarea.setAttribute('readonly', '');
          textarea.style.position = 'fixed';
          textarea.style.left = '-9999px';
          textarea.style.top = '-9999px';
          textarea.style.opacity = '0';
          document.body.appendChild(textarea);
          textarea.focus();
          textarea.select();
          success = document.execCommand('copy');
        }
      } catch (_fbErr) {
        success = false;
      } finally {
        if (textarea && textarea.parentNode) {
          textarea.parentNode.removeChild(textarea);
        }
      }

      if (success) {
        triggerToast('Đã sao chép kết quả');
      } else {
        triggerToast('Không thể sao chép kết quả');
      }
    }
  };

  // Print / Save as PDF
  const handlePrint = () => {
    if (onPrint) {
      onPrint();
    } else if (typeof window !== 'undefined') {
      window.print();
    }
  };

  return (
    <div className="relative inline-flex flex-wrap items-center gap-2 print:hidden" ref={dropdownRef}>
      {/* 0. Checkbox: Ẩn tên thí sinh */}
      <label
        className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-white/20 hover:bg-white/30 text-white font-semibold text-xs backdrop-blur-xs border border-white/30 transition shadow-xs cursor-pointer select-none focus-within:ring-2 focus-within:ring-white/50"
        title="Khi bật, tên thí sinh trong file xuất, bản in và clipboard sẽ được thay bằng Thí sinh 1, Thí sinh 2..."
      >
        <input
          type="checkbox"
          checked={isAnonymized}
          onChange={(e) => onAnonymizedChange?.(e.target.checked)}
          className="w-3.5 h-3.5 rounded border-white/40 text-amber-500 focus:ring-0 focus:ring-offset-0 bg-white/20 cursor-pointer"
        />
        <span>Ẩn tên thí sinh</span>
      </label>

      {/* 1. Selector: Phạm vi (Top N) */}
      <label
        className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-white/20 text-white font-semibold text-xs backdrop-blur-xs border border-white/30 transition shadow-xs select-none"
        title="Lọc bảng xếp hạng theo thứ hạng thực tế (Top 3, 5, 10 hoặc Tất cả)"
      >
        <span className="text-white/80">Phạm vi:</span>
        <select
          value={String(exportTopN)}
          onChange={(e) => {
            const val = e.target.value;
            const normalized = ['3', '5', '10'].includes(val) ? Number(val) : 'all';
            onExportTopNChange?.(normalized);
          }}
          aria-label="Chọn phạm vi thứ hạng xuất báo cáo"
          className="bg-slate-900/50 text-white border border-white/30 rounded-lg px-2 py-0.5 text-xs font-bold focus:outline-none focus:ring-1 focus:ring-amber-400 cursor-pointer"
        >
          <option value="all" className="bg-slate-800 text-white">Tất cả</option>
          <option value="3" className="bg-slate-800 text-white">Top 3</option>
          <option value="5" className="bg-slate-800 text-white">Top 5</option>
          <option value="10" className="bg-slate-800 text-white">Top 10</option>
        </select>
      </label>

      {/* 2. Selector: Khổ in */}
      <label
        className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-white/20 text-white font-semibold text-xs backdrop-blur-xs border border-white/30 transition shadow-xs select-none"
        title="Chọn hướng giấy in báo cáo (Dọc hoặc Ngang)"
      >
        <span className="text-white/80">Khổ in:</span>
        <select
          value={printOrientation}
          onChange={(e) => {
            const val = e.target.value === 'landscape' ? 'landscape' : 'portrait';
            onPrintOrientationChange?.(val);
          }}
          aria-label="Chọn hướng giấy in báo cáo"
          className="bg-slate-900/50 text-white border border-white/30 rounded-lg px-2 py-0.5 text-xs font-bold focus:outline-none focus:ring-1 focus:ring-amber-400 cursor-pointer"
        >
          <option value="portrait" className="bg-slate-800 text-white">Dọc</option>
          <option value="landscape" className="bg-slate-800 text-white">Ngang</option>
        </select>
      </label>

      {/* 3. CSV Dropdown */}
      <div className="relative">
        <button
          type="button"
          onClick={() => setIsDropdownOpen(!isDropdownOpen)}
          aria-haspopup="true"
          aria-expanded={isDropdownOpen}
          aria-label="Tùy chọn xuất file CSV"
          className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-white/20 hover:bg-white/30 text-white font-bold text-xs backdrop-blur-xs border border-white/30 transition shadow-xs focus:outline-none focus:ring-2 focus:ring-white/50"
        >
          <FileText className="w-3.5 h-3.5 text-sky-200" />
          <span>Xuất CSV</span>
          <ChevronDown className={`w-3.5 h-3.5 transition-transform duration-200 ${isDropdownOpen ? 'rotate-180' : ''}`} />
        </button>

        {isDropdownOpen && (
          <div className="absolute left-0 sm:right-0 sm:left-auto mt-2 w-56 bg-white rounded-2xl shadow-xl border border-slate-200 py-1.5 z-50 animate-in fade-in-50 zoom-in-95">
            <div className="px-3 py-1.5 border-b border-slate-100 text-[11px] font-bold text-slate-400 uppercase tracking-wider">
              Chọn nội dung xuất CSV
            </div>

            <button
              type="button"
              disabled={!hasLeaderboard}
              onClick={handleExportLeaderboardCsv}
              className="w-full px-3.5 py-2 text-left text-xs font-semibold text-slate-700 hover:bg-slate-50 flex items-center justify-between transition disabled:opacity-40 disabled:cursor-not-allowed"
              title={!hasLeaderboard ? 'Chưa có dữ liệu bảng xếp hạng' : 'Tải về bảng điểm và thứ hạng (.csv)'}
            >
              <div className="flex items-center gap-2">
                <Download className="w-3.5 h-3.5 text-amber-500" />
                <span>Bảng xếp hạng (.csv)</span>
              </div>
              <span className="text-[10px] text-slate-400 font-mono">{leaderboardData.length} thí sinh</span>
            </button>

            <button
              type="button"
              disabled={!hasAnalytics}
              onClick={handleExportAnalyticsCsv}
              className="w-full px-3.5 py-2 text-left text-xs font-semibold text-slate-700 hover:bg-slate-50 flex items-center justify-between transition disabled:opacity-40 disabled:cursor-not-allowed"
              title={!hasAnalytics ? 'Vui lòng mở tab Phân tích câu hỏi trước để tải dữ liệu' : 'Tải về thống kê độ khó & độ chính xác từng câu (.csv)'}
            >
              <div className="flex items-center gap-2">
                <Download className="w-3.5 h-3.5 text-sky-500" />
                <span>Phân tích câu hỏi (.csv)</span>
              </div>
              <span className="text-[10px] text-slate-400 font-mono">
                {hasAnalytics ? `${analyticsData.questions.length} câu` : 'Cần tải'}
              </span>
            </button>
          </div>
        )}
      </div>

      {/* 4. Excel XLSX Export */}
      <button
        type="button"
        disabled={!hasLeaderboard || !hasAnalytics}
        onClick={handleExportXlsx}
        title={
          !hasAnalytics
            ? 'Vui lòng mở tab Phân tích câu hỏi trước để tải đủ 2 bảng vào file Excel'
            : !hasLeaderboard
            ? 'Chưa có dữ liệu bảng xếp hạng'
            : 'Tải về sổ điểm và phân tích hoàn chỉnh (.xlsx)'
        }
        className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-bold text-xs shadow-xs transition border border-emerald-500/50 disabled:cursor-not-allowed"
      >
        <FileSpreadsheet className="w-3.5 h-3.5" />
        <span>Xuất Excel (.xlsx)</span>
      </button>

      {/* 5. Copy Results to Clipboard */}
      <button
        type="button"
        disabled={!hasLeaderboard}
        onClick={handleCopyResults}
        title={!hasLeaderboard ? 'Chưa có dữ liệu bảng xếp hạng' : 'Sao chép kết quả bảng xếp hạng theo phạm vi đã chọn vào clipboard'}
        className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-white/20 hover:bg-white/30 text-white font-bold text-xs backdrop-blur-xs border border-white/30 transition shadow-xs disabled:opacity-50 disabled:cursor-not-allowed"
      >
        <Copy className="w-3.5 h-3.5 text-amber-300" />
        <span>Sao chép kết quả</span>
      </button>

      {/* 6. Print / Save as PDF */}
      <button
        type="button"
        disabled={!hasLeaderboard || !hasAnalytics}
        onClick={handlePrint}
        title={
          !hasAnalytics
            ? 'Vui lòng mở tab Phân tích câu hỏi trước để in báo cáo đầy đủ'
            : !hasLeaderboard
            ? 'Chưa có dữ liệu bảng xếp hạng'
            : 'In báo cáo hoặc Lưu dạng PDF'
        }
        className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-white text-slate-900 hover:bg-slate-100 disabled:opacity-50 font-bold text-xs shadow-md transition disabled:cursor-not-allowed"
      >
        <Printer className="w-3.5 h-3.5 text-slate-700" />
        <span>In / Lưu PDF</span>
      </button>

      {/* Success Toast */}
      {successToast && (
        <div className="absolute top-full left-0 mt-2 z-50 bg-slate-900 text-white px-3 py-1.5 rounded-xl text-xs font-semibold shadow-lg flex items-center gap-1.5 animate-in fade-in slide-in-from-top-1">
          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
          <span>{successToast}</span>
        </div>
      )}
    </div>
  );
}
