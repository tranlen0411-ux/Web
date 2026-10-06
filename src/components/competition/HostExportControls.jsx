import React, { useState, useRef, useEffect } from 'react';
import { Download, FileSpreadsheet, Printer, ChevronDown, FileText, CheckCircle2 } from 'lucide-react';
import {
  buildLeaderboardCsv,
  buildAnalyticsCsv,
  downloadCsv,
  buildCompetitionWorkbook,
  downloadCompetitionXlsx,
  sanitizeFilenamePart,
  formatExportTimestamp
} from '../../utils/competitionExport.js';

export function HostExportControls({
  sessionTitle = 'Đấu Trường Tri Thức',
  roomCode = '',
  leaderboardData = [],
  analyticsData = null,
  onPrint = null
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

  // Export Leaderboard CSV
  const handleExportLeaderboardCsv = () => {
    if (!hasLeaderboard) return;
    const csv = buildLeaderboardCsv({
      title: sessionTitle,
      roomCode,
      leaderboardData
    });
    const filename = `dau-truong-${safeCode}-bang-xep-hang-${timestamp}.csv`;
    downloadCsv(csv, filename);
    setIsDropdownOpen(false);
    triggerToast('Đã xuất file Bảng xếp hạng (.csv)');
  };

  // Export Analytics CSV
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

  // Export Full XLSX Workbook
  const handleExportXlsx = () => {
    if (!hasLeaderboard || !hasAnalytics) return;
    const wb = buildCompetitionWorkbook({
      title: sessionTitle,
      roomCode,
      leaderboardData,
      analyticsData
    });
    const filename = `dau-truong-${safeCode}-bao-cao-${timestamp}.xlsx`;
    downloadCompetitionXlsx(wb, filename);
    triggerToast('Đã xuất file Báo cáo tổng hợp (.xlsx)');
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
      {/* 1. CSV Dropdown */}
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

      {/* 2. Excel XLSX Export */}
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

      {/* 3. Print / Save as PDF */}
      <button
        type="button"
        disabled={!hasLeaderboard}
        onClick={handlePrint}
        title={!hasLeaderboard ? 'Chưa có dữ liệu để in báo cáo' : 'In báo cáo hoặc Lưu dạng PDF'}
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
