import React, { useState, useEffect, useRef } from 'react';
import { 
  X, CheckCircle2, RotateCcw, Save, FileText, AlertCircle, 
  Loader2, Star, Eye, Image as ImageIcon, Pen, Sparkles, AlertTriangle, RefreshCw 
} from 'lucide-react';
import { supabase } from '../../../lib/supabase';
import { formatClassLabel } from '../../../utils/helpers';
import { 
  getGradingWorkspace, 
  saveAnnotationDraft, 
  finalizeGradingWithAnnotations 
} from '../../../services/submissionAnnotationClient';
import { SubmissionAnnotationCanvas } from './SubmissionAnnotationCanvas';
import { AnnotationToolbar } from './AnnotationToolbar';
import { zoomIn, zoomOut, resetZoom } from '../../../utils/annotationViewportMath';

/**
 * Map các mã lỗi bảo mật / logic từ finalize RPC sang thông báo thân thiện với giáo viên
 */
function mapFinalizeErrorMessage(err, data) {
  const errCode = data?.error || (typeof err === 'string' ? err : err?.message || '');
  if (errCode.includes('ATTACHMENT_NOT_FOUND') || errCode.includes('Không tìm thấy ảnh')) {
    return 'Không tìm thấy ảnh bài làm.';
  }
  if (errCode.includes('ATTACHMENT_MISMATCH') || errCode.includes('không thuộc bài nộp')) {
    return 'Ảnh bài làm không thuộc lượt nộp đang chấm.';
  }
  if (errCode.includes('ATTACHMENT_NOT_FINALIZED') || errCode.includes('chưa ở trạng thái finalized')) {
    return 'Có ảnh chưa hoàn tất tải lên.';
  }
  if (errCode.includes('DUPLICATE_ATTACHMENT') || errCode.includes('Trùng lặp attachment_id')) {
    return 'Dữ liệu ảnh chấm bị trùng.';
  }
  if (errCode.includes('DUPLICATE_IDEMPOTENCY_KEY') || errCode.includes('Trùng lặp idempotency_key')) {
    return 'Dữ liệu hoàn tất chấm bị trùng mã yêu cầu.';
  }
  if (errCode.includes('IDEMPOTENCY_KEY_MISMATCH') || errCode.includes('Mã yêu cầu hoàn tất chấm không khớp')) {
    return 'Mã yêu cầu hoàn tất chấm không khớp.';
  }
  if (errCode.includes('INVALID_EXPECTED_VERSION') || errCode.includes('expected_version')) {
    return 'Phiên bản nét chấm không hợp lệ.';
  }
  if (errCode.includes('VERSION_CONFLICT') || errCode.includes('xung đột') || errCode.includes('cửa sổ khác')) {
    return 'Phiên chấm đã được cập nhật ở cửa sổ khác. Hãy tải lại bản mới nhất trước khi hoàn tất.';
  }
  if (errCode.includes('PAYLOAD_TOO_LARGE') || errCode.includes('quá lớn')) {
    return 'Nét chấm quá lớn để hoàn tất.';
  }
  return data?.message || err?.message || 'Lỗi khi lưu kết quả chấm bài.';
}

/**
 * Format bytes to readable string (e.g. 1.2 MB, 450 KB)
 */
