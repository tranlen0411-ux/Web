import React, { useState, useEffect, useMemo } from 'react';
import {
  X,
  CheckCircle2,
  AlertCircle,
  Clock,
  Star,
  BookOpen,
  AlertTriangle,
  FileText,
  Image as ImageIcon,
  RotateCcw,
  ExternalLink,
  RefreshCw,
  MessageSquare
} from 'lucide-react';
import { supabase } from '../../../lib/supabase';
import { getStudentGradedSubmission } from '../../../services/submissionAnnotationClient';
import { SubmissionAnnotationCanvas } from './SubmissionAnnotationCanvas';

/**
 * Sanitize & hydrate annotation JSON safely for read-only viewer
 */
function sanitizeAnnotation(annJson) {
  if (!annJson || typeof annJson !== 'object' || Array.isArray(annJson)) {
    return { schema_version: 1, strokes: [], stamps: [], notes: [] };
  }
  return {
    schema_version: annJson.schema_version || 1,
    strokes: Array.isArray(annJson.strokes) ? annJson.strokes : [],
    stamps: Array.isArray(annJson.stamps) ? annJson.stamps : [],
    notes: Array.isArray(annJson.notes) ? annJson.notes : []
  };
}

/**
 * Format bytes to readable size
 */
function formatFileSize(bytes) {
  if (!bytes || Number.isNaN(bytes)) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Format timestamp to Vietnamese datetime
 */
function formatDateTime(isoString) {
  if (!isoString) return '';
  try {
    const d = new Date(isoString);
    return d.toLocaleString('vi-VN', {
      hour: '2-digit',
      minute: '2-digit',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric'
    });
  } catch (_e) {
    return isoString;
  }
}

export const StudentGradedViewerModal = ({
  isOpen,
  submissionId,
  onClose,
  initialSubmissionStatus = null
}) => {
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState('');
  const [errorCode, setErrorCode] = useState(null);
  const [submissionData, setSubmissionData] = useState(null);
  const [signedUrlsMap, setSignedUrlsMap] = useState({});
  const [signedUrlsLoading, setSignedUrlsLoading] = useState(false);

  // Close on Escape key
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape' && isOpen) {
        onClose?.();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  // Fetch Graded Submission data from authoritative RPC
  const fetchGradedSubmission = async () => {
    if (!isOpen || !submissionId) return;

    setLoading(true);
    setErrorMsg('');
    setErrorCode(null);
    setSubmissionData(null);

    try {
      const res = await getStudentGradedSubmission({ submissionId });

      if (!res.ok) {
        setErrorCode(res.code);

        // Map structured business errors to friendly Vietnamese messages
        if (res.code === 'SUBMISSION_NOT_GRADED') {
          setErrorMsg('Bài làm đang được giáo viên chấm. Vui lòng quay lại sau.');
        } else if (res.code === 'FORBIDDEN') {
          setErrorMsg('Bạn không có quyền xem bài làm này.');
        } else if (res.code === 'SUBMISSION_NOT_FOUND') {
          setErrorMsg('Không tìm thấy bài làm.');
        } else if (res.code === 'UNAUTHORIZED') {
          setErrorMsg('Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.');
        } else {
          setErrorMsg('Lỗi tải bài đã chấm. Vui lòng thử lại.');
        }
        return;
      }

      const data = res.data;
      const status = data?.submission?.status;

      // Safe Success Status Guard: only render graded view for 'graded' or 'revision_requested'
      if (status !== 'graded' && status !== 'revision_requested') {
        setErrorCode('INVALID_STATUS');
        setErrorMsg('Bài làm đang được giáo viên chấm. Vui lòng quay lại sau.');
        return;
      }

      setSubmissionData(data);
    } catch (err) {
      console.error('Fetch graded submission error:', err);
      setErrorCode('CLIENT_ERROR');
      setErrorMsg('Lỗi tải bài đã chấm. Vui lòng thử lại.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen && submissionId) {
      fetchGradedSubmission();
    } else {
      setSubmissionData(null);
      setErrorMsg('');
      setErrorCode(null);
      setSignedUrlsMap({});
    }
  }, [isOpen, submissionId]);

  // Generate private signed URLs (TTL 900s) for all finalized attachments & legacy files
  useEffect(() => {
    if (!submissionData) return;

    let isMounted = true;
    const generateSignedUrls = async () => {
      setSignedUrlsLoading(true);
      const urlMap = {};

      const attachments = submissionData.attachments || [];
      const answers = submissionData.answers || [];

      // 1. Signed URLs for attachments
      for (const att of attachments) {
        if (att.storage_path) {
          try {
            const bucket = att.storage_bucket || 'exercise-submissions';
            const { data: signRes, error: signErr } = await supabase.storage
              .from(bucket)
              .createSignedUrl(att.storage_path, 900);

            if (!signErr && signRes?.signedUrl) {
              urlMap[att.id] = signRes.signedUrl;
            } else {
              urlMap[att.id] = null;
            }
          } catch (e) {
            console.error('Error creating signed URL for attachment:', att.id, e);
            urlMap[att.id] = null;
          }
        }
      }

      // 2. Signed URLs for legacy file_url in answers if no Phase 1 attachment duplicate
      for (const ans of answers) {
        if (ans.file_url) {
          const isDuplicate = attachments.some(a => a.storage_path === ans.file_url);
          if (!isDuplicate) {
            try {
              const { data: signRes, error: signErr } = await supabase.storage
                .from('exercise-submissions')
                .createSignedUrl(ans.file_url, 900);

              if (!signErr && signRes?.signedUrl) {
                urlMap[`legacy_${ans.question_id}`] = signRes.signedUrl;
              } else {
                urlMap[`legacy_${ans.question_id}`] = null;
              }
            } catch (e) {
              console.error('Error creating signed URL for legacy file:', ans.file_url, e);
              urlMap[`legacy_${ans.question_id}`] = null;
            }
          }
        }
      }

      if (isMounted) {
        setSignedUrlsMap(urlMap);
        setSignedUrlsLoading(false);
      }
    };

    generateSignedUrls();

    return () => {
      isMounted = false;
    };
  }, [submissionData]);

  // Merge Questions and Answers
  const mergedQuestions = useMemo(() => {
    if (!submissionData) return [];

    const questions = submissionData.questions || [];
    const answers = submissionData.answers || [];
    const attachments = submissionData.attachments || [];

    const answersMap = new Map();
    answers.forEach(a => answersMap.set(a.question_id, a));

    const attachmentsByQuestion = new Map();
    attachments.forEach(att => {
      const list = attachmentsByQuestion.get(att.question_id) || [];
      list.push(att);
      attachmentsByQuestion.set(att.question_id, list);
    });

    // Sort attachments by sort_order ASC, created_at ASC
    attachmentsByQuestion.forEach((list) => {
      list.sort((a, b) => {
        if (a.sort_order !== b.sort_order) return (a.sort_order || 0) - (b.sort_order || 0);
        return new Date(a.created_at || 0) - new Date(b.created_at || 0);
      });
    });

    return [...questions]
      .sort((a, b) => (a.question_number || 0) - (b.question_number || 0))
      .map(q => {
        const answer = answersMap.get(q.id) || null;
        const qAttachments = attachmentsByQuestion.get(q.id) || [];
        return {
          ...q,
          answer,
          attachments: qAttachments
        };
      });
  }, [submissionData]);

  if (!isOpen) return null;

  const sub = submissionData?.submission;
  const exercise = sub?.exercise || {};
  const isGraded = sub?.status === 'graded';
  const isRevisionRequested = sub?.status === 'revision_requested';

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-900/70 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4 overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-labelledby="graded-viewer-title"
    >
      <div className="bg-white w-full max-w-4xl rounded-3xl shadow-2xl border-2 border-slate-100 flex flex-col max-h-[92vh] overflow-hidden my-auto animate-in fade-in zoom-in-95 duration-150">
        {/* MODAL HEADER */}
        <div className="flex items-center justify-between p-4 sm:p-6 border-b border-slate-100 bg-gradient-to-r from-amber-50 to-orange-50">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-2xl bg-amber-500 text-white flex items-center justify-center shrink-0 shadow-md">
              <BookOpen className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <h2 id="graded-viewer-title" className="text-base sm:text-lg font-black text-slate-800 truncate">
                {exercise.title || 'Kết Quả Bài Tập'}
              </h2>
              <div className="flex items-center gap-2 mt-0.5 text-xs font-bold text-slate-500 flex-wrap">
                {exercise.subject && (
                  <span className="px-2 py-0.5 bg-white text-slate-700 rounded-md border border-slate-200">
                    Môn {exercise.subject}
                  </span>
                )}
                {isGraded && (
                  <span className="px-2.5 py-0.5 bg-emerald-100 text-emerald-800 rounded-md font-black flex items-center gap-1">
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" /> Đã chấm
                  </span>
                )}
                {isRevisionRequested && (
                  <span className="px-2.5 py-0.5 bg-amber-100 text-amber-900 rounded-md font-black flex items-center gap-1 border border-amber-300">
                    <RotateCcw className="w-3.5 h-3.5 text-amber-700" /> Cần sửa lại
                  </span>
                )}
              </div>
            </div>
          </div>

          <button
            onClick={onClose}
            aria-label="Đóng"
            className="w-9 h-9 rounded-2xl bg-white border border-slate-200 text-slate-500 hover:text-slate-800 hover:bg-slate-100 flex items-center justify-center shadow-sm shrink-0 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* MODAL BODY */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-6">
          {/* LOADING STATE */}
          {loading && (
            <div className="py-16 text-center space-y-3">
              <RefreshCw className="w-8 h-8 text-amber-500 animate-spin mx-auto" />
              <p className="text-xs font-black text-slate-600">Đang tải kết quả bài làm...</p>
            </div>
          )}

          {/* ERROR STATE */}
          {!loading && errorMsg && (
            <div className="py-12 px-6 text-center bg-rose-50 rounded-3xl border-2 border-rose-200 space-y-4 max-w-md mx-auto">
              <div className="w-12 h-12 rounded-full bg-rose-100 text-rose-600 flex items-center justify-center mx-auto">
                <AlertCircle className="w-6 h-6" />
              </div>
              <div>
                <h3 className="text-sm font-black text-rose-900">Thông báo</h3>
                <p className="text-xs font-bold text-rose-700 mt-1">{errorMsg}</p>
              </div>
              <div className="flex items-center justify-center gap-2 pt-2">
                <button
                  onClick={fetchGradedSubmission}
                  className="px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white font-black text-xs rounded-xl shadow-sm transition-all"
                >
                  Thử lại
                </button>
                <button
                  onClick={onClose}
                  className="px-4 py-2 bg-white hover:bg-slate-100 text-slate-700 font-bold text-xs rounded-xl border border-slate-200 transition-all"
                >
                  Đóng
                </button>
              </div>
            </div>
          )}

          {/* SUCCESS GRADED CONTENT */}
          {!loading && !errorMsg && submissionData && (
            <>
              {/* 1. HEADER SUMMARY & SCORES */}
              <div className="bg-gradient-to-br from-slate-900 to-slate-800 text-white p-5 sm:p-6 rounded-3xl shadow-lg relative overflow-hidden">
                <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                  <div className="space-y-1">
                    <span className="text-[11px] font-extrabold uppercase tracking-wider text-amber-400">
                      Tổng kết bài làm
                    </span>
                    <h3 className="text-xl sm:text-2xl font-black text-white flex items-center gap-2">
                      {sub.total_score !== null ? Number(sub.total_score).toFixed(1).replace(/\.0$/, '') : '-'}{' '}
                      <span className="text-sm font-bold text-slate-400">/ {sub.max_score || 10} điểm</span>
                    </h3>
                    <div className="flex items-center gap-3 text-xs font-bold text-slate-300 pt-1 flex-wrap">
                      <span>Trắc nghiệm: {Number(sub.objective_score || 0).toFixed(1).replace(/\.0$/, '')} đ</span>
                      <span>•</span>
                      <span>Tự luận/Nộp ảnh: {Number(sub.manual_score || 0).toFixed(1).replace(/\.0$/, '')} đ</span>
                    </div>
                  </div>

                  <div className="flex flex-col sm:items-end gap-1.5 text-xs font-bold text-slate-300">
                    {sub.graded_at && (
                      <span className="flex items-center gap-1">
                        <Clock className="w-3.5 h-3.5 text-slate-400" />
                        Chấm lúc: {formatDateTime(sub.graded_at)}
                      </span>
                    )}
                    {sub.submitted_at && (
                      <span className="flex items-center gap-1 text-slate-400 text-[11px]">
                        Nộp lúc: {formatDateTime(sub.submitted_at)}
                      </span>
                    )}
                  </div>
                </div>
              </div>

              {/* 2. REVISION REQUESTED BANNER */}
              {isRevisionRequested && (
                <div className="p-4 bg-amber-50 rounded-2xl border-2 border-amber-300 flex items-start gap-3 text-amber-950">
                  <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
                  <div className="text-xs space-y-1">
                    <p className="font-black text-amber-900">Giáo viên yêu cầu bạn sửa lại bài.</p>
                    <p className="font-bold text-amber-800">
                      Vui lòng đọc kỹ nhận xét và xem các nét vẽ hướng dẫn của Thầy/Cô trên bài làm bên dưới.
                    </p>
                  </div>
                </div>
              )}

              {/* 3. OVERALL TEACHER FEEDBACK */}
              {sub.teacher_feedback && (
                <div className="p-4 sm:p-5 bg-amber-50/60 rounded-3xl border border-amber-200 space-y-1.5">
                  <h4 className="text-xs font-black text-amber-900 flex items-center gap-1.5">
                    <MessageSquare className="w-4 h-4 text-amber-600" /> Nhận xét chung của Giáo viên:
                  </h4>
                  <p className="text-xs font-bold text-slate-700 whitespace-pre-wrap leading-relaxed">
                    {sub.teacher_feedback}
                  </p>
                </div>
              )}

              {/* 4. LIST OF QUESTIONS & ANSWERS */}
              <div className="space-y-6 pt-2">
                <h4 className="text-sm font-black text-slate-800 flex items-center gap-2">
                  <FileText className="w-4 h-4 text-amber-600" /> Chi Tiết Từng Câu Hỏi
                </h4>

                {mergedQuestions.length === 0 ? (
                  <div className="p-6 text-center text-xs font-bold text-slate-400 bg-slate-50 rounded-2xl border border-dashed border-slate-200">
                    Không có dữ liệu câu hỏi.
                  </div>
                ) : (
                  mergedQuestions.map((q) => {
                    const ans = q.answer;
                    const pointsEarned = ans?.points_earned !== null && ans?.points_earned !== undefined
                      ? Number(ans.points_earned).toFixed(1).replace(/\.0$/, '')
                      : '0';
                    const maxPoints = Number(q.points || 0).toFixed(1).replace(/\.0$/, '');

                    const hasAttachments = q.attachments && q.attachments.length > 0;
                    const legacySignedUrl = signedUrlsMap[`legacy_${q.id}`];

                    return (
                      <div
                        key={q.id}
                        className="bg-white p-5 sm:p-6 rounded-3xl border-2 border-slate-200 shadow-sm space-y-4"
                      >
                        {/* QUESTION HEADER */}
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 border-b border-slate-100">
                          <div className="flex items-center gap-2">
                            <span className="w-7 h-7 rounded-xl bg-amber-100 text-amber-900 font-black text-xs flex items-center justify-center">
                              {q.question_number || '?'}
                            </span>
                            <span className="text-xs font-black text-slate-800">
                              Câu {q.question_number}
                            </span>
                            <span className="px-2 py-0.5 bg-slate-100 text-slate-600 font-bold text-[10px] rounded-md">
                              {q.question_type === 'single_choice'
                                ? 'Trắc nghiệm'
                                : q.question_type === 'image_upload'
                                ? 'Nộp ảnh'
                                : q.question_type === 'essay'
                                ? 'Tự luận'
                                : q.question_type}
                            </span>
                          </div>

                          <div className="flex items-center gap-2 text-xs font-black">
                            <span className="px-3 py-1 bg-emerald-50 text-emerald-800 rounded-xl border border-emerald-200">
                              Đạt: {pointsEarned} / {maxPoints} đ
                            </span>
                          </div>
                        </div>

                        {/* QUESTION PROMPT */}
                        <p className="text-xs sm:text-sm font-bold text-slate-800 whitespace-pre-wrap">
                          {q.prompt}
                        </p>

                        {/* STUDENT ANSWER */}
                        {ans && (
                          <div className="space-y-3 pt-2">
                            {/* Trắc nghiệm / Điền từ */}
                            {ans.student_answer_json && (
                              <div className="p-3 bg-slate-50 rounded-2xl border border-slate-200 text-xs font-bold text-slate-700 space-y-1">
                                <span className="text-[11px] font-black text-slate-400 uppercase">
                                  Câu trả lời của bạn:
                                </span>
                                <div className="text-slate-900 font-black">
                                  {typeof ans.student_answer_json === 'object'
                                    ? ans.student_answer_json.selected_option ||
                                      ans.student_answer_json.text ||
                                      JSON.stringify(ans.student_answer_json)
                                    : String(ans.student_answer_json)}
                                </div>
                              </div>
                            )}

                            {/* Phase 1 Attachments (Multi-Image with Final Annotations) */}
                            {hasAttachments && (
                              <div className="space-y-4 pt-1">
                                <span className="text-[11px] font-black text-slate-500 uppercase tracking-wide flex items-center gap-1.5">
                                  <ImageIcon className="w-3.5 h-3.5 text-amber-600" />
                                  Ảnh bài làm ({q.attachments.length} ảnh):
                                </span>

                                <div className="space-y-6">
                                  {q.attachments.map((att, idx) => {
                                    const signedUrl = signedUrlsMap[att.id];
                                    const isImage = att.mime_type && att.mime_type.startsWith('image/');
                                    const finalAnnotation = att.final_annotation?.annotation_json;
                                    const safeAnn = sanitizeAnnotation(finalAnnotation);

                                    return (
                                      <div
                                        key={att.id}
                                        className="bg-slate-50 p-4 rounded-3xl border border-slate-200 space-y-3"
                                      >
                                        <div className="flex items-center justify-between text-xs font-bold text-slate-600">
                                          <span className="font-black text-slate-800">
                                            Trang {idx + 1} / {q.attachments.length}
                                            {att.original_file_name ? ` • ${att.original_file_name}` : ''}
                                          </span>
                                          {att.byte_size && (
                                            <span className="text-[11px] text-slate-400">
                                              {formatFileSize(att.byte_size)}
                                            </span>
                                          )}
                                        </div>

                                        {isImage ? (
                                          signedUrlsLoading ? (
                                            <div className="py-12 text-center text-xs font-bold text-slate-400">
                                              Đang tải ảnh...
                                            </div>
                                          ) : signedUrl ? (
                                            <div className="overflow-hidden rounded-2xl">
                                              <SubmissionAnnotationCanvas
                                                imageUrl={signedUrl}
                                                annotation={safeAnn}
                                                readOnly={true}
                                              />
                                            </div>
                                          ) : (
                                            <div className="py-8 text-center text-xs font-bold text-rose-500 bg-rose-50 rounded-2xl border border-rose-200">
                                              Không thể tải ảnh bài làm.
                                            </div>
                                          )
                                        ) : (
                                          // Non-image file card
                                          <div className="p-4 bg-white rounded-2xl border border-slate-200 flex items-center justify-between">
                                            <div className="flex items-center gap-2 min-w-0">
                                              <FileText className="w-5 h-5 text-indigo-600 shrink-0" />
                                              <span className="text-xs font-bold text-slate-700 truncate">
                                                {att.original_file_name || 'Tệp đính kèm'}
                                              </span>
                                            </div>
                                            {signedUrl && (
                                              <a
                                                href={signedUrl}
                                                target="_blank"
                                                rel="noreferrer"
                                                className="px-3 py-1.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 font-bold text-xs rounded-xl flex items-center gap-1 border border-indigo-200 shrink-0"
                                              >
                                                <ExternalLink className="w-3.5 h-3.5" /> Mở tệp
                                              </a>
                                            )}
                                          </div>
                                        )}
                                      </div>
                                    );
                                  })}
                                </div>
                              </div>
                            )}

                            {/* Legacy Single File Fallback */}
                            {!hasAttachments && ans.file_url && (
                              <div className="space-y-2 pt-1">
                                <span className="text-[11px] font-black text-slate-500 uppercase tracking-wide">
                                  Tệp bài nộp:
                                </span>
                                {legacySignedUrl ? (
                                  <div className="rounded-2xl overflow-hidden border border-slate-200">
                                    <img
                                      src={legacySignedUrl}
                                      alt="Bài làm"
                                      className="w-full h-auto block"
                                      onError={(e) => {
                                        e.currentTarget.style.display = 'none';
                                      }}
                                    />
                                    <div className="p-3 bg-slate-50 border-t border-slate-200 flex items-center justify-between">
                                      <span className="text-xs font-bold text-slate-600 truncate">
                                        {ans.file_url.split('/').pop()}
                                      </span>
                                      <a
                                        href={legacySignedUrl}
                                        target="_blank"
                                        rel="noreferrer"
                                        className="px-3 py-1 bg-white hover:bg-slate-100 text-slate-700 font-bold text-xs rounded-lg border border-slate-200 flex items-center gap-1"
                                      >
                                        <ExternalLink className="w-3.5 h-3.5" /> Xem ảnh gốc
                                      </a>
                                    </div>
                                  </div>
                                ) : (
                                  <div className="p-3 bg-slate-50 rounded-xl text-xs font-bold text-slate-400">
                                    Đang tải tệp bài nộp...
                                  </div>
                                )}
                              </div>
                            )}

                            {/* TEACHER COMMENT FOR THIS QUESTION */}
                            {ans.teacher_comment && (
                              <div className="p-3.5 bg-emerald-50/70 rounded-2xl border border-emerald-200 text-xs font-bold text-emerald-950 space-y-1">
                                <span className="text-[11px] font-black text-emerald-800 uppercase flex items-center gap-1">
                                  <MessageSquare className="w-3.5 h-3.5 text-emerald-600" /> Nhận xét của Thầy/Cô:
                                </span>
                                <p className="text-emerald-900 whitespace-pre-wrap">
                                  {ans.teacher_comment}
                                </p>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            </>
          )}
        </div>

        {/* MODAL FOOTER */}
        <div className="p-4 sm:p-5 border-t border-slate-100 bg-slate-50 flex items-center justify-between">
          <span className="text-xs font-bold text-slate-400">
            Chế độ xem kết quả (Read-only)
          </span>
          <button
            onClick={onClose}
            className="px-5 py-2 bg-slate-800 hover:bg-slate-900 text-white font-black text-xs rounded-xl shadow-sm transition-all"
          >
            Đóng
          </button>
        </div>
      </div>
    </div>
  );
};
