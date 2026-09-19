import React, { useRef, useState, useCallback } from 'react';
import {
  screenToNormalized,
  clampScale,
  clampPan,
  calculateDistance,
  calculateMidpoint,
  calculatePinchTransform,
  MIN_SCALE,
  MAX_SCALE,
} from '../../../utils/annotationViewportMath';

/**
 * Generate a unique ID for strokes/stamps (UUID contract conformant)
 */
function generateAnnotationElementId(prefix = 'el') {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}_${crypto.randomUUID()}`;
  }
  return `${prefix}_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
}

/**
 * Convert normalized points array (0..1) to SVG Path d string
 * Uses 0..1000 SVG coordinate system
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
 * Check if a point (px, py) is near a stroke (bounding box or distance check)
 */
function isPointNearStroke(stroke, x, y, threshold = 0.04) {
  if (!stroke.points || stroke.points.length === 0) return false;
  return stroke.points.some(p => {
    const dx = p.x - x;
    const dy = p.y - y;
    return Math.sqrt(dx * dx + dy * dy) < threshold;
  });
}

/**
 * Check if a point (x, y) is near a stamp
 */
function isPointNearStamp(stamp, x, y, threshold = 0.04) {
  const dx = stamp.x - x;
  const dy = stamp.y - y;
  return Math.sqrt(dx * dx + dy * dy) < threshold;
}

/**
 * SubmissionAnnotationCanvas: Native React + SVG Overlay Canvas (Phase 2 - P2-A2.1 Multi-touch & Pinch Zoom)
 * Coordinates are 100% normalized in [0, 1] range.
 * Supports Single Shared Transform Layer, Desktop Mouse Pan Dragging, and Mobile Pinch Zoom / Pan.
 */