function formatFileSize(bytes) {
  if (!bytes || bytes <= 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

export const SubmissionGradingModal = ({ exercise, onClose }) => {
  const [submissions, setSubmissions] = useState([]);
  const [selectedSub, setSelectedSub] = useState(null);
  const [loading, setLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [signedUrlsMap, setSignedUrlsMap] = useState({});

  // WORKSPACE STATE CHO PHASE 1 MULTI-IMAGE & ANNOTATIONS
  const [workspaceData, setWorkspaceData] = useState(null);
  const [workspaceLoading, setWorkspaceLoading] = useState(false);
  const [workspaceError, setWorkspaceError] = useState('');
  const [attachmentSignedUrls, setAttachmentSignedUrls] = useState({});

  // ANNOTATION STATE (STEP C2 - DRAFT SAVE & OCC)
  const [annotationsByAttachment, setAnnotationsByAttachment] = useState({});
  const [annotationHistoryByAttachment, setAnnotationHistoryByAttachment] = useState({});
  const [annotationVersions, setAnnotationVersions] = useState({});
  const [annotationDirty, setAnnotationDirty] = useState({});
  const [annotationSaveState, setAnnotationSaveState] = useState({}); // 'idle' | 'dirty' | 'saving' | 'saved' | 'conflict' | 'error'
  const [annotationSaveError, setAnnotationSaveError] = useState({});
  const [activeAttachmentForAnnotation, setActiveAttachmentForAnnotation] = useState(null);
  const [activeTool, setActiveTool] = useState('pen');
  const [activeColor, setActiveColor] = useState('#ef4444');
  const [strokeWidth, setStrokeWidth] = useState(4);

  // VIEWPORT ZOOM & PAN STATE (PHASE 2 - P2-A2)
  const [viewportScale, setViewportScale] = useState(1);
  const [viewportPan, setViewportPan] = useState({ x: 0, y: 0 });

  // Reset viewport whenever opening a different attachment
  useEffect(() => {
    if (activeAttachmentForAnnotation) {
      setViewportScale(1);
      setViewportPan({ x: 0, y: 0 });
    }
  }, [activeAttachmentForAnnotation?.id]);

  const handleZoomIn = () => {
    setViewportScale(prev => {
      const next = zoomIn(prev);
      if (next <= 1) setViewportPan({ x: 0, y: 0 });
      return next;
    });
  };

  const handleZoomOut = () => {
    setViewportScale(prev => {
      const next = zoomOut(prev);
      if (next <= 1) setViewportPan({ x: 0, y: 0 });
      return next;
    });
  };

  const handleResetZoom = () => {
    const reset = resetZoom();
    setViewportScale(reset.scale);
    setViewportPan({ x: reset.panX, y: reset.panY });
  };

  // REFS CHO SAVE DRAFT, OCC & DEBOUNCE
  const pendingIdempotencyKeysRef = useRef({});
  const finalizeIdempotencyKeysRef = useRef({});
  const inFlightSavesRef = useRef({});
  const debounceTimersRef = useRef({});
  const annotationsRef = useRef({});
  const annotationVersionsRef = useRef({});

  useEffect(() => {
    annotationsRef.current = annotationsByAttachment;
  }, [annotationsByAttachment]);

  useEffect(() => {
    annotationVersionsRef.current = annotationVersions;
  }, [annotationVersions]);

  const [manualGrades, setManualGrades] = useState({});
  const [feedback, setFeedback] = useState('');
  const [requestRevision, setRequestRevision] = useState(false);
  const [msg, setMsg] = useState('');

  useEffect(() => {
    fetchSubmissions();
  }, [exercise.id]);

  const fetchSubmissions = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('academic_submissions')
        .select('*, profiles!student_id(full_name, avatar_url), academic_submission_answers(*, academic_exercise_questions(*))')
        .eq('exercise_id', exercise.id)
        .order('submitted_at', { ascending: false });

      if (!error && data) {
        setSubmissions(data);
        if (data.length > 0) {
          const currentUpdated = selectedSub ? data.find(s => s.id === selectedSub.id) : null;
          selectSubmissionForGrading(currentUpdated || data[0]);
        }
      }
    } catch (err) {
      console.error('Fetch submissions error:', err);
    } finally {
      setLoading(false);
    }
  };

  const selectSubmissionForGrading = async (sub) => {
    setSelectedSub(sub);
    setFeedback(sub.teacher_feedback || '');
    setRequestRevision(sub.status === 'revision_requested');
    const grades = {};
    const signedMap = {};

    if (sub.academic_submission_answers) {
      for (const a of sub.academic_submission_answers) {
        grades[a.question_id] = {
          points_earned: a.points_earned ?? 0,
          teacher_comment: a.teacher_comment || ''
        };

        if (a.file_url) {
          try {
            const { data: signedData } = await supabase.storage
              .from('exercise-submissions')
              .createSignedUrl(a.file_url, 900);
            if (signedData?.signedUrl) {
              signedMap[a.question_id] = signedData.signedUrl;
            }
          } catch (e) {
            console.error('Signed URL error:', e);
          }
        }
      }
    }

    setManualGrades(grades);
    setSignedUrlsMap(signedMap);

    // NẠP GRADING WORKSPACE QUA SERVICE CLIENT PHASE 1
    setWorkspaceLoading(true);
    setWorkspaceError('');
    setWorkspaceData(null);
    setAttachmentSignedUrls({});

    try {
      const { ok, data: wsData, error: wsErr } = await getGradingWorkspace({
        submissionId: sub.id
      });

      if (!ok || !wsData?.success) {
        const errMsg = wsErr?.message || wsData?.message || 'Không thể tải không gian chấm bài.';
        setWorkspaceError(errMsg);
      } else {
        setWorkspaceData(wsData);

        // Tạo Signed URLs 900s cho các attachments đã finalized của bài nộp
        const attSignMap = {};
        const finalizedAtts = (wsData.attachments || []).filter(
          att => att.upload_status === 'finalized' && att.storage_path
        );

        for (const att of finalizedAtts) {
          try {
            const { data: signData } = await supabase.storage
              .from('exercise-submissions')
              .createSignedUrl(att.storage_path, 900);
            if (signData?.signedUrl) {
              attSignMap[att.id] = signData.signedUrl;
            }
          } catch (signErr) {
            console.error('Attachment Signed URL exception:', signErr);
          }
        }
        setAttachmentSignedUrls(attSignMap);

        // HYDRATE ANNOTATIONS & VERSIONS TỪ WORKSPACE (STEP C2)
        const initialAnnotations = {};
        const initialVersions = {};
        const initialDirty = {};
        const initialSaveState = {};
        const initialSaveError = {};

        (wsData.attachments || []).forEach(att => {
          const latestAnn = att.latest_annotation;
          if (latestAnn && latestAnn.annotation_json && typeof latestAnn.annotation_json === 'object') {
            try {
              initialAnnotations[att.id] = {
                schema_version: latestAnn.annotation_json.schema_version || latestAnn.schema_version || 1,
                strokes: Array.isArray(latestAnn.annotation_json.strokes) ? latestAnn.annotation_json.strokes : [],
                stamps: Array.isArray(latestAnn.annotation_json.stamps) ? latestAnn.annotation_json.stamps : [],
                notes: Array.isArray(latestAnn.annotation_json.notes) ? latestAnn.annotation_json.notes : []
              };
              initialVersions[att.id] = typeof latestAnn.version === 'number' ? latestAnn.version : 0;
              initialSaveState[att.id] = 'saved';
            } catch (err) {
              console.warn('Malformed annotation in attachment:', att.id, err);
              initialAnnotations[att.id] = { schema_version: 1, strokes: [], stamps: [], notes: [] };
              initialVersions[att.id] = typeof latestAnn.version === 'number' ? latestAnn.version : 0;
              initialSaveState[att.id] = 'idle';
            }
          } else {
            initialAnnotations[att.id] = { schema_version: 1, strokes: [], stamps: [], notes: [] };
            initialVersions[att.id] = 0;
            initialSaveState[att.id] = 'idle';
          }
          initialDirty[att.id] = false;
          initialSaveError[att.id] = null;
        });

        setAnnotationsByAttachment(initialAnnotations);
        setAnnotationVersions(initialVersions);
        annotationVersionsRef.current = initialVersions;
        setAnnotationDirty(initialDirty);
        setAnnotationSaveState(initialSaveState);
        setAnnotationSaveError(initialSaveError);
        setActiveAttachmentForAnnotation(null);
        pendingIdempotencyKeysRef.current = {};
        finalizeIdempotencyKeysRef.current = {};
        inFlightSavesRef.current = {};
      }
    } catch (err) {
      console.error('Get grading workspace exception:', err);
      setWorkspaceError(err.message || 'Lỗi kết nối khi tải không gian chấm bài.');
    } finally {
      setWorkspaceLoading(false);
    }
  };

  /**
   * Lưu bản nháp nét chấm cho một attachment (Step C2 - Draft Save & OCC)
   */
  const handleSaveDraft = async (attachmentId, { isManual = false } = {}) => {
    if (!attachmentId || inFlightSavesRef.current[attachmentId]) return { ok: false, busy: true };

    // Snapshot annotation JSON
    const annotationJson = annotationsRef.current[attachmentId] || {
      schema_version: 1,
      strokes: [],
      stamps: [],
      notes: []
    };

    // Client-side payload size check (512 KiB)
    try {
      const payloadSize = new Blob([JSON.stringify(annotationJson)]).size;
      if (payloadSize > 512 * 1024) {
        setAnnotationSaveState(prev => ({ ...prev, [attachmentId]: 'error' }));
        setAnnotationSaveError(prev => ({
          ...prev,
          [attachmentId]: 'Nét chấm quá lớn để lưu. Hãy xóa bớt nét hoặc ghi chú.'
        }));
        return { ok: false, error: new Error('Nét chấm quá lớn để lưu.') };
      }
    } catch (sizeErr) {
      console.error('Payload size check error:', sizeErr);
    }

    const expectedVersion = annotationVersionsRef.current[attachmentId] ?? annotationVersions[attachmentId] ?? 0;

    // Idempotency Key: Reuse same key for network retry, generate new key if none exists
    if (!pendingIdempotencyKeysRef.current[attachmentId]) {
      pendingIdempotencyKeysRef.current[attachmentId] = (typeof crypto !== 'undefined' && crypto.randomUUID)
        ? crypto.randomUUID()
        : `idemp_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    }
    const idempotencyKey = pendingIdempotencyKeysRef.current[attachmentId];

    inFlightSavesRef.current[attachmentId] = true;
    setAnnotationSaveState(prev => ({ ...prev, [attachmentId]: 'saving' }));
    setAnnotationSaveError(prev => ({ ...prev, [attachmentId]: null }));

    try {
      const { ok, data, error, isConflict } = await saveAnnotationDraft({
        attachmentId,
        annotationJson,
        expectedVersion,
        idempotencyKey,
        schemaVersion: 1,
        renderedPreviewPath: null
      });

      inFlightSavesRef.current[attachmentId] = false;

      if (!ok || !data?.success) {
        if (isConflict || data?.error === 'VERSION_CONFLICT') {
          setAnnotationSaveState(prev => ({ ...prev, [attachmentId]: 'conflict' }));
          setAnnotationSaveError(prev => ({
            ...prev,
            [attachmentId]: 'Phiên chấm này đã được cập nhật ở cửa sổ khác. Hãy tải lại dữ liệu trước khi tiếp tục lưu.'
          }));
          return { ok: false, isConflict: true, error: error || new Error('VERSION_CONFLICT') };
        } else {
          setAnnotationSaveState(prev => ({ ...prev, [attachmentId]: 'error' }));
          setAnnotationSaveError(prev => ({
            ...prev,
            [attachmentId]: error?.message || data?.message || 'Lỗi khi lưu bản nháp.'
          }));
          return { ok: false, error: error || new Error(data?.message || 'Lỗi khi lưu bản nháp') };
        }
      }

      // Thành công
      const newVersion = data.version;
      annotationVersionsRef.current[attachmentId] = newVersion;
      setAnnotationVersions(prev => ({ ...prev, [attachmentId]: newVersion }));
      pendingIdempotencyKeysRef.current[attachmentId] = null; // Reset idempotency key sau khi save thành công

      // Kiểm tra xem người dùng có vẽ thêm nét nào trong lúc đang gửi request save không
      const currentLatestJson = annotationsRef.current[attachmentId];
      const isStillSame = JSON.stringify(currentLatestJson) === JSON.stringify(annotationJson);

      if (isStillSame) {
        setAnnotationDirty(prev => ({ ...prev, [attachmentId]: false }));
        setAnnotationSaveState(prev => ({ ...prev, [attachmentId]: 'saved' }));
      } else {
        // User vẽ thêm trong lúc save -> giữ dirty = true và kích hoạt debounce save version kế tiếp
        setAnnotationDirty(prev => ({ ...prev, [attachmentId]: true }));
        setAnnotationSaveState(prev => ({ ...prev, [attachmentId]: 'dirty' }));
        if (debounceTimersRef.current[attachmentId]) {
          clearTimeout(debounceTimersRef.current[attachmentId]);
        }
        debounceTimersRef.current[attachmentId] = setTimeout(() => {
          handleSaveDraft(attachmentId, { isManual: false });
        }, 1000);
      }
      return { ok: true, version: newVersion };
    } catch (err) {
      inFlightSavesRef.current[attachmentId] = false;
      console.error('Save draft exception:', err);
      setAnnotationSaveState(prev => ({ ...prev, [attachmentId]: 'error' }));
      setAnnotationSaveError(prev => ({
        ...prev,
        [attachmentId]: err.message || 'Lỗi kết nối khi lưu bản nháp.'
      }));
      return { ok: false, error: err };
    }
  };

  const handleAnnotationChange = (attachmentId, newAnnotation, { isHistoryAction = false } = {}) => {
    // Record history stack unless it's an undo/redo step
    if (!isHistoryAction) {
      const currentSnapshot = annotationsRef.current[attachmentId] || annotationsByAttachment[attachmentId] || {
        schema_version: 1,
        strokes: [],
        stamps: [],
        notes: []
      };

      setAnnotationHistoryByAttachment(prev => {
        const attHistory = prev[attachmentId] || { past: [], future: [] };
        const updatedPast = [...attHistory.past.slice(-49), JSON.parse(JSON.stringify(currentSnapshot))];
        return {
          ...prev,
          [attachmentId]: {
            past: updatedPast,
            future: []
          }
        };
      });
    }

    setAnnotationsByAttachment(prev => ({
      ...prev,
      [attachmentId]: newAnnotation
    }));
    setAnnotationDirty(prev => ({
      ...prev,
      [attachmentId]: true
    }));
    setAnnotationSaveState(prev => ({
      ...prev,
      [attachmentId]: 'dirty'
    }));

    // Tạo idempotency key mới cho payload thay đổi mới này
    pendingIdempotencyKeysRef.current[attachmentId] = (typeof crypto !== 'undefined' && crypto.randomUUID)
      ? crypto.randomUUID()
      : `idemp_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

    // Reset finalize idempotency key đã lưu cho attachment này để lượt finalize mới tạo key mới
    finalizeIdempotencyKeysRef.current[attachmentId] = null;

    // Debounce autosave 1000ms (800 - 1200ms)
    if (debounceTimersRef.current[attachmentId]) {
      clearTimeout(debounceTimersRef.current[attachmentId]);
    }
    debounceTimersRef.current[attachmentId] = setTimeout(() => {
      handleSaveDraft(attachmentId, { isManual: false });
    }, 1000);
  };

  const handleUndoAnnotation = (attachmentId) => {
    const history = annotationHistoryByAttachment[attachmentId] || { past: [], future: [] };
    const current = annotationsByAttachment[attachmentId] || { schema_version: 1, strokes: [], stamps: [], notes: [] };

    if (history.past.length > 0) {
      const prevSnapshot = history.past[history.past.length - 1];
      const newPast = history.past.slice(0, -1);
      const newFuture = [...history.future, JSON.parse(JSON.stringify(current))];

      setAnnotationHistoryByAttachment(prev => ({
        ...prev,
        [attachmentId]: { past: newPast, future: newFuture }
      }));

      handleAnnotationChange(attachmentId, prevSnapshot, { isHistoryAction: true });
      return;
    }

    // Fallback if history stack is empty (e.g. freshly loaded page with initial elements)
    const strokes = [...(current.strokes || [])];
    const stamps = [...(current.stamps || [])];
    const notes = [...(current.notes || [])];

    if (strokes.length > 0) {
      strokes.pop();
    } else if (stamps.length > 0) {
      stamps.pop();
    } else if (notes.length > 0) {
      notes.pop();
    }

    const updated = {
      ...current,
      strokes,
      stamps,
      notes
    };

    handleAnnotationChange(attachmentId, updated);
  };

  const handleRedoAnnotation = (attachmentId) => {
    const history = annotationHistoryByAttachment[attachmentId] || { past: [], future: [] };
    const current = annotationsByAttachment[attachmentId] || { schema_version: 1, strokes: [], stamps: [], notes: [] };

    if (history.future.length > 0) {
      const nextSnapshot = history.future[history.future.length - 1];
      const newFuture = history.future.slice(0, -1);
      const newPast = [...history.past, JSON.parse(JSON.stringify(current))];

      setAnnotationHistoryByAttachment(prev => ({
        ...prev,
        [attachmentId]: { past: newPast, future: newFuture }
      }));

      handleAnnotationChange(attachmentId, nextSnapshot, { isHistoryAction: true });
    }
  };

  const handleClearAnnotation = (attachmentId) => {
    const updated = {
      schema_version: 1,
      strokes: [],
      stamps: [],
      notes: []
    };
    handleAnnotationChange(attachmentId, updated);
  };

  /**
   * Tải lại phiên bản mới nhất từ máy chủ khi xảy ra xung đột (Version Conflict)
   */
  const handleReloadLatest = async (attachmentId) => {
    if (!selectedSub) return;
    const confirmed = window.confirm(
      'Tải lại sẽ nạp bản chấm mới nhất từ máy chủ. Các nét vẽ chưa lưu trên máy bạn sẽ bị thay thế. Bạn có chắc muốn tải lại không?'
    );
    if (!confirmed) return;

    setWorkspaceLoading(true);
    try {
      const { ok, data: wsData, error: wsErr } = await getGradingWorkspace({
        submissionId: selectedSub.id
      });
      if (!ok || !wsData?.success) {
        setWorkspaceError(wsErr?.message || wsData?.message || 'Không thể tải lại không gian chấm bài.');
        return;
      }

      setWorkspaceData(wsData);
      const targetAtt = (wsData.attachments || []).find(a => a.id === attachmentId);
      if (targetAtt) {
        const latestAnn = targetAtt.latest_annotation;
        if (latestAnn && latestAnn.annotation_json) {
          setAnnotationsByAttachment(prev => ({
            ...prev,
            [attachmentId]: latestAnn.annotation_json
          }));
          const v = latestAnn.version ?? 0;
          annotationVersionsRef.current[attachmentId] = v;
          setAnnotationVersions(prev => ({
            ...prev,
            [attachmentId]: v
          }));
          setAnnotationSaveState(prev => ({
            ...prev,
            [attachmentId]: 'saved'
          }));
        } else {
          setAnnotationsByAttachment(prev => ({
            ...prev,
            [attachmentId]: { schema_version: 1, strokes: [], stamps: [], notes: [] }
          }));
          annotationVersionsRef.current[attachmentId] = 0;
          setAnnotationVersions(prev => ({
            ...prev,
            [attachmentId]: 0
          }));
          setAnnotationSaveState(prev => ({
            ...prev,
            [attachmentId]: 'idle'
          }));
        }
        setAnnotationDirty(prev => ({ ...prev, [attachmentId]: false }));
        setAnnotationSaveError(prev => ({ ...prev, [attachmentId]: null }));
        pendingIdempotencyKeysRef.current[attachmentId] = null;
        finalizeIdempotencyKeysRef.current[attachmentId] = null;
      }
    } catch (err) {
      console.error('Reload latest error:', err);
    } finally {
      setWorkspaceLoading(false);
    }
  };

  /**
   * Đóng Modal kèm cảnh báo nếu còn nét chưa lưu
   */
  const handleCloseModal = () => {
    const hasUnsaved = Object.values(annotationDirty).some(Boolean) ||
      Object.values(annotationSaveState).some(s => s === 'saving');
    if (hasUnsaved) {
      const confirmed = window.confirm('Còn nét chấm chưa được lưu. Bạn có chắc chắn muốn đóng không?');
      if (!confirmed) return;
    }
    onClose?.();
  };

  /**
   * Hoàn tất chấm bài kèm annotations bằng Service Client Phase 1 (STEP D)
   */
  const handleSaveGrade = async () => {
    if (!selectedSub || isSubmitting) return;
    setIsSubmitting(true);
    setMsg('');

    try {
      // 1. Rà soát giới hạn điểm từng câu hỏi tự luận / nộp file: 0 <= points_earned <= question.points
      const subjectiveAnswers = (selectedSub.academic_submission_answers || []).filter(ans =>
        ['essay', 'image_upload', 'file_upload'].includes(
          ans.academic_exercise_questions?.question_type
        )
      );

      for (const ans of subjectiveAnswers) {
        const q = ans.academic_exercise_questions;
        const rawVal = manualGrades[ans.question_id]?.points_earned;
        const numVal = Number(rawVal);
        const maxPoints = q?.points ?? 10;
        if (rawVal === undefined || rawVal === null || rawVal === '' || isNaN(numVal) || numVal < 0 || numVal > maxPoints) {
          setMsg(`⚠️ Điểm chấm cho câu "${q?.prompt ? (q.prompt.slice(0, 30) + '...') : ''}" không hợp lệ (Phải từ 0 đến ${maxPoints} điểm).`);
          setIsSubmitting(false);
          return;
        }
      }

      // 2. Chuyển đổi an toàn sang mảng manualGrades đầy đủ (CONTRACT BẮT BUỘC)
      const gradesArray = subjectiveAnswers.map(ans => {
        const rawPoints = Number(
          manualGrades[ans.question_id]?.points_earned ?? ans.points_earned ?? 0
        );

        return {
          question_id: ans.question_id,
          points_earned: Number.isFinite(rawPoints) ? rawPoints : 0,
          teacher_comment:
            manualGrades[ans.question_id]?.teacher_comment || ''
        };
      });

      // 3. Kiểm tra trạng thái các annotation drafts (Gates)
      const savingAtts = Object.keys(annotationSaveState).filter(
        id => annotationSaveState[id] === 'saving' || inFlightSavesRef.current[id]
      );
      if (savingAtts.length > 0) {
        setMsg('⚠️ Có ảnh đang trong quá trình lưu bản nháp, vui lòng chờ trong giây lát.');
        setIsSubmitting(false);
        return;
      }

      const conflictAtts = Object.keys(annotationSaveState).filter(
        id => annotationSaveState[id] === 'conflict'
      );
      if (conflictAtts.length > 0) {
        setMsg('⚠️ Phiên chấm đã được cập nhật ở cửa sổ khác. Hãy tải lại bản mới nhất trước khi hoàn tất.');
        setIsSubmitting(false);
        return;
      }

      const errorAtts = Object.keys(annotationSaveState).filter(
        id => annotationSaveState[id] === 'error'
      );
      if (errorAtts.length > 0) {
        setMsg('⚠️ Có ảnh gặp lỗi khi lưu nét vẽ. Hãy kiểm tra lại trước khi hoàn tất.');
        setIsSubmitting(false);
        return;
      }

      // 4. Lưu nháp ngay lập tức các attachment đang dirty trước khi finalize
      const dirtyAttIds = Object.keys(annotationDirty).filter(id => annotationDirty[id] === true);
      for (const attId of dirtyAttIds) {
        if (debounceTimersRef.current[attId]) {
          clearTimeout(debounceTimersRef.current[attId]);
        }
        const saveRes = await handleSaveDraft(attId, { isManual: true });
        if (!saveRes?.ok) {
          if (saveRes?.isConflict) {
            setMsg('⚠️ Phiên chấm đã được cập nhật ở cửa sổ khác. Hãy tải lại bản mới nhất trước khi hoàn tất.');
          } else {
            setMsg(`⚠️ Lỗi khi lưu bản nháp nét vẽ trước khi hoàn tất: ${saveRes?.error?.message || 'Không xác định'}`);
          }
          setIsSubmitting(false);
          return;
        }
      }

      // 5. Xây dựng danh sách annotations payload (chỉ lấy Phase 1 finalized attachments thuộc selected submission)
      const finalizedAttachments = (workspaceData?.attachments || []).filter(
        att => att.upload_status === 'finalized' && att.submission_id === selectedSub.id
      );

      const annotationsPayload = finalizedAttachments.map(att => {
        const annJson = annotationsRef.current[att.id] || annotationsByAttachment[att.id] || {
          schema_version: 1,
          strokes: [],
          stamps: [],
          notes: []
        };

        const expVersion = annotationVersionsRef.current[att.id] ?? annotationVersions[att.id] ?? 0;

        if (!finalizeIdempotencyKeysRef.current[att.id]) {
          finalizeIdempotencyKeysRef.current[att.id] = (typeof crypto !== 'undefined' && crypto.randomUUID)
            ? crypto.randomUUID()
            : `final_idemp_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
        }
        const idempKey = finalizeIdempotencyKeysRef.current[att.id];

        return {
          attachment_id: att.id,
          annotation_json: annJson,
          expected_version: expVersion,
          idempotency_key: idempKey
        };
      });

      // 6. Thực thi Atomic Finalize RPC qua Service Client Phase 1
      const { ok, data, error } = await finalizeGradingWithAnnotations({
        submissionId: selectedSub.id,
        manualGrades: gradesArray,
        annotations: annotationsPayload,
        teacherFeedback: feedback,
        requestRevision: requestRevision
      });

      if (!ok || !data?.success) {
        const friendlyError = mapFinalizeErrorMessage(error, data);
        if (data?.error === 'VERSION_CONFLICT' || friendlyError.includes('cửa sổ khác')) {
          finalizedAttachments.forEach(att => {
            setAnnotationSaveState(prev => ({ ...prev, [att.id]: 'conflict' }));
          });
        }
        setMsg(`⚠️ ${friendlyError}`);
        setIsSubmitting(false);
        return;
      }

      // 7. Hoàn tất thành công
      finalizeIdempotencyKeysRef.current = {};
      setAnnotationDirty({});

      const totalScore = data.total_score ?? (selectedSub.objective_score + (data.manual_score ?? 0));
      const manualScore = data.manual_score ?? 0;
      const starsAwarded = data.reward_stars_awarded ?? 0;
      const finalStatus = data.status || (requestRevision ? 'revision_requested' : 'graded');

      const updatedSub = {
        ...selectedSub,
        status: finalStatus,
        total_score: totalScore,
        manual_score: manualScore,
        teacher_feedback: feedback
      };

      setSelectedSub(updatedSub);
      setSubmissions(prev => prev.map(s => s.id === selectedSub.id ? { ...s, ...updatedSub } : s));

      let successMsg = `✅ Đã lưu điểm và hoàn tất chấm bài! Tổng điểm: ${totalScore} (Tự luận: ${manualScore}đ).`;
      if (starsAwarded > 0) {
        successMsg += ` Bé nhận được ${starsAwarded} ⭐ thưởng!`;
      }
      if (finalStatus === 'revision_requested') {
        successMsg = `✅ Đã gửi yêu cầu học sinh làm lại bài tập.`;
      }
      setMsg(successMsg);
    } catch (err) {
      console.error('Finalize grading exception:', err);
      setMsg(mapFinalizeErrorMessage(err));
    } finally {
      setIsSubmitting(false);
    }
  };

  const canGrade = selectedSub && ['submitted', 'pending_manual_grade'].includes(selectedSub.status);

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-2 sm:p-4 overflow-y-auto">
      <div className="bg-white w-[95vw] md:w-[92vw] max-w-[1280px] h-[88vh] max-h-[88vh] rounded-3xl border-4 border-amber-300 shadow-2xl p-4 sm:p-6 lg:p-7 animate-fadeIn flex flex-col overflow-hidden">
        
        {/* HEADER - KHÔNG CÒN DÙNG EXERCISE.CLASS_NAME */}
        <div className="flex items-center justify-between pb-3 sm:pb-4 border-b-2 border-amber-100 shrink-0">
          <div>
            <span className="px-2.5 py-0.5 bg-amber-100 text-amber-900 font-black text-xs rounded-lg">
              {exercise.classes?.name ? formatClassLabel(exercise.classes.name) : (exercise.is_global ? 'Toàn trường' : 'Lớp học')} - Môn {exercise.subject}
            </span>
            <h2 className="text-lg sm:text-xl font-black text-slate-800 mt-1">Quản Lý & Chấm Bài: {exercise.title}</h2>
          </div>
          <button
            onClick={handleCloseModal}
            className="p-1.5 sm:p-2 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-xl transition-colors shrink-0"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* BODY */}
        <div className="grid grid-cols-1 md:grid-cols-12 gap-4 lg:gap-6 pt-4 flex-1 min-h-0 overflow-y-auto md:overflow-hidden">
          
          {/* DANH SÁCH HỌC SINH NỘP BÀI */}
          <div className="md:col-span-3 lg:col-span-3 md:border-r border-slate-200 md:pr-4 space-y-2 md:overflow-y-auto md:max-h-full">
            <h3 className="text-xs font-black text-slate-500 uppercase tracking-wider mb-2">
              Danh sách nộp bài ({submissions.length})
            </h3>
            {loading ? (
              <div className="text-xs font-bold text-slate-400">Đang tải...</div>
            ) : submissions.length === 0 ? (
              <div className="text-xs font-bold text-slate-400 py-4">Chưa có học sinh nộp bài.</div>
            ) : (
              submissions.map(sub => (
                <button
                  key={sub.id}
                  onClick={() => selectSubmissionForGrading(sub)}
                  className={`w-full p-3 rounded-2xl border text-left transition-all flex items-center justify-between ${
                    selectedSub?.id === sub.id
                      ? 'bg-amber-500 text-white border-amber-600 shadow-sm'
                      : 'bg-white text-slate-800 border-slate-200 hover:bg-amber-50'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-full bg-amber-200 flex items-center justify-center font-black text-xs text-amber-900 shrink-0">
                      {sub.profiles?.full_name?.charAt(0) || 'H'}
                    </div>
                    <div className="min-w-0">
                      <p className="font-black text-xs truncate">{sub.profiles?.full_name || 'Học sinh'}</p>
                      <div className="flex items-center gap-1 mt-0.5">
                        <span className={`px-1.5 py-0.5 text-[9px] font-black rounded ${
                          sub.status === 'graded'
                            ? selectedSub?.id === sub.id ? 'bg-emerald-200 text-emerald-950' : 'bg-emerald-100 text-emerald-800'
                            : sub.status === 'revision_requested'
                            ? selectedSub?.id === sub.id ? 'bg-rose-200 text-rose-950' : 'bg-rose-100 text-rose-800'
                            : selectedSub?.id === sub.id ? 'bg-amber-200 text-amber-950' : 'bg-amber-100 text-amber-900'
                        }`}>
                          {sub.status === 'graded' ? 'Đã chấm' : sub.status === 'revision_requested' ? 'Cần làm lại' : 'Chờ chấm'}
                        </span>
                      </div>
                    </div>
                  </div>
                  <span className="font-black text-xs shrink-0">{sub.total_score ?? 0}đ</span>
                </button>
              ))
            )}
          </div>

          {/* CHẤM BÀI CHI TIẾT */}
          <div className="md:col-span-9 lg:col-span-9 space-y-4 md:overflow-y-auto md:max-h-full md:pr-2">
            {selectedSub ? (
              <>
                {msg && (
                  <div className="p-3 bg-amber-50 border border-amber-300 text-amber-900 rounded-xl text-xs font-bold">
                    {msg}
                  </div>
                )}

                {workspaceError && (
                  <div className="p-3 bg-rose-50 border border-rose-300 text-rose-800 rounded-xl text-xs font-bold flex items-center gap-2">
                    <AlertCircle className="w-4 h-4 shrink-0 text-rose-600" />
                    <span>{workspaceError}</span>
                  </div>
                )}

                <div className="bg-slate-50 p-4 rounded-2xl border border-slate-200 flex items-center justify-between">
                  <div>
                    <h4 className="font-black text-sm text-slate-800">{selectedSub.profiles?.full_name}</h4>
                    <p className="text-xs font-bold text-slate-500">
                      Nộp lúc: {new Date(selectedSub.submitted_at).toLocaleString('vi-VN')}
                    </p>
                  </div>
                  <div className="text-right">
                    <span className="text-2xl font-black text-amber-600">
                      {selectedSub.total_score ?? 0} / {selectedSub.max_score} điểm
                    </span>
                  </div>
                </div>

                {workspaceLoading ? (
                  <div className="p-8 text-center text-xs font-bold text-slate-400">
                    <Loader2 className="w-6 h-6 animate-spin text-amber-500 mx-auto mb-2" />
                    Đang nạp không gian làm việc chấm bài...
                  </div>
                ) : (
                  /* DANH SÁCH CÂU HỎI VÀ BÀI LÀM */
                  <div className="space-y-3">
                    {(selectedSub.academic_submission_answers || []).map((ans, idx) => {
                      const q = ans.academic_exercise_questions;
                      const isSubjective = ['essay', 'image_upload', 'file_upload'].includes(q?.question_type);

                      return (
                        <div key={ans.id} className="bg-white p-4 rounded-2xl border border-slate-200 space-y-2">
                          <div className="flex items-center justify-between">
                            <span className="font-black text-xs text-slate-800">
                              Câu {idx + 1} [{q?.question_type}]: {q?.prompt}
                            </span>
                            <span className="text-xs font-bold text-sky-600">
                              Tối đa {q?.points} điểm
                            </span>
                          </div>

                          <div className="bg-slate-50 p-2.5 rounded-xl text-xs font-bold text-slate-700">
                            <strong>Bài làm:</strong> {JSON.stringify(ans.student_answer_json || 'Chưa có văn bản')}
                          </div>

                          {/* HIỂN THỊ PHASE 1 MULTI-IMAGE GALLERY HOẶC LEGACY SINGLE FILE (CHỐNG DUPLICATE) */}
                          {(() => {
                            const qAttachments = (workspaceData?.attachments || [])
                              .filter(att => att.question_id === ans.question_id && att.upload_status === 'finalized')
                              .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));

                            const hasPhase1Attachments = qAttachments.length > 0;
                            const isLegacyFileDuplicate = hasPhase1Attachments && qAttachments.some(att => att.storage_path === ans.file_url);
                            const shouldShowLegacyFallback = !hasPhase1Attachments && Boolean(ans.file_url);

                            return (
                              <div className="space-y-2">
                                {/* 1. GALLERY NHIỀU ẢNH PHASE 1 */}
                                {hasPhase1Attachments && (
                                  <div className="p-3 bg-amber-50/70 border border-amber-200 rounded-xl space-y-2">
                                    <div className="flex items-center justify-between">
                                      <span className="text-xs font-black text-amber-900 flex items-center gap-1.5">
                                        <ImageIcon className="w-4 h-4 text-amber-600" />
                                        Ảnh bài làm đính kèm ({qAttachments.length} ảnh)
                                      </span>
                                      <span className="text-[10px] font-bold text-slate-400">Phase 1 Multi-Image</span>
                                    </div>

                                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
                                      {qAttachments.map((att, attIdx) => {
                                        const ann = annotationsByAttachment[att.id];
                                        const strokeCount = ann?.strokes?.length || 0;
                                        const stampCount = ann?.stamps?.length || 0;
                                        const totalAnnotations = strokeCount + stampCount;
                                        const attVer = annotationVersions[att.id] ?? 0;
                                        const isDirty = annotationDirty[att.id];
                                        const saveSt = annotationSaveState[att.id] || 'idle';

                                        return (
                                          <div
                                            key={att.id || `qatt_${attIdx}`}
                                            className="bg-white p-2.5 rounded-xl border border-amber-200 shadow-sm flex flex-col justify-between space-y-2 overflow-hidden"
                                          >
                                            <div className="relative aspect-[4/3] rounded-lg overflow-hidden bg-slate-100 border border-slate-200 flex items-center justify-center">
                                              {attachmentSignedUrls[att.id] ? (
                                                <img
                                                  src={attachmentSignedUrls[att.id]}
                                                  alt={att.original_file_name || `Trang ${attIdx + 1}`}
                                                  className="w-full h-full object-cover"
                                                  loading="lazy"
                                                />
                                              ) : (
                                                <ImageIcon className="w-6 h-6 text-slate-400" />
                                              )}
                                              <span className="absolute top-1.5 left-1.5 px-2 py-0.5 bg-slate-900/70 backdrop-blur-sm text-white text-[9px] font-black rounded-md">
                                                Trang {attIdx + 1}
                                              </span>

                                              {/* BADGE TRẠNG THÁI VERSION / DIRTY TRÊN THUMBNAIL */}
                                              {attVer > 0 && (
                                                <span className="absolute top-1.5 right-1.5 px-1.5 py-0.5 bg-emerald-600/80 backdrop-blur-sm text-white text-[8px] font-black rounded">
                                                  v{attVer}
                                                </span>
                                              )}
                                            </div>

                                            <div className="min-w-0">
                                              <p className="text-[11px] font-black text-slate-800 truncate" title={att.original_file_name}>
                                                {att.original_file_name || `Ảnh ${attIdx + 1}`}
                                              </p>
                                              <p className="text-[9px] font-bold text-slate-400">
                                                {formatFileSize(att.byte_size)}
                                                {att.width && att.height ? ` • ${att.width}x${att.height}px` : ''}
                                              </p>
                                            </div>

                                            <div className="pt-1.5 border-t border-slate-100 flex items-center justify-between gap-1">
                                              {totalAnnotations > 0 ? (
                                                <span className="text-[9px] font-black text-amber-800 bg-amber-100 px-1.5 py-0.5 rounded border border-amber-300 flex items-center gap-0.5">
                                                  <Pen className="w-2.5 h-2.5 text-amber-600" /> {totalAnnotations} nét {isDirty && '•'}
                                                </span>
                                              ) : (
                                                <span className="text-[9px] font-bold text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded border border-emerald-200">
                                                  ✓ Đã nộp
                                                </span>
                                              )}

                                              <div className="flex items-center gap-1">
                                                {attachmentSignedUrls[att.id] && (
                                                  <button
                                                    type="button"
                                                    onClick={() => setActiveAttachmentForAnnotation(att)}
                                                    className="px-2 py-1 bg-amber-500 hover:bg-amber-600 text-white font-black text-[10px] rounded-lg transition-colors flex items-center gap-1 shadow-sm"
                                                    title="Mở bảng vẽ chấm điểm trên ảnh này"
                                                  >
                                                    <Pen className="w-3 h-3" /> Chấm / Vẽ
                                                  </button>
                                                )}
                                                {attachmentSignedUrls[att.id] && (
                                                  <a
                                                    href={attachmentSignedUrls[att.id]}
                                                    target="_blank"
                                                    rel="noreferrer"
                                                    className="p-1 bg-slate-100 hover:bg-slate-200 text-slate-600 font-bold text-[10px] rounded-lg transition-colors flex items-center shadow-sm"
                                                    title="Mở xem ảnh gốc trong tab mới"
                                                  >
                                                    <Eye className="w-3 h-3" />
                                                  </a>
                                                )}
                                              </div>
                                            </div>
                                          </div>
                                        );
                                      })}
                                    </div>
                                  </div>
                                )}

                                {/* 2. LEGACY SINGLE FILE FALLBACK */}
                                {shouldShowLegacyFallback && !isLegacyFileDuplicate && (
                                  <div className="p-2.5 bg-sky-50 border border-sky-200 rounded-xl text-xs flex items-center justify-between">
                                    <span className="font-bold text-sky-900 truncate max-w-[240px]">
                                      📁 File bài làm nộp (Bản cũ): {ans.file_url}
                                    </span>
                                    {signedUrlsMap[ans.question_id] ? (
                                      <a
                                        href={signedUrlsMap[ans.question_id]}
                                        target="_blank"
                                        rel="noreferrer"
                                        className="px-3 py-1 bg-sky-600 hover:bg-sky-700 text-white font-black text-[11px] rounded-lg flex items-center gap-1 shadow-sm"
                                      >
                                        <Eye className="w-3.5 h-3.5" /> Mở Xem File Private (Signed URL)
                                      </a>
                                    ) : (
                                      <span className="text-[11px] text-slate-400">Đang tạo link bảo mật...</span>
                                    )}
                                  </div>
                                )}
                              </div>
                            );
                          })()}

                          {/* CHỈ CHO PHÉP NHẬP ĐIỂM THỦ CÔNG KHI LÀ CÂU TỰ LUẬN / NỘP FILE */}
                          {isSubjective ? (
                            <div className="flex items-center gap-2 pt-1">
                              <label className="text-[11px] font-black text-slate-600">Điểm tự luận:</label>
                              <input
                                type="number"
                                step="any"
                                min="0"
                                max={q?.points || 10}
                                disabled={!canGrade}
                                value={manualGrades[ans.question_id]?.points_earned ?? ans.points_earned}
                                onChange={(e) => {
                                  const val = e.target.value;
                                  setManualGrades(prev => ({
                                    ...prev,
                                    [ans.question_id]: {
                                      ...prev[ans.question_id],
                                      points_earned: val
                                    }
                                  }));
                                }}
                                className="w-20 px-2 py-1 bg-white border border-slate-300 rounded-lg text-xs font-bold disabled:bg-slate-100 disabled:text-slate-500"
                              />
                            </div>
                          ) : (
                            <div className="text-[11px] font-extrabold text-slate-500">
                              🤖 Điểm tự động chấm trắc nghiệm: {ans.points_earned} điểm {ans.is_correct ? '✅ (Đúng)' : '❌ (Sai)'}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* NHẬN XÉT CỦA GIÁO VIÊN */}
                <div className="space-y-2">
                  <label className="block text-xs font-black text-slate-800">Nhận Xét Của Giáo Viên:</label>
                  <textarea
                    rows="2"
                    placeholder="Nhập nhận xét khen ngợi hoặc động viên bé..."
                    value={feedback}
                    disabled={!canGrade}
                    onChange={(e) => setFeedback(e.target.value)}
                    className="w-full px-3.5 py-2 bg-white border-2 border-amber-200 rounded-xl text-xs font-bold text-slate-800 disabled:bg-slate-100 disabled:text-slate-500"
                  ></textarea>

                  <div className="flex items-center gap-2 pt-1">
                    <input
                      type="checkbox"
                      id="revisionReq"
                      checked={requestRevision}
                      disabled={!canGrade}
                      onChange={(e) => setRequestRevision(e.target.checked)}
                      className="w-4 h-4 text-amber-500 rounded disabled:opacity-50"
                    />
                    <label htmlFor="revisionReq" className="text-xs font-bold text-rose-700">
                      Yêu cầu học sinh sửa và làm lại bài tập này
                    </label>
                  </div>
                </div>

                {/* NÚT HOÀN TẤT */}
                <div className="pt-2 flex justify-end">
                  {canGrade ? (
                    <button
                      onClick={handleSaveGrade}
                      disabled={isSubmitting}
                      className="px-6 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-black text-xs rounded-xl shadow-md flex items-center gap-1.5 disabled:opacity-50 transition-all active:translate-y-0.5"
                    >
                      {isSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                      {isSubmitting ? 'Đang Lưu...' : 'Hoàn Tất Chấm Bài'}
                    </button>
                  ) : (
                    <button
                      disabled={true}
                      className="px-6 py-2.5 bg-slate-200 text-slate-500 font-black text-xs rounded-xl cursor-not-allowed flex items-center gap-1.5 shadow-none"
                    >
                      <CheckCircle2 className="w-4 h-4 text-slate-400" />
                      {selectedSub?.status === 'graded' ? 'Đã Chấm Hoàn Tất' : 'Đã Yêu Cầu Làm Lại'}
                    </button>
                  )}
                </div>
              </>
            ) : (
              <div className="p-8 text-center text-xs font-bold text-slate-400">Chọn một bài nộp ở cột bên trái để bắt đầu chấm điểm.</div>
            )}
          </div>

        </div>

      </div>

      {/* ANNOTATION WORKBENCH MODAL (STEP C2 - DRAFT SAVE & OCC) */}
      {activeAttachmentForAnnotation && (
        <div className="fixed inset-0 z-[60] bg-slate-950/85 backdrop-blur-md flex flex-col items-center justify-center p-2 sm:p-4 overflow-hidden animate-fadeIn">
          <div className="bg-slate-900 border-2 border-slate-700 rounded-3xl w-full max-w-5xl h-[92vh] flex flex-col overflow-hidden shadow-2xl">
            
            {/* WORKBENCH HEADER */}
            <div className="flex items-center justify-between px-4 py-3 bg-slate-800/90 border-b border-slate-700 text-white shrink-0">
              <div className="flex items-center gap-2 min-w-0">
                <div className="p-1.5 bg-amber-500/20 text-amber-400 rounded-xl border border-amber-500/30">
                  <Pen className="w-4 h-4" />
                </div>
                <div className="min-w-0">
                  <h3 className="text-sm font-black truncate">
                    Chấm & Vẽ Chú Thích: {activeAttachmentForAnnotation.original_file_name || 'Ảnh bài làm'}
                  </h3>
                  <p className="text-[10px] font-bold text-slate-400">
                    {formatFileSize(activeAttachmentForAnnotation.byte_size)} • Schema v1 (OCC Version: v{annotationVersions[activeAttachmentForAnnotation.id] ?? 0})
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setActiveAttachmentForAnnotation(null)}
                className="p-1.5 bg-slate-700 hover:bg-slate-600 text-slate-200 rounded-xl transition-colors shrink-0"
                title="Đóng bảng vẽ"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* CẢNH BÁO LỖI HOẶC XUNG ĐỘT PHIÊN BẢN (NẾU CÓ) */}
            {annotationSaveError[activeAttachmentForAnnotation.id] && (
              <div className="px-4 py-2 bg-rose-950/80 border-b border-rose-800 text-rose-300 text-xs font-bold flex items-center justify-between shrink-0">
                <div className="flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
                  <span>{annotationSaveError[activeAttachmentForAnnotation.id]}</span>
                </div>
                {annotationSaveState[activeAttachmentForAnnotation.id] === 'conflict' && (
                  <button
                    type="button"
                    onClick={() => handleReloadLatest(activeAttachmentForAnnotation.id)}
                    className="px-2.5 py-1 bg-rose-600 hover:bg-rose-700 text-white rounded-lg text-[11px] font-black flex items-center gap-1 shadow-sm"
                  >
                    <RefreshCw className="w-3 h-3" /> Tải lại bản mới nhất
                  </button>
                )}
              </div>
            )}

            {/* TOOLBAR */}
            <div className="p-3 bg-slate-900 border-b border-slate-800 shrink-0">
              <AnnotationToolbar
                activeTool={activeTool}
                onSelectTool={setActiveTool}
                activeColor={activeColor}
                onSelectColor={setActiveColor}
                strokeWidth={strokeWidth}
                onSelectStrokeWidth={setStrokeWidth}
                onUndo={() => handleUndoAnnotation(activeAttachmentForAnnotation.id)}
                onRedo={() => handleRedoAnnotation(activeAttachmentForAnnotation.id)}
                onClear={() => handleClearAnnotation(activeAttachmentForAnnotation.id)}
                canUndo={
                  Boolean(
                    (annotationHistoryByAttachment[activeAttachmentForAnnotation.id]?.past?.length || 0) > 0 ||
                    annotationsByAttachment[activeAttachmentForAnnotation.id]?.strokes?.length > 0 ||
                    annotationsByAttachment[activeAttachmentForAnnotation.id]?.stamps?.length > 0 ||
                    annotationsByAttachment[activeAttachmentForAnnotation.id]?.notes?.length > 0
                  )
                }
                canRedo={
                  Boolean((annotationHistoryByAttachment[activeAttachmentForAnnotation.id]?.future?.length || 0) > 0)
                }
                readOnly={!canGrade}
                saveStatus={annotationSaveState[activeAttachmentForAnnotation.id] || 'idle'}
                version={annotationVersions[activeAttachmentForAnnotation.id] ?? 0}
                onManualSave={() => handleSaveDraft(activeAttachmentForAnnotation.id, { isManual: true })}
                onReloadLatest={() => handleReloadLatest(activeAttachmentForAnnotation.id)}
                scale={viewportScale}
                onZoomIn={handleZoomIn}
                onZoomOut={handleZoomOut}
                onResetZoom={handleResetZoom}
              />
            </div>

            {/* CANVAS DRAWING AREA */}
            <div className="flex-1 min-h-0 p-3 sm:p-4 overflow-auto flex items-center justify-center bg-slate-950">
              <div className="max-w-3xl w-full flex items-center justify-center">
                {attachmentSignedUrls[activeAttachmentForAnnotation.id] ? (
                  <SubmissionAnnotationCanvas
                    imageUrl={attachmentSignedUrls[activeAttachmentForAnnotation.id]}
                    annotation={annotationsByAttachment[activeAttachmentForAnnotation.id] || { schema_version: 1, strokes: [], stamps: [], notes: [] }}
                    onChange={(newAnn) => handleAnnotationChange(activeAttachmentForAnnotation.id, newAnn)}
                    readOnly={!canGrade}
                    activeTool={activeTool}
                    activeColor={activeColor}
                    strokeWidth={strokeWidth}
                    scale={viewportScale}
                    panX={viewportPan.x}
                    panY={viewportPan.y}
                    onViewportChange={({ scale: nextScale, panX: nextPanX, panY: nextPanY }) => {
                      setViewportScale(nextScale);
                      setViewportPan({ x: nextPanX, y: nextPanY });
                    }}
                  />
                ) : (
                  <div className="text-xs font-bold text-slate-400">Đang tải ảnh bài làm...</div>
                )}
              </div>
            </div>

            {/* WORKBENCH FOOTER */}
            <div className="px-4 py-2.5 bg-slate-800/90 border-t border-slate-700 text-slate-300 text-xs font-bold flex items-center justify-between shrink-0">
              <span className="text-[11px] text-amber-400 flex items-center gap-1">
                <Sparkles className="w-3.5 h-3.5" />
                Bản nháp tự động lưu kèm kiểm soát xung đột OCC (Step C2).
              </span>
              <button
                type="button"
                onClick={() => setActiveAttachmentForAnnotation(null)}
                className="px-4 py-1.5 bg-amber-500 hover:bg-amber-600 text-white font-black text-xs rounded-xl shadow-md transition-colors"
              >
                Xong & Quay lại
              </button>
            </div>

          </div>
        </div>
      )}

    </div>
  );
};
