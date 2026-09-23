import React, { useState, useCallback } from 'react';
import {
  Sparkles,
  RotateCcw,
  CheckCircle2,
  Smartphone,
  Eye,
  PenTool,
  ArrowRight,
  Code,
  ShieldCheck,
  AlertCircle
} from 'lucide-react';
import { SubmissionAnnotationCanvas } from '../components/dashboard/exercises/SubmissionAnnotationCanvas';
import { StudentAnnotationViewer } from '../components/dashboard/exercises/StudentAnnotationViewer';
import { AnnotationToolbar } from '../components/dashboard/exercises/AnnotationToolbar';
import { normalizeAnnotationPayload } from '../utils/annotationNoteUtils';
import { zoomIn, zoomOut, resetZoom } from '../utils/annotationViewportMath';

const SAMPLE_IMAGE_URL = '/test-fixtures/phase2-annotation-sample.svg';

const INITIAL_ANNOTATION = {
  schema_version: 1,
  strokes: [
    {
      id: 'sample_stroke_1',
      tool: 'pen',
      color: '#ef4444',
      width: 4,
      points: [
        { x: 0.15, y: 0.43 },
        { x: 0.55, y: 0.43 }
      ]
    }
  ],
  stamps: [
    {
      id: 'sample_stamp_1',
      type: 'check',
      x: 0.70,
      y: 0.22,
      size: 28
    },
    {
      id: 'sample_stamp_2',
      type: 'cross',
      x: 0.70,
      y: 0.38,
      size: 28
    }
  ],
  notes: [
    {
      id: 'sample_note_1',
      x: 0.70,
      y: 0.41,
      text: 'Bài 2c: Em tính nhầm 9 + 4 = 13 < 8 + 6 = 14 nhé!',
      color: '#f59e0b'
    }
  ]
};