export const SubmissionAnnotationCanvas = ({
  imageUrl,
  annotation = { schema_version: 1, strokes: [], stamps: [], notes: [] },
  onChange,
  readOnly = false,
  activeTool = 'pen',
  activeColor = '#ef4444',
  strokeWidth = 4,
  // Viewport Zoom/Pan props (P2-A2 controlled or fallback state)
  scale: externalScale,
  panX: externalPanX,
  panY: externalPanY,
  onViewportChange,
}) => {
  const viewportRef = useRef(null);
  const contentRef = useRef(null);
  const imageRef = useRef(null);
  const [currentStroke, setCurrentStroke] = useState(null);
  const isPointerActiveRef = useRef(false);

  // Desktop Mouse Pan dragging state & refs
  const [isDragging, setIsDragging] = useState(false);
  const isPanningRef = useRef(false);
  const panStartRef = useRef(null);

  // Multi-pointer & Pinch Gesture Tracking (P2-A2.1)
  const activePointersRef = useRef(new Map());
  const pinchGestureRef = useRef(null);
  const suppressSinglePointerDrawRef = useRef(false);

  // Local Viewport State (fallback if not controlled externally)
  const [internalScale, setInternalScale] = useState(1);
  const [internalPan, setInternalPan] = useState({ x: 0, y: 0 });

  const rawScale = externalScale !== undefined ? externalScale : internalScale;
  const scale = clampScale(rawScale);
  const rawPanX = externalPanX !== undefined ? externalPanX : internalPan.x;
  const rawPanY = externalPanY !== undefined ? externalPanY : internalPan.y;

  // Clamped Pan
  const { panX, panY } = clampPan({
    viewportWidth: viewportRef.current?.offsetWidth || 0,
    viewportHeight: viewportRef.current?.offsetHeight || 0,
    baseWidth: contentRef.current?.offsetWidth || 0,
    baseHeight: contentRef.current?.offsetHeight || 0,
    scale,
    panX: rawPanX,
    panY: rawPanY,
  });

  // Normalize client pointer coordinates to [0, 1] using Viewport-Anchored Affine Inverse
  // Relative offset: clientX - rect.left, clientY - rect.top -> Math.max(0, Math.min(1, normalized))
  const getNormalizedPoint = useCallback((e) => {
    if (!viewportRef.current || !contentRef.current) return { x: 0, y: 0 };
    const rect = viewportRef.current.getBoundingClientRect();
    const baseWidth = contentRef.current.offsetWidth || rect.width;
    const baseHeight = contentRef.current.offsetHeight || rect.height;

    return screenToNormalized({
      clientX: e.clientX,
      clientY: e.clientY,
      viewportRect: rect,
      baseWidth,
      baseHeight,
      scale,
      panX,
      panY,
    });
  }, [scale, panX, panY]);

  // POINTER DOWN
  const handlePointerDown = (e) => {
    if (readOnly) return;

    // Track active pointer ID
    activePointersRef.current.set(e.pointerId, {
      clientX: e.clientX,
      clientY: e.clientY,
      pointerType: e.pointerType
    });

    // MULTI-POINTER ARRIVAL: Cancel in-progress drawing immediately and start Pinch
    if (activePointersRef.current.size >= 2) {
      // 1. Cancel in-progress stroke without committing
      setCurrentStroke(null);
      isPointerActiveRef.current = false;
      suppressSinglePointerDrawRef.current = true;
      isPanningRef.current = false;
      setIsDragging(false);

      // 2. Initialize pinch state
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

    // SINGLE POINTER HANDLING (only if not in post-pinch suppression cooldown)
    if (suppressSinglePointerDrawRef.current) {
      return;
    }

    // 0. PAN TOOL (MOUSE / TOUCH DRAG PAN)
    if (activeTool === 'pan') {
      try {
        e.currentTarget.setPointerCapture?.(e.pointerId);
      } catch (err) {}
      isPanningRef.current = true;
      panStartRef.current = {
        clientX: e.clientX,
        clientY: e.clientY,
        startPanX: panX,
        startPanY: panY
      };
      setIsDragging(true);
      return;
    }

    const { x, y } = getNormalizedPoint(e);

    // 1. ERASER TOOL
    if (activeTool === 'eraser') {
      const strokes = annotation.strokes || [];
      const stamps = annotation.stamps || [];

      // Check if clicked near any stroke or stamp to remove
      const strokeIdx = strokes.findIndex(s => isPointNearStroke(s, x, y));
      if (strokeIdx !== -1) {
        const nextStrokes = [...strokes];
        nextStrokes.splice(strokeIdx, 1);
        onChange?.({
          ...annotation,
          strokes: nextStrokes
        });
        return;
      }

      const stampIdx = stamps.findIndex(st => isPointNearStamp(st, x, y));
      if (stampIdx !== -1) {
        const nextStamps = [...stamps];
        nextStamps.splice(stampIdx, 1);
        onChange?.({
          ...annotation,
          stamps: nextStamps
        });
        return;
      }
      return;
    }

    // 2. STAMP TOOLS (CHECK / CROSS)
    if (activeTool === 'check' || activeTool === 'cross') {
      const newStamp = {
        id: generateAnnotationElementId('stamp'),
        type: activeTool,
        x,
        y,
        size: 28
      };
      onChange?.({
        ...annotation,
        stamps: [...(annotation.stamps || []), newStamp]
      });
      return;
    }

    // 3. PEN TOOL
    if (activeTool === 'pen') {
      try {
        e.currentTarget.setPointerCapture?.(e.pointerId);
      } catch (err) {}

      isPointerActiveRef.current = true;
      setCurrentStroke({
        id: generateAnnotationElementId('stroke'),
        tool: 'pen',
        color: activeColor,
        width: strokeWidth,
        points: [{ x, y }]
      });
    }
  };

  // POINTER MOVE
  const handlePointerMove = (e) => {
    if (readOnly) return;

    // Update active pointer position
    if (activePointersRef.current.has(e.pointerId)) {
      activePointersRef.current.set(e.pointerId, {
        clientX: e.clientX,
        clientY: e.clientY,
        pointerType: e.pointerType
      });
    }

    // TWO-FINGER PINCH / PAN GESTURE
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

        if (onViewportChange) {
          onViewportChange(nextTransform);
        } else {
          setInternalScale(nextTransform.scale);
          setInternalPan({ x: nextTransform.panX, y: nextTransform.panY });
        }
      }
      return;
    }

    // SINGLE POINTER PAN TOOL DRAGGING
    if (activeTool === 'pan' && isPanningRef.current && panStartRef.current) {
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

      if (onViewportChange) {
        onViewportChange({ scale, panX: clamped.panX, panY: clamped.panY });
      } else {
        setInternalPan({ x: clamped.panX, y: clamped.panY });
      }
      return;
    }

    // SINGLE POINTER DRAWING
    if (!isPointerActiveRef.current || !currentStroke || suppressSinglePointerDrawRef.current) return;
    const { x, y } = getNormalizedPoint(e);

    // Filter duplicate or jitter points
    const lastPoint = currentStroke.points[currentStroke.points.length - 1];
    if (lastPoint) {
      const dist = Math.hypot(lastPoint.x - x, lastPoint.y - y);
      if (dist < 0.001) return; // Ignore microscopic jitter
    }

    setCurrentStroke(prev => prev ? {
      ...prev,
      points: [...prev.points, { x, y }]
    } : null);
  };

  // POINTER UP / CANCEL / LOST CAPTURE
  const handlePointerUp = (e) => {
    if (readOnly) return;

    // Remove pointer from tracking
    activePointersRef.current.delete(e.pointerId);

    // If pointers drop below 2, clear pinch gesture
    if (activePointersRef.current.size < 2) {
      pinchGestureRef.current = null;
    }

    // When all fingers leave the screen, reset suppression and pan dragging
    if (activePointersRef.current.size === 0) {
      suppressSinglePointerDrawRef.current = false;
      if (isPanningRef.current) {
        try {
          e.currentTarget.releasePointerCapture?.(e.pointerId);
        } catch (err) {}
        isPanningRef.current = false;
        panStartRef.current = null;
        setIsDragging(false);
      }
    }

    // Commit single-pointer drawing only if active and not suppressed
    if (isPointerActiveRef.current && currentStroke && !suppressSinglePointerDrawRef.current) {
      try {
        e.currentTarget.releasePointerCapture?.(e.pointerId);
      } catch (err) {}

      isPointerActiveRef.current = false;

      if (currentStroke.points.length > 0) {
        onChange?.({
          ...annotation,
          schema_version: annotation.schema_version || 1,
          strokes: [...(annotation.strokes || []), currentStroke]
        });
      }
      setCurrentStroke(null);
    } else {
      isPointerActiveRef.current = false;
      setCurrentStroke(null);
    }
  };

  const handlePointerCancel = (e) => {
    handlePointerUp(e);
  };

  const handleLostPointerCapture = (e) => {
    handlePointerUp(e);
  };

  // Cursor style based on active tool
  const getCursorClass = () => {
    if (readOnly) return 'cursor-default';
    if (activeTool === 'pan') return isDragging ? 'cursor-grabbing' : 'cursor-grab';
    if (activeTool === 'pen') return 'cursor-crosshair';
    if (activeTool === 'check' || activeTool === 'cross') return 'cursor-pointer';
    if (activeTool === 'eraser') return 'cursor-pointer';
    return 'cursor-default';
  };

  return (
    <div
      ref={viewportRef}
      className={`relative inline-block w-full max-w-full rounded-2xl overflow-hidden shadow-lg border border-slate-700 bg-slate-950 select-none ${getCursorClass()}`}
      style={{ touchAction: readOnly ? 'auto' : 'none' }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
      onLostPointerCapture={handleLostPointerCapture}
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
        {/* 1. ẢNH GỐC BÀI NỘP CỦA HỌC SINH (BASE IMAGE) */}
        <img
          ref={imageRef}
          src={imageUrl}
          alt="Bài làm học sinh"
          className="w-full h-auto block select-none pointer-events-none"
          draggable={false}
        />

        {/* 2. SVG OVERLAY VẼ CHÚ THÍCH (1000x1000 NORMALIZED VIEWBOX) */}
        <svg
          className={`absolute inset-0 w-full h-full select-none ${readOnly ? 'pointer-events-none' : 'touch-none pointer-events-auto'}`}
          viewBox="0 0 1000 1000"
          preserveAspectRatio="none"
        >
          {/* NÉT VẼ ĐÃ LƯU (COMMITTED STROKES) */}
          {(annotation.strokes || []).map((stroke) => (
            <path
              key={stroke.id}
              d={pointsToSvgPath(stroke.points)}
              stroke={stroke.color || '#ef4444'}
              strokeWidth={(stroke.width || 4) * 2.2}
              vectorEffect="non-scaling-stroke"
              fill="none"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="transition-opacity hover:opacity-80"
            />
          ))}

          {/* NÉT VẼ ĐANG VẼ DỞ (CURRENT DRAWING STROKE) */}
          {currentStroke && (
            <path
              d={pointsToSvgPath(currentStroke.points)}
              stroke={currentStroke.color || '#ef4444'}
              strokeWidth={(currentStroke.width || 4) * 2.2}
              vectorEffect="non-scaling-stroke"
              fill="none"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          )}
        </svg>

        {/* 3. CON DẤU ĐÚNG / SAI (ASPECT-RATIO SAFE STAMPS OVERLAY) */}
        {(annotation.stamps || []).map((stamp) => {
          const isCheck = stamp.type === 'check';

          return (
            <div
              key={stamp.id}
              style={{
                position: 'absolute',
                left: `${stamp.x * 100}%`,
                top: `${stamp.y * 100}%`,
                transform: 'translate(-50%, -50%)',
                pointerEvents: 'none'
              }}
              className="transition-transform select-none"
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
      </div>
    </div>
  );
};
