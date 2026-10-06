import React from 'react';
import { formatQuestionType, formatOptionDistribution } from '../../utils/competitionExport.js';

export function HostPrintableReport({
  session = {},
  leaderboardData = [],
  analyticsData = null
}) {
  const title = session.title || 'Đấu Trường Tri Thức';
  const roomCode = session.room_code || '---';
  const printedAt = new Date().toLocaleString('vi-VN');

  const summary = analyticsData?.summary || {
    total_questions: 0,
    final_roster_count: leaderboardData.length,
    overall_accuracy_percent: 0,
    total_correct_instances: 0,
    total_answered_instances: 0
  };

  const questions = Array.isArray(analyticsData?.questions) ? analyticsData.questions : [];

  return (
    <div className="hidden print:block font-sans text-slate-900 bg-white p-4 max-w-4xl mx-auto space-y-6">
      {/* 1. Header Banner */}
      <div className="border-b-2 border-slate-900 pb-4 flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-black uppercase tracking-tight text-slate-900">{title}</h1>
          <p className="text-xs text-slate-600 font-medium mt-1">
            Báo cáo tổng kết kết quả thi đấu &amp; phân tích chất lượng đề thi
          </p>
        </div>
        <div className="text-right text-xs text-slate-700 space-y-0.5">
          <div>Mã phòng thi: <strong className="font-mono text-sm">{roomCode}</strong></div>
          <div>Thời gian in: <span>{printedAt}</span></div>
        </div>
      </div>

      {/* 2. Executive Summary Metrics */}
      <div className="border border-slate-300 rounded-lg p-3 bg-slate-50 space-y-2">
        <h2 className="text-xs font-bold uppercase tracking-wider text-slate-700">1. Tổng Quan Kết Quả</h2>
        <div className="grid grid-cols-4 gap-2 text-center text-xs">
          <div className="p-2 border border-slate-200 bg-white rounded">
            <div className="text-slate-500 font-medium">Tổng số thí sinh</div>
            <div className="text-base font-black text-slate-900">{leaderboardData.length}</div>
          </div>
          <div className="p-2 border border-slate-200 bg-white rounded">
            <div className="text-slate-500 font-medium">Tổng số câu hỏi</div>
            <div className="text-base font-black text-slate-900">{summary.total_questions || questions.length || '---'}</div>
          </div>
          <div className="p-2 border border-slate-200 bg-white rounded">
            <div className="text-slate-500 font-medium">Lượt làm bài đúng</div>
            <div className="text-base font-black text-slate-900">{summary.total_correct_instances || '---'}</div>
          </div>
          <div className="p-2 border border-slate-200 bg-white rounded">
            <div className="text-slate-500 font-medium">Tỷ lệ đúng toàn bài</div>
            <div className="text-base font-black text-slate-900">{summary.overall_accuracy_percent ? `${summary.overall_accuracy_percent}%` : '---'}</div>
          </div>
        </div>
      </div>

      {/* 3. Final Leaderboard Table */}
      <div className="space-y-2 break-inside-avoid">
        <h2 className="text-xs font-bold uppercase tracking-wider text-slate-700">2. Bảng Xếp Hạng Chung Cuộc</h2>
        <table className="w-full text-left text-xs border-collapse border border-slate-300">
          <thead>
            <tr className="bg-slate-100 border-b border-slate-300">
              <th className="p-2 border-r border-slate-300 text-center w-12">Hạng</th>
              <th className="p-2 border-r border-slate-300">Tên thí sinh</th>
              <th className="p-2 border-r border-slate-300 text-right w-24">Tổng điểm</th>
              <th className="p-2 border-r border-slate-300 text-center w-24">Số câu đúng</th>
              <th className="p-2 border-r border-slate-300 text-right w-28">Thời gian (s)</th>
              <th className="p-2 text-center w-24">Loại</th>
            </tr>
          </thead>
          <tbody>
            {leaderboardData.length === 0 ? (
              <tr>
                <td colSpan={6} className="p-4 text-center text-slate-500 italic">Chưa có dữ liệu bảng xếp hạng.</td>
              </tr>
            ) : (
              leaderboardData.map((row) => (
                <tr key={row.participant_id || `${row.rank}-${row.display_name}`} className="border-b border-slate-200">
                  <td className="p-2 border-r border-slate-200 text-center font-bold">{row.rank}</td>
                  <td className="p-2 border-r border-slate-200 font-medium">{row.display_name}</td>
                  <td className="p-2 border-r border-slate-200 text-right font-bold text-slate-900">{row.total_score}</td>
                  <td className="p-2 border-r border-slate-200 text-center">{row.correct_count}</td>
                  <td className="p-2 border-r border-slate-200 text-right">
                    {((Number(row.total_response_time_ms || 0)) / 1000).toFixed(2)}s
                  </td>
                  <td className="p-2 text-center text-[11px] text-slate-600">{row.is_guest ? 'Khách' : 'Học sinh'}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* 4. Question Difficulty & Accuracy Table (If Analytics Available) */}
      {questions.length > 0 && (
        <div className="space-y-2 break-inside-avoid">
          <h2 className="text-xs font-bold uppercase tracking-wider text-slate-700">3. Thống Kê Chi Tiết Từng Câu Hỏi</h2>
          <table className="w-full text-left text-[11px] border-collapse border border-slate-300">
            <thead>
              <tr className="bg-slate-100 border-b border-slate-300">
                <th className="p-1.5 border-r border-slate-300 text-center w-10">STT</th>
                <th className="p-1.5 border-r border-slate-300 w-20">Dạng câu</th>
                <th className="p-1.5 border-r border-slate-300">Nội dung câu hỏi</th>
                <th className="p-1.5 border-r border-slate-300 text-center w-14">Đã nộp</th>
                <th className="p-1.5 border-r border-slate-300 text-center w-12">Đúng</th>
                <th className="p-1.5 border-r border-slate-300 text-right w-16">Tỷ lệ đúng</th>
                <th className="p-1.5 border-r border-slate-300 text-right w-16">T.Gian TB</th>
                <th className="p-1.5 w-44">Phân bố đáp án</th>
              </tr>
            </thead>
            <tbody>
              {questions.map((q) => (
                <tr key={q.question_id || q.question_order} className="border-b border-slate-200 break-inside-avoid">
                  <td className="p-1.5 border-r border-slate-200 text-center font-bold">{q.question_order}</td>
                  <td className="p-1.5 border-r border-slate-200 text-slate-600">{formatQuestionType(q.question_type)}</td>
                  <td className="p-1.5 border-r border-slate-200 font-medium">{q.question_text}</td>
                  <td className="p-1.5 border-r border-slate-200 text-center">{q.answered_count}</td>
                  <td className="p-1.5 border-r border-slate-200 text-center font-bold text-slate-800">{q.correct_count}</td>
                  <td className="p-1.5 border-r border-slate-200 text-right font-bold">{q.accuracy_percent}%</td>
                  <td className="p-1.5 border-r border-slate-200 text-right">
                    {((Number(q.average_response_time_ms || 0)) / 1000).toFixed(1)}s
                  </td>
                  <td className="p-1.5 text-[10px] text-slate-600 leading-tight">
                    {formatOptionDistribution(q)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* 5. Footer Signoff */}
      <div className="pt-4 border-t border-slate-300 flex justify-between items-center text-[10px] text-slate-500">
        <div>Hệ thống Kho Trò Chơi Học Vui - Đấu Trường Trực Tuyến</div>
        <div>Trang 1 / 1 (Tài liệu nội bộ dành cho Giáo viên)</div>
      </div>
    </div>
  );
}
