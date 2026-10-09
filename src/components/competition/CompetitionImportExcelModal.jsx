// src/components/competition/CompetitionImportExcelModal.jsx
// Modal Nhập Câu Hỏi từ file Excel vào Đấu Trường (Competition V1 R14)

import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import {
  X,
  UploadCloud,
  FileSpreadsheet,
  Download,
  AlertCircle,
  CheckCircle2,
  AlertTriangle,
  Loader2,
  Trash2,
  Plus,
  Check
} from 'lucide-react';
import { parseExcelQuestions } from '../../utils/questionFileParsers.js';
import {
  normalizeImportedQuestionToCompetitionQuestion,
  downloadCompetitionExcelTemplate
} from '../../utils/competitionQuestionAdapters.js';

export function CompetitionImportExcelModal({
  isOpen,
  onClose,
  onImportQuestions,
  existingQuestions = [],
  maxAllowed = 5
}) {
  const [selectedFile, setSelectedFile] = useState(null);
  const [isParsing, setIsParsing] = useState(false);
  const [parsedRows, setParsedRows] = useState([]);
  const [generalError, setGeneralError] = useState('');
  const [selectedIndices, setSelectedIndices] = useState(new Set());

  const fileInputRef = useRef(null);
  const remainingSlots = Math.max(0, maxAllowed - existingQuestions.length);

  // Reset and lock background scroll
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
      setSelectedFile(null);
      setParsedRows([]);
      setGeneralError('');
      setSelectedIndices(new Set());
    } else {
      document.body.style.overflow = 'unset';
    }
    return () => {
      document.body.style.overflow = 'unset';
    };
  }, [isOpen]);

  // Handle file select and parse
  const handleFileChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setSelectedFile(file);
    setIsParsing(true);
    setGeneralError('');
    setParsedRows([]);
    setSelectedIndices(new Set());

    try {
      const buffer = await file.arrayBuffer();
      const res = await parseExcelQuestions(buffer, file.name);

      // Check for STRUCTURAL errors (file format, unreadable workbook, empty file, missing required headers, row <= 1)
      const structuralError = res.errors?.find((err) => err.row === 0 || err.row === 1 || !err.row);
      if (structuralError) {
        setGeneralError(structuralError.message || 'Tệp Excel không đúng định dạng.');
        setIsParsing(false);
        return;
      }

      const rows = res.questions || [];
      const rowErrors = res.errors?.filter((err) => err.row > 1) || [];

      if (rows.length === 0 && rowErrors.length === 0) {
        setGeneralError('Không tìm thấy dữ liệu câu hỏi nào trong tệp Excel.');
        setIsParsing(false);
        return;
      }

      // Evaluate each successfully parsed row
      const evaluated = [];

      for (let i = 0; i < rows.length; i++) {
        const rawRow = rows[i];
        const rowNum = rawRow.source_row || (i + 2);

        // Enforce Single Choice Only for Competition R14 Phase 1
        const rawType = rawRow.question_type || rawRow.type;
        if (rawType !== 'single_choice') {
          evaluated.push({
            rowNum,
            isValid: false,
            question: null,
            raw: rawRow,
            error: 'R14 hiện chỉ hỗ trợ Trắc nghiệm 1 đáp án.'
          });
          continue;
        }

        try {
          const normalized = normalizeImportedQuestionToCompetitionQuestion(
            rawRow,
            existingQuestions.length + evaluated.filter((r) => r.isValid).length + 1
          );
          evaluated.push({
            rowNum,
            isValid: true,
            question: normalized,
            raw: rawRow,
            error: null
          });
        } catch (err) {
          evaluated.push({
            rowNum,
            isValid: false,
            question: null,
            raw: rawRow,
            error: err.message || 'Dữ liệu câu hỏi không hợp lệ.'
          });
        }
      }

      // Append row-level parser errors
      for (const rowErr of rowErrors) {
        evaluated.push({
          rowNum: rowErr.row,
          isValid: false,
          question: null,
          raw: { question_text: `(Dòng ${rowErr.row})` },
          error: rowErr.message || 'Lỗi kiểm tra dòng dữ liệu.'
        });
      }

      // Sort by row number and assign sequential 0-based indices
      evaluated.sort((a, b) => a.rowNum - b.rowNum);
      evaluated.forEach((item, idx) => {
        item.index = idx;
      });

      // Auto-select valid rows up to remainingSlots
      const autoSelected = new Set();
      for (const item of evaluated) {
        if (item.isValid && autoSelected.size < remainingSlots) {
          autoSelected.add(item.index);
        }
      }

      setParsedRows(evaluated);
      setSelectedIndices(autoSelected);
    } catch (err) {
      console.error('[CompetitionImportExcelModal] Lỗi đọc file Excel:', err);
      setGeneralError(err.message || 'Lỗi khi đọc file Excel. Vui lòng kiểm tra định dạng.');
    } finally {
      setIsParsing(false);
    }
  };

  const handleToggleSelect = (index) => {
    const rowItem = parsedRows[index];
    if (!rowItem || !rowItem.isValid) return;

    const newSet = new Set(selectedIndices);
    if (newSet.has(index)) {
      newSet.delete(index);
      setSelectedIndices(newSet);
      setGeneralError('');
    } else {
      if (newSet.size >= remainingSlots) {
        setGeneralError(`Phòng thi chỉ còn trống ${remainingSlots} chỗ (tối đa ${maxAllowed} câu).`);
        return;
      }
      newSet.add(index);
      setSelectedIndices(newSet);
      setGeneralError('');
    }
  };

  const handleConfirmImport = () => {
    const selectedRows = parsedRows.filter((r) => r.isValid && selectedIndices.has(r.index));
    if (selectedRows.length === 0) return;

    if (selectedRows.length > remainingSlots) {
      setGeneralError(`Chỉ được chọn tối đa ${remainingSlots} câu hỏi.`);
      return;
    }

    const normalizedQuestions = selectedRows.map((r, idx) => ({
      ...r.question,
      question_order: existingQuestions.length + idx + 1
    }));

    onImportQuestions(normalizedQuestions);
    onClose();
  };

  if (!isOpen || typeof document === 'undefined') return null;

  const validCount = parsedRows.filter((r) => r.isValid).length;
  const invalidCount = parsedRows.filter((r) => !r.isValid).length;
  const selectedCount = selectedIndices.size;

  return createPortal(
    <div className="fixed inset-0 z-[10000] flex items-center justify-center p-3 sm:p-4 bg-slate-900/60 backdrop-blur-xs animate-fadeIn">
      <div className="bg-white rounded-3xl max-w-4xl w-full max-h-[90vh] flex flex-col shadow-2xl border border-slate-200 overflow-hidden animate-scaleUp">
        {/* HEADER */}
        <div className="flex items-center justify-between p-4 sm:p-5 border-b border-slate-200 bg-gradient-to-r from-emerald-50 to-teal-50">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-emerald-600 text-white flex items-center justify-center shadow-md shadow-emerald-600/20">
              <FileSpreadsheet className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2">
                Nhập câu hỏi từ file Excel
                <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-800 border border-emerald-200">
                  .xlsx, .xls, .csv
                </span>
              </h3>
              <p className="text-xs text-slate-500">
                Còn trống <strong className="text-emerald-700">{remainingSlots}</strong> / {maxAllowed} câu hỏi trong đấu trường
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-slate-600 rounded-xl hover:bg-slate-100 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* UPLOAD & TEMPLATE DOWNLOAD BAR */}
        <div className="p-4 border-b border-slate-200 bg-slate-50 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
          <div className="flex items-center gap-2 flex-1">
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleFileChange}
              accept=".xlsx, .xls, .csv"
              className="hidden"
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="inline-flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-xs rounded-xl shadow-xs transition cursor-pointer"
            >
              <UploadCloud className="w-4 h-4" />
              {selectedFile ? 'Chọn tệp khác' : 'Chọn tệp Excel từ máy tính'}
            </button>
            {selectedFile && (
              <span className="text-xs font-semibold text-slate-700 truncate max-w-[200px] sm:max-w-xs">
                {selectedFile.name}
              </span>
            )}
          </div>

          <button
            type="button"
            onClick={downloadCompetitionExcelTemplate}
            className="inline-flex items-center gap-2 px-3 py-2 text-slate-700 bg-white hover:bg-slate-100 border border-slate-200 font-semibold text-xs rounded-xl shadow-xs transition shrink-0 cursor-pointer"
          >
            <Download className="w-4 h-4 text-emerald-600" />
            Tải file mẫu Excel
          </button>
        </div>

        {/* GENERAL ERROR BANNER */}
        {generalError && (
          <div className="p-3 mx-4 mt-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{generalError}</span>
          </div>
        )}

        {/* SUMMARY STATS BAR */}
        {parsedRows.length > 0 && (
          <div className="px-4 py-2 bg-slate-100/80 border-b border-slate-200 flex items-center justify-between text-xs text-slate-600">
            <div className="flex items-center gap-3 font-medium">
              <span>Tổng số dòng: <strong>{parsedRows.length}</strong></span>
              <span className="text-emerald-700 font-semibold">Hợp lệ: <strong>{validCount}</strong></span>
              {invalidCount > 0 && (
                <span className="text-rose-600 font-semibold">Lỗi: <strong>{invalidCount}</strong></span>
              )}
            </div>
            <div className="font-bold text-emerald-800">
              Đã chọn: {selectedCount} / {remainingSlots} câu
            </div>
          </div>
        )}

        {/* PREVIEW CONTENT LIST */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {isParsing ? (
            <div className="py-12 flex flex-col items-center justify-center gap-3 text-slate-500">
              <Loader2 className="w-8 h-8 text-emerald-600 animate-spin" />
              <p className="text-sm font-medium">Đang đọc và kiểm tra dữ liệu file Excel...</p>
            </div>
          ) : parsedRows.length === 0 ? (
            <div className="py-16 text-center text-slate-500 space-y-3">
              <div className="w-14 h-14 rounded-2xl bg-emerald-50 text-emerald-600 flex items-center justify-center mx-auto border border-emerald-100">
                <FileSpreadsheet className="w-7 h-7" />
              </div>
              <div>
                <p className="text-sm font-bold text-slate-700">Chưa có tệp Excel nào được chọn</p>
                <p className="text-xs text-slate-400 mt-1 max-w-sm mx-auto">
                  Tải tệp mẫu Excel, điền nội dung câu hỏi trắc nghiệm kèm 4 lựa chọn (A, B, C, D) và đáp án đúng rồi tải lên tại đây.
                </p>
              </div>
            </div>
          ) : (
            parsedRows.map((rowItem) => {
              const isSelected = selectedIndices.has(rowItem.index);
              const { isValid, question, raw, error, rowNum } = rowItem;
              const promptText = question?.question_text || raw?.question_text || raw?.question || raw?.prompt || '(Trống đề bài)';
              const opts = question?.options || [];

              return (
                <div
                  key={rowItem.index}
                  onClick={() => isValid && handleToggleSelect(rowItem.index)}
                  className={`p-3.5 rounded-2xl border transition text-left ${
                    !isValid
                      ? 'bg-rose-50/50 border-rose-200 cursor-not-allowed'
                      : isSelected
                      ? 'bg-emerald-50/70 border-emerald-400 ring-2 ring-emerald-400/30 cursor-pointer shadow-xs'
                      : 'bg-white border-slate-200 hover:border-slate-300 cursor-pointer shadow-xs'
                  }`}
                >
                  <div className="flex items-start gap-3">
                    {/* Checkbox / Error Icon */}
                    <div className="pt-0.5">
                      {isValid ? (
                        <div
                          className={`w-5 h-5 rounded-lg flex items-center justify-center border transition ${
                            isSelected
                              ? 'bg-emerald-600 border-emerald-600 text-white'
                              : 'bg-white border-slate-300'
                          }`}
                        >
                          {isSelected && <Check className="w-3.5 h-3.5 stroke-[3]" />}
                        </div>
                      ) : (
                        <div className="w-5 h-5 rounded-lg flex items-center justify-center bg-rose-100 text-rose-600 border border-rose-300">
                          <AlertTriangle className="w-3.5 h-3.5" />
                        </div>
                      )}
                    </div>

                    {/* Content */}
                    <div className="flex-1 space-y-1.5 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-xs font-bold text-slate-500">
                            Dòng {rowNum}
                          </span>
                          {isValid ? (
                            <span className="px-2 py-0.5 rounded-md bg-emerald-100 text-emerald-800 font-bold text-[10px]">
                              HỢP LỆ
                            </span>
                          ) : (
                            <span className="px-2 py-0.5 rounded-md bg-rose-100 text-rose-800 font-bold text-[10px]">
                              LỖI ĐỊNH DẠNG
                            </span>
                          )}
                        </div>

                        {isValid && question && (
                          <div className="flex items-center gap-2 text-xs font-medium text-slate-500">
                            <span>{question.points} điểm</span>
                            <span>•</span>
                            <span>{question.time_limit_seconds}s</span>
                          </div>
                        )}
                      </div>

                      <p className={`text-sm font-semibold leading-snug ${isValid ? 'text-slate-800' : 'text-slate-500'}`}>
                        {promptText}
                      </p>

                      {/* Error details */}
                      {!isValid && error && (
                        <div className="p-2 rounded-xl bg-rose-100/60 border border-rose-200 text-rose-700 text-xs font-medium flex items-center gap-2">
                          <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                          <span>{error}</span>
                        </div>
                      )}

                      {/* Options Preview */}
                      {isValid && opts.length > 0 && (
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 pt-1">
                          {opts.map((opt, oIdx) => {
                            const isCorrect = question.correct_answer?.option_id === opt.id;
                            const letter = String.fromCharCode(65 + oIdx);
                            return (
                              <div
                                key={opt.id}
                                className={`flex items-center gap-2 text-xs px-2.5 py-1 rounded-lg border truncate ${
                                  isCorrect
                                    ? 'bg-emerald-100/70 border-emerald-300 text-emerald-900 font-medium'
                                    : 'bg-slate-50 border-slate-100 text-slate-600'
                                }`}
                              >
                                <span className={`font-bold ${isCorrect ? 'text-emerald-700' : 'text-slate-400'}`}>
                                  {letter}.
                                </span>
                                <span className="truncate">{opt.text}</span>
                                {isCorrect && (
                                  <CheckCircle2 className="w-3 h-3 text-emerald-600 ml-auto shrink-0" />
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* FOOTER */}
        <div className="p-4 border-t border-slate-200 bg-slate-50 flex items-center justify-between gap-3">
          <div className="text-xs text-slate-500">
            {validCount > 0 ? (
              <span>Đã chọn <strong>{selectedCount}</strong> câu hợp lệ</span>
            ) : (
              <span>Chưa có câu hỏi hợp lệ</span>
            )}
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-100 text-xs font-semibold transition cursor-pointer"
            >
              Hủy bỏ
            </button>
            <button
              type="button"
              disabled={selectedCount === 0 || selectedCount > remainingSlots}
              onClick={handleConfirmImport}
              className="inline-flex items-center gap-2 px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-300 text-white text-xs font-bold shadow-xs transition disabled:cursor-not-allowed cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              Thêm {selectedCount} câu vào đấu trường
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}