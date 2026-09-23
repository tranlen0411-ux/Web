import React, { useRef, useState, useCallback, useEffect } from 'react';
import { ZoomIn, ZoomOut, RotateCcw, StickyNote, X } from 'lucide-react';
import {
  zoomIn,
  zoomOut,
  resetZoom,
  clampScale,
  clampPan,
  calculateDistance,
  calculateMidpoint,
  calculatePinchTransform,
  MIN_SCALE,
  MAX_SCALE,
} from '../../../utils/annotationViewportMath';
import {
  normalizeAnnotationPayload,
  DEFAULT_NOTE_COLOR,
} from '../../../utils/annotationNoteUtils';
import { renderSvgAnnotationStroke } from './SubmissionAnnotationCanvas';

/**
 * Convert normalized points array (0..1) to SVG Path d string (0..1000 viewBox)
 */
function pointsToSvgPath(points) {
  if (!points || points.length === 0) return '';
  if (points.length === 1) {
    const p = points[0];
    const px = p.x * 1000;
    const py = p.y * 1000;
    return `M ${px} ${py} L ${px + 0.1} ${py + 0.1}`;
  }

  let d = `M ${points[0].x * 1000} ${points[0].y * 1000}`;
  for (let i = 1; i < points.length; i++) {
    const p = points[i];
    d += ` L ${p.x * 1000} ${p.y * 1000}`;
  }
  return d;
}

/**
 * StudentAnnotationViewer: Dedicated Read-Only Canvas for Graded Submission Viewer (Phase 2 - P2-C1)
 * 
 * Features:
 * - 100% Read-Only rendering of strokes, stamps, and teacher notes.
 * - Zoom in/out/reset controls with percentage display.
 * - Single shared transform layer (Image, SVG annotations, Note pins).
 * - Safe mobile scroll contract (touch-action: pan-y at 100% scale).
 * - Multi-touch pinch zoom & two-finger pan.
 * - Read-only accessible note popover (no edit/delete/save UI).
 * - Zero mutation paths (no onChange or backend RPC reachable).
 */