export const Phase2DeviceTestHarnessPage = () => {
  // Check environment access flag: Available in local dev or via explicit Preview environment flag VITE_ENABLE_PHASE2_TEST_HARNESS
  const isEnabled = Boolean(
    import.meta.env.DEV ||
    import.meta.env.VITE_ENABLE_PHASE2_TEST_HARNESS === 'true'
  );

  if (!isEnabled) {
    return (
      <div className="min-h-[70vh] flex flex-col items-center justify-center p-6 text-center">
        <div className="w-16 h-16 rounded-full bg-rose-100 flex items-center justify-center mb-4 text-rose-600">
          <AlertCircle className="w-8 h-8" />
        </div>
        <h1 className="text-xl font-bold text-slate-800 mb-2">404 - Trang Không Tồn Tại</h1>
        <p className="text-sm text-slate-500 max-w-md">
          Môi trường thử nghiệm thiết bị nội bộ chỉ được kích hoạt trong môi trường Preview được chỉ định.
        </p>
      </div>
    );
  }

  // Active Tab: 'teacher' | 'student'
  const [activeTab, setActiveTab] = useState('teacher');
  
  // Pure In-Memory React State (Zero Supabase Calls)
  const [teacherAnnotation, setTeacherAnnotation] = useState(INITIAL_ANNOTATION);
  const [teacherHistory, setTeacherHistory] = useState({ past: [], future: [] });
  const [studentAnnotation, setStudentAnnotation] = useState(INITIAL_ANNOTATION);
  const [showJsonInspector, setShowJsonInspector] = useState(false);

  // Teacher Toolbar States
  const [activeTool, setActiveTool] = useState('pen'); // 'pen' | 'line' | 'ellipse' | 'arrow' | 'check' | 'cross' | 'note' | 'eraser' | 'pan'
  const [activeColor, setActiveColor] = useState('#ef4444');
  const [strokeWidth, setStrokeWidth] = useState(4);
  const [scale, setScale] = useState(1);
  const [panX, setPanX] = useState(0);
  const [panY, setPanY] = useState(0);

  // Handler for teacher annotation changes
  const handleTeacherAnnotationChange = useCallback((updated, { isHistoryAction = false } = {}) => {
    if (!isHistoryAction) {
      setTeacherHistory(prev => ({
        past: [...prev.past.slice(-49), JSON.parse(JSON.stringify(teacherAnnotation))],
        future: []
      }));
    }
    setTeacherAnnotation(updated);
  }, [teacherAnnotation]);

  // Undo and Redo handlers
  const handleUndo = useCallback(() => {
    if (teacherHistory.past.length > 0) {
      const prevSnapshot = teacherHistory.past[teacherHistory.past.length - 1];
      const newPast = teacherHistory.past.slice(0, -1);
      const newFuture = [...teacherHistory.future, JSON.parse(JSON.stringify(teacherAnnotation))];
      setTeacherHistory({ past: newPast, future: newFuture });
      setTeacherAnnotation(prevSnapshot);
      return;
    }

    setTeacherAnnotation(prev => {
      if (!prev) return prev;
      const strokes = [...(prev.strokes || [])];
      const stamps = [...(prev.stamps || [])];
      const notes = [...(prev.notes || [])];
      if (strokes.length > 0) {
        strokes.pop();
      } else if (stamps.length > 0) {
        stamps.pop();
      } else if (notes.length > 0) {
        notes.pop();
      }
      return { ...prev, strokes, stamps, notes };
    });
  }, [teacherHistory, teacherAnnotation]);

  const handleRedo = useCallback(() => {
    if (teacherHistory.future.length > 0) {
      const nextSnapshot = teacherHistory.future[teacherHistory.future.length - 1];
      const newFuture = teacherHistory.future.slice(0, -1);
      const newPast = [...teacherHistory.past, JSON.parse(JSON.stringify(teacherAnnotation))];
      setTeacherHistory({ past: newPast, future: newFuture });
      setTeacherAnnotation(nextSnapshot);
    }
  }, [teacherHistory, teacherAnnotation]);

  const handleClear = useCallback(() => {
    handleTeacherAnnotationChange({
      schema_version: 1,
      strokes: [],
      stamps: [],
      notes: []
    });
  }, [handleTeacherAnnotationChange]);

  const handleZoomIn = useCallback(() => {
    setScale(prev => zoomIn(prev));
  }, []);

  const handleZoomOut = useCallback(() => {
    setScale(prev => zoomOut(prev));
  }, []);

  const handleResetZoom = useCallback(() => {
    const res = resetZoom();
    setScale(res.scale);
    setPanX(res.panX);
    setPanY(res.panY);
  }, []);

  // Sync teacher edits to student view
  const handleSyncToStudent = useCallback(() => {
    setStudentAnnotation(JSON.parse(JSON.stringify(teacherAnnotation)));
  }, [teacherAnnotation]);

  // Reset fixture to clean initial state
  const handleResetFixture = useCallback(() => {
    setTeacherAnnotation(JSON.parse(JSON.stringify(INITIAL_ANNOTATION)));
    setTeacherHistory({ past: [], future: [] });
    setStudentAnnotation(JSON.parse(JSON.stringify(INITIAL_ANNOTATION)));
    setActiveTool('pen');
    setActiveColor('#ef4444');
    setStrokeWidth(4);
    const res = resetZoom();
    setScale(res.scale);
    setPanX(res.panX);
    setPanY(res.panY);
  }, []);

  return (
    <div className="max-w-5xl mx-auto px-3 sm:px-6 py-4 sm:py-8 font-sans">
      {/* 1. Header & Badge */}
      <div className="bg-gradient-to-r from-amber-600 via-orange-600 to-amber-700 rounded-3xl p-4 sm:p-6 text-white shadow-xl mb-4 sm:mb-6">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <div>
            <div className="inline-flex items-center gap-1.5 px-3 py-1 bg-white/20 backdrop-blur-md rounded-full text-[11px] font-bold text-amber-100 mb-2">
              <Smartphone className="w-3.5 h-3.5" /> PHASE 2 PHYSICAL DEVICE TEST HARNESS
            </div>
            <h1 className="text-xl sm:text-2xl font-black tracking-tight">
              Khu Vực Nghiệm Thu Cảm Ứng Di Động (PR #99)
            </h1>
            <p className="text-xs sm:text-sm text-amber-100 mt-1 max-w-2xl leading-relaxed">
              Môi trường thử nghiệm bộ nhớ đệm độc lập (100% In-Memory). Không gọi API/Database Supabase Production.
            </p>
          </div>

          <div className="flex items-center gap-2 self-stretch sm:self-auto">
            <button
              type="button"
              onClick={handleResetFixture}
              className="flex-1 sm:flex-none inline-flex items-center justify-center gap-1.5 px-3.5 py-2 bg-white/15 hover:bg-white/25 active:scale-95 text-white rounded-xl text-xs font-bold transition-all border border-white/20"
            >
              <RotateCcw className="w-3.5 h-3.5" /> Đặt lại mẫu
            </button>
          </div>
        </div>

        {/* Tab Switcher */}
        <div className="flex items-center gap-2 mt-4 pt-4 border-t border-white/20">
          <button
            type="button"
            onClick={() => setActiveTab('teacher')}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-all ${
              activeTab === 'teacher'
                ? 'bg-white text-slate-900 shadow-md scale-102'
                : 'bg-white/10 text-white hover:bg-white/20'
            }`}
          >
            <PenTool className="w-3.5 h-3.5" /> Chế độ Giáo viên chấm bài
          </button>
          <button
            type="button"
            onClick={() => {
              setActiveTab('student');
              handleSyncToStudent();
            }}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-all ${
              activeTab === 'student'
                ? 'bg-white text-slate-900 shadow-md scale-102'
                : 'bg-white/10 text-white hover:bg-white/20'
            }`}
          >
            <Eye className="w-3.5 h-3.5" /> Chế độ Học sinh xem bài chấm
          </button>
        </div>
      </div>

      {/* 2. Device Checklist Instructions Banner */}
      <div className="bg-slate-900 text-slate-100 rounded-2xl p-4 mb-4 sm:mb-6 shadow-md border border-slate-800 text-xs leading-relaxed">
        <div className="font-bold text-amber-400 mb-2 flex items-center gap-1.5 text-xs">
          <Sparkles className="w-4 h-4" /> Checklist Thử Nghiệm Trên Màn Hình Cảm Ứng (Điện Thoại / iPad):
        </div>
        {activeTab === 'teacher' ? (
          <ol className="list-decimal list-inside space-y-1.5 text-slate-300">
            <li><strong>Thanh công cụ:</strong> Chọn công cụ Bút (Pen), Thẳng (Line), Khoanh (Ellipse), Mũi tên (Arrow), Đúng (Check), Sai (Cross), Ghi chú (Note), Tẩy (Eraser), Kéo (Pan), Hoàn tác (Undo), Làm lại (Redo).</li>
            <li><strong>Pinch Zoom &amp; Nút Zoom:</strong> Dùng 2 ngón tay thu phóng hoặc bấm các nút +/- / 100% trên thanh công cụ.</li>
            <li><strong>Two-finger Pan:</strong> Dùng 2 ngón tay kéo rê vùng xem khi đang chọn công cụ vẽ.</li>
            <li><strong>Tạo Ghi Chú:</strong> Chọn công cụ <em>Ghi chú (Note)</em> -&gt; Chạm vào ảnh -&gt; Gõ tiếng Việt có dấu.</li>
            <li><strong>Chỉnh Sửa Ghi Chú:</strong> Chạm vào ghim ghi chú vừa tạo để sửa nội dung / đổi màu.</li>
            <li><strong>Xóa Ghi Chú:</strong> Xóa qua nút thùng rác trong popover hoặc dùng công cụ <em>Tẩy (Eraser)</em>.</li>
          </ol>
        ) : (
          <ol className="list-decimal list-inside space-y-1.5 text-slate-300">
            <li><strong>Xem Lời Phê:</strong> Chạm vào các ghim ghi chú màu vàng / đỏ để mở xem popover.</li>
            <li><strong>Pinch Zoom &amp; Pan:</strong> Dùng 2 ngón tay thu phóng và kéo rê xem chi tiết nét chấm bài.</li>
            <li><strong>Đặt lại 100%:</strong> Bấm nút <code>100%</code> trên thanh công cụ để đưa ảnh về vị trí ban đầu.</li>
            <li><strong>Cuộn Dọc 1 Ngón:</strong> Ở tỉ lệ 100%, vuốt 1 ngón tay lên xuống để cuộn trang bình thường.</li>
          </ol>
        )}
      </div>

      {/* 3. Main Interactive Canvas Workspace */}
      <div className="bg-white rounded-3xl p-3 sm:p-6 shadow-xl border border-slate-200">
        <div className="flex items-center justify-between mb-3 pb-3 border-b border-slate-100">
          <h2 className="text-sm sm:text-base font-bold text-slate-800 flex items-center gap-2">
            {activeTab === 'teacher' ? (
              <>
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse" />
                Phase 2 Device Test — Teacher (Giáo Viên Chấm Bài)
              </>
            ) : (
              <>
                <span className="w-2.5 h-2.5 rounded-full bg-blue-500" />
                Phase 2 Device Test — Student (Học Sinh Xem Lời Phê)
              </>
            )}
          </h2>

          {activeTab === 'teacher' && (
            <button
              type="button"
              onClick={handleSyncToStudent}
              className="inline-flex items-center gap-1 px-3 py-1.5 bg-amber-100 hover:bg-amber-200 text-amber-900 rounded-xl text-xs font-bold transition-all"
            >
              Đồng bộ sang Học sinh <ArrowRight className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {/* Render Real Phase 2 Components */}
        <div className="flex justify-center">
          {activeTab === 'teacher' ? (
            <div className="w-full max-w-3xl space-y-3">
              {/* Teacher Annotation Toolbar */}
              <div className="p-2 bg-slate-900 rounded-2xl border border-slate-800 shadow-md">
                <AnnotationToolbar
                  activeTool={activeTool}
                  onSelectTool={setActiveTool}
                  activeColor={activeColor}
                  onSelectColor={setActiveColor}
                  strokeWidth={strokeWidth}
                  onSelectStrokeWidth={setStrokeWidth}
                  onUndo={handleUndo}
                  onRedo={handleRedo}
                  onClear={handleClear}
                  canUndo={Boolean(
                    teacherHistory.past.length > 0 ||
                    teacherAnnotation?.strokes?.length > 0 ||
                    teacherAnnotation?.stamps?.length > 0 ||
                    teacherAnnotation?.notes?.length > 0
                  )}
                  canRedo={Boolean(teacherHistory.future.length > 0)}
                  readOnly={false}
                  scale={scale}
                  onZoomIn={handleZoomIn}
                  onZoomOut={handleZoomOut}
                  onResetZoom={handleResetZoom}
                />
              </div>

              {/* Teacher Canvas Area */}
              <div className="bg-slate-950 p-2 sm:p-4 rounded-2xl border border-slate-800 flex justify-center items-center">
                <SubmissionAnnotationCanvas
                  imageUrl={SAMPLE_IMAGE_URL}
                  annotation={teacherAnnotation}
                  onChange={handleTeacherAnnotationChange}
                  readOnly={false}
                  activeTool={activeTool}
                  activeColor={activeColor}
                  strokeWidth={strokeWidth}
                  scale={scale}
                  panX={panX}
                  panY={panY}
                  onViewportChange={({ scale: nextScale, panX: nextPanX, panY: nextPanY }) => {
                    if (typeof nextScale === 'number') setScale(nextScale);
                    if (typeof nextPanX === 'number') setPanX(nextPanX);
                    if (typeof nextPanY === 'number') setPanY(nextPanY);
                  }}
                />
              </div>
            </div>
          ) : (
            <div className="w-full max-w-3xl">
              <StudentAnnotationViewer
                imageUrl={SAMPLE_IMAGE_URL}
                annotation={studentAnnotation}
              />
            </div>
          )}
        </div>
      </div>

      {/* 4. State Inspector & Zero-Backend Assurance */}
      <div className="mt-4 sm:mt-6 bg-slate-50 rounded-2xl p-3 sm:p-4 border border-slate-200 text-xs">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-slate-600 font-semibold">
            <ShieldCheck className="w-4 h-4 text-emerald-600" />
            <span>Zero Backend Mutation: 100% In-Memory State</span>
          </div>

          <button
            type="button"
            onClick={() => setShowJsonInspector(!showJsonInspector)}
            className="inline-flex items-center gap-1 text-slate-500 hover:text-slate-800 font-bold"
          >
            <Code className="w-3.5 h-3.5" /> {showJsonInspector ? 'Ẩn' : 'Xem'} JSON Payload
          </button>
        </div>

        {showJsonInspector && (
          <div className="mt-3 p-3 bg-slate-900 text-emerald-400 rounded-xl font-mono text-[11px] overflow-x-auto max-h-60">
            <pre>
              {JSON.stringify(
                normalizeAnnotationPayload(
                  activeTab === 'teacher' ? teacherAnnotation : studentAnnotation
                ),
                null,
                2
              )}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
};