export const StudentAnnotationViewer = ({
  imageUrl,
  annotation,
}) => {
  const viewportRef = useRef(null);
  const contentRef = useRef(null);
  const lastActivePinRef = useRef(null);

  // Defensively normalize incoming annotation payload
  const safePayload = normalizeAnnotationPayload(annotation);
  const { strokes, stamps, notes } = safePayload;

  // Viewport Zoom & Pan state
  const [scale, setScale] = useState(1);
  const [rawPan, setRawPan] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);

  // Active Read-Only Note Popover state
  const [activeNote, setActiveNote] = useState(null);

  // Pan dragging & Touch Gesture tracking refs
  const isPanningRef = useRef(false);
  const panStartRef = useRef(null);
  const activePointersRef = useRef(new Map());
  const pinchGestureRef = useRef(null);

  // Clamped Pan calculations
  const { panX, panY } = clampPan({
    viewportWidth: viewportRef.current?.offsetWidth || 0,
    viewportHeight: viewportRef.current?.offsetHeight || 0,
    baseWidth: contentRef.current?.offsetWidth || 0,
    baseHeight: contentRef.current?.offsetHeight || 0,
    scale,
    panX: rawPan.x,
    panY: rawPan.y,
  });

  // Calculate Popover screen position inside Viewport boundaries
  const calculatePopoverPosition = useCallback((clientX, clientY) => {
    const rect = viewportRef.current?.getBoundingClientRect();
    const clickX = clientX - (rect?.left || 0);
    const clickY = clientY - (rect?.top || 0);
    const vpWidth = rect?.width || 800;
    const vpHeight = rect?.height || 600;

    const popoverWidth = 280;
    const popoverHeight = 160;
    let left = clickX - (popoverWidth / 2);
    let top = clickY + 16;

    if (left < 10) left = 10;
    if (left + popoverWidth > vpWidth - 10) left = vpWidth - popoverWidth - 10;
    if (top + popoverHeight > vpHeight - 10) top = Math.max(10, clickY - popoverHeight - 16);

    return {
      left: `${left}px`,
      top: `${top}px`,
    };
  }, []);

  // Zoom Handlers
  const handleZoomIn = () => {
    setScale(prev => {
      const next = zoomIn(prev);
      if (next <= 1) setRawPan({ x: 0, y: 0 });
      return next;
    });
  };

  const handleZoomOut = () => {
    setScale(prev => {
      const next = zoomOut(prev);
      if (next <= 1) setRawPan({ x: 0, y: 0 });
      return next;
    });
  };

  const handleResetZoom = () => {
    const reset = resetZoom();
    setScale(reset.scale);
    setRawPan({ x: reset.panX, y: reset.panY });
  };

  // Note Interaction Handlers (Read-Only)
  const handleOpenNote = (note, index, e) => {
    e.stopPropagation();
    e.preventDefault();
    lastActivePinRef.current = e.currentTarget;
    const pos = calculatePopoverPosition(e.clientX, e.clientY);
    setActiveNote({
      ...note,
      index,
      positionStyle: pos,
    });
  };

  const handleCloseNote = () => {
    setActiveNote(null);
    if (lastActivePinRef.current) {
      lastActivePinRef.current.focus?.();
    }
  };

  // Close note on Escape key
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape' && activeNote) {
        e.stopPropagation();
        handleCloseNote();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeNote]);

  // Pointer Down (Pan & Multi-touch Pinch)
  const handlePointerDown = (e) => {
    activePointersRef.current.set(e.pointerId, {
      clientX: e.clientX,
      clientY: e.clientY,
      pointerType: e.pointerType,
    });

    // Two-finger Pinch arrival
    if (activePointersRef.current.size >= 2) {
      isPanningRef.current = false;
      setIsDragging(false);

      const pointers = Array.from(activePointersRef.current.values());
      const ids = Array.from(activePointersRef.current.keys());
      const p1 = pointers[0];
      const p2 = pointers[1];
      const initialDistance = calculateDistance(p1, p2);
      const initialMidpoint = calculateMidpoint(p1, p2);

      pinchGestureRef.current = {
        initialDistance,
        initialMidpoint,
        initialScale: scale,
        initialPan: { x: panX, y: panY },
        pointerIds: [ids[0], ids[1]],
      };
      return;
    }

    // Single pointer pan when scale > 1
    if (scale > 1) {
      try {
        e.currentTarget.setPointerCapture?.(e.pointerId);
      } catch (err) {}
      isPanningRef.current = true;
      panStartRef.current = {
        clientX: e.clientX,
        clientY: e.clientY,
        startPanX: panX,
        startPanY: panY,
      };
      setIsDragging(true);
    }
  };

  // Pointer Move
  const handlePointerMove = (e) => {
    if (activePointersRef.current.has(e.pointerId)) {
      activePointersRef.current.set(e.pointerId, {
        clientX: e.clientX,
        clientY: e.clientY,
        pointerType: e.pointerType,
      });
    }

    // Two-finger Pinch & Pan
    if (activePointersRef.current.size >= 2 && pinchGestureRef.current) {
      const pointers = Array.from(activePointersRef.current.values());
      const p1 = pointers[0];
      const p2 = pointers[1];

      const viewportRect = viewportRef.current?.getBoundingClientRect();
      const baseWidth = contentRef.current?.offsetWidth || viewportRect?.width || 0;
      const baseHeight = contentRef.current?.offsetHeight || viewportRect?.height || 0;

      if (viewportRect && baseWidth > 0 && baseHeight > 0) {
        const nextTransform = calculatePinchTransform({
          initialDistance: pinchGestureRef.current.initialDistance,
          initialMidpoint: pinchGestureRef.current.initialMidpoint,
          initialScale: pinchGestureRef.current.initialScale,
          initialPan: pinchGestureRef.current.initialPan,
          currentP1: p1,
          currentP2: p2,
          viewportRect,
          baseWidth,
          baseHeight,
        });

        setScale(nextTransform.scale);
        setRawPan({ x: nextTransform.panX, y: nextTransform.panY });
      }
      return;
    }

    // Single pointer pan dragging when scale > 1
    if (scale > 1 && isPanningRef.current && panStartRef.current) {
      const dx = e.clientX - panStartRef.current.clientX;
      const dy = e.clientY - panStartRef.current.clientY;
      const proposedPanX = panStartRef.current.startPanX + dx;
      const proposedPanY = panStartRef.current.startPanY + dy;

      const clamped = clampPan({
        viewportWidth: viewportRef.current?.offsetWidth || 0,
        viewportHeight: viewportRef.current?.offsetHeight || 0,
        baseWidth: contentRef.current?.offsetWidth || 0,
        baseHeight: contentRef.current?.offsetHeight || 0,
        scale,
        panX: proposedPanX,
        panY: proposedPanY,
      });

      setRawPan({ x: clamped.panX, y: clamped.panY });
    }
  };

  // Pointer Up / Cancel / Lost Capture
  const handlePointerUp = (e) => {
    activePointersRef.current.delete(e.pointerId);

    if (activePointersRef.current.size < 2) {
      pinchGestureRef.current = null;
    }

    if (activePointersRef.current.size === 0) {
      if (isPanningRef.current) {
        try {
          e.currentTarget.releasePointerCapture?.(e.pointerId);
        } catch (err) {}
        isPanningRef.current = false;
        panStartRef.current = null;
        setIsDragging(false);
      }
    }
  };

  const getCursorClass = () => {
    if (scale > 1) return isDragging ? 'cursor-grabbing' : 'cursor-grab';
    return 'cursor-default';
  };

  return (
    <div className="relative flex flex-col w-full rounded-2xl overflow-hidden shadow-md border border-slate-200 bg-slate-950">
      {/* 1. STUDENT ZOOM CONTROLS TOOLBAR */}
      <div className="flex items-center justify-between px-3 py-2 bg-slate-900/90 backdrop-blur-md border-b border-slate-800 text-white z-10 select-none">
        <div className="flex items-center gap-1.5 text-xs text-slate-300 font-bold">
          <span className="text-[11px] text-slate-400">Xem bài chấm</span>
          {notes.length > 0 && (
            <span className="px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-400 text-[10px] font-bold border border-amber-500/30 flex items-center gap-1">
              <StickyNote className="w-3 h-3" /> {notes.length} ghi chú
            </span>
          )}
        </div>

        {/* Zoom Button Group */}
        <div className="flex items-center gap-1 bg-slate-950 p-1 rounded-xl border border-slate-800">
          <button
            type="button"
            onClick={handleZoomOut}
            disabled={scale <= MIN_SCALE}
            aria-label="Thu nhỏ"
            className="p-1 rounded-lg text-slate-300 hover:text-white hover:bg-slate-800 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            <ZoomOut className="w-3.5 h-3.5" />
          </button>

          <span
            className="text-[11px] font-mono font-bold text-slate-200 min-w-[36px] text-center"
            aria-label={`Tỉ lệ phóng to ${Math.round(scale * 100)}%`}
          >
            {Math.round(scale * 100)}%
          </span>

          <button
            type="button"
            onClick={handleZoomIn}
            disabled={scale >= MAX_SCALE}
            aria-label="Phóng to"
            className="p-1 rounded-lg text-slate-300 hover:text-white hover:bg-slate-800 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            <ZoomIn className="w-3.5 h-3.5" />
          </button>

          <div className="w-px h-3.5 bg-slate-800 mx-0.5" />

          <button
            type="button"
            onClick={handleResetZoom}
            disabled={scale === 1 && panX === 0 && panY === 0}
            aria-label="Đặt lại 100%"
            className="px-2 py-0.5 text-[10px] font-bold rounded-lg text-slate-300 hover:text-white hover:bg-slate-800 disabled:opacity-30 disabled:cursor-not-allowed transition-colors flex items-center gap-1"
          >
            <RotateCcw className="w-3 h-3" /> 100%
          </button>
        </div>
      </div>

      {/* 2. VIEWPORT CONTAINER */}
      <div
        ref={viewportRef}
        className={`relative w-full overflow-hidden select-none ${getCursorClass()}`}
        style={{
          // Mobile safe scroll contract: allow natural vertical scroll when at 1x scale
          touchAction: scale === 1 ? 'pan-y' : 'none',
        }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onLostPointerCapture={handlePointerUp}
      >
        {/* SINGLE SHARED CONTENT TRANSFORM WRAPPER */}
        <div
          ref={contentRef}
          style={{
            transform: `translate(${panX}px, ${panY}px) scale(${scale})`,
            transformOrigin: '0 0',
            width: '100%',
            position: 'relative',
          }}
        >
          {/* Base Image */}
          <img
            src={imageUrl}
            alt="Bài làm học sinh"
            className="w-full h-auto block select-none pointer-events-none"
            draggable={false}
          />

          {/* SVG Overlay (Strokes: Pen, Line, Ellipse, Arrow) */}
          <svg
            className="absolute inset-0 w-full h-full select-none pointer-events-none"
            viewBox="0 0 1000 1000"
            preserveAspectRatio="none"
          >
            {strokes.map((stroke) => renderSvgAnnotationStroke(stroke, false))}
          </svg>

          {/* Stamps Overlay */}
          {stamps.map((stamp) => {
            const isCheck = stamp.type === 'check';
            return (
              <div
                key={stamp.id}
                style={{
                  position: 'absolute',
                  left: `${stamp.x * 100}%`,
                  top: `${stamp.y * 100}%`,
                  transform: 'translate(-50%, -50%)',
                  pointerEvents: 'none',
                }}
                className="select-none"
              >
                <div
                  className={`w-7 h-7 sm:w-8 sm:h-8 rounded-full flex items-center justify-center shadow-lg border-2 border-white ${
                    isCheck ? 'bg-emerald-500 text-white' : 'bg-rose-500 text-white'
                  }`}
                >
                  {isCheck ? (
                    <svg className="w-4 h-4 sm:w-5 sm:h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  ) : (
                    <svg className="w-4 h-4 sm:w-5 sm:h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
                      <line x1="18" y1="6" x2="6" y2="18" />
                      <line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                  )}
                </div>
              </div>
            );
          })}

          {/* Read-Only Note Pins Overlay */}
          {notes.map((note, index) => (
            <button
              key={note.id || `note_${index}`}
              type="button"
              data-testid={`student-note-pin-${note.id}`}
              style={{
                position: 'absolute',
                left: `${note.x * 100}%`,
                top: `${note.y * 100}%`,
                transform: 'translate(-50%, -100%)',
                pointerEvents: 'auto',
              }}
              className="group select-none cursor-pointer z-20 p-1 -m-1 focus:outline-none focus:ring-2 focus:ring-amber-400 focus:ring-offset-2 focus:ring-offset-slate-900 rounded-full"
              aria-label={`Xem ghi chú #${index + 1} của giáo viên`}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => handleOpenNote(note, index, e)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  handleOpenNote(note, index, e);
                }
              }}
            >
              {/* Note Pin Head */}
              <div
                className="flex items-center justify-center w-6 h-6 sm:w-7 sm:h-7 rounded-full shadow-lg border-2 border-white transition-transform group-hover:scale-125"
                style={{ backgroundColor: note.color || DEFAULT_NOTE_COLOR }}
              >
                <StickyNote className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-white" />
              </div>

              {/* Hover Tooltip Preview */}
              <div className="absolute left-1/2 -translate-x-1/2 bottom-full mb-1.5 hidden group-hover:block w-48 sm:w-56 p-2.5 rounded-xl bg-slate-900/95 backdrop-blur-md border border-slate-700 shadow-2xl text-white text-[11px] leading-relaxed break-words z-30 pointer-events-none animate-in fade-in zoom-in-95">
                <div className="font-bold text-[10px] text-amber-400 mb-0.5">
                  Ghi chú #{index + 1} của Giáo viên
                </div>
                <p className="whitespace-pre-wrap text-slate-200">{note.text}</p>
              </div>
            </button>
          ))}
        </div>

        {/* 3. READ-ONLY NOTE POPOVER (NO EDIT / DELETE / SAVE UI) */}
        {activeNote && (
          <div
            className="absolute z-30 w-72 sm:w-80 rounded-xl bg-slate-900/95 backdrop-blur-md border border-slate-700 shadow-2xl p-3.5 text-slate-100 animate-in fade-in zoom-in-95 duration-150 select-none"
            style={{
              ...activeNote.positionStyle,
            }}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Popover Header */}
            <div className="flex items-center justify-between pb-2 mb-2 border-b border-slate-800">
              <div className="flex items-center gap-1.5 font-bold text-xs text-amber-400">
                <div
                  className="w-2.5 h-2.5 rounded-full"
                  style={{ backgroundColor: activeNote.color || DEFAULT_NOTE_COLOR }}
                />
                <span>Ghi chú #{activeNote.index + 1} của Giáo viên</span>
              </div>
              <button
                type="button"
                onClick={handleCloseNote}
                aria-label="Đóng ghi chú"
                className="p-1 text-slate-400 hover:text-slate-200 hover:bg-slate-800 rounded-lg transition-colors"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>

            {/* Popover Body (Plain text only, zero XSS vulnerability) */}
            <div className="py-1">
              <p className="text-xs font-medium text-slate-100 whitespace-pre-wrap leading-relaxed">
                {activeNote.text}
              </p>
            </div>

            {/* Popover Footer */}
            <div className="flex items-center justify-between mt-2 pt-2 border-t border-slate-800/80 text-[10px] text-slate-400">
              <span>Nhận xét cho học sinh</span>
              <button
                type="button"
                onClick={handleCloseNote}
                className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-md font-semibold transition-colors"
              >
                Đóng (Esc)
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
