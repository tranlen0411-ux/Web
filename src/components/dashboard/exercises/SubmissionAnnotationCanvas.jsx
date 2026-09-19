import React, { useRef, useState, useCallback } from 'react';

/**
 * Generate a unique ID for strokes/stamps
 */
function generateAnnotationElementId(prefix = 'el') {
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
 * SubmissionAnnotationCanvas: Native React + SVG Overlay Canvas (Step C1)
 * Coordinates are 100% normalized in [0, 1] range.
 */
export const SubmissionAnnotationCanvas = ({
  imageUrl,
  annotation = { schema_version: 1, strokes: [], stamps: [], notes: [] },
  onChange,
  readOnly = false,
  activeTool = 'pen',
  activeColor = '#ef4444',
  strokeWidth = 4
}) => {
  const containerRef = useRef(null);
  const [currentStroke, setCurrentStroke] = useState(null);
  const isPointerActiveRef = useRef(false);

  // Normalize client pointer coordinates to [0, 1]
  const getNormalizedPoint = useCallback((e) => {
    if (!containerRef.current) return { x: 0, y: 0 };
    const rect = containerRef.current.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return { x: 0, y: 0 };

    const rawX = (e.clientX - rect.left) / rect.width;
    const rawY = (e.clientY - rect.top) / rect.height;

    // Strict clamping within [0, 1]
    const x = Math.max(0, Math.min(1, rawX));
    const y = Math.max(0, Math.min(1, rawY));

    return { x, y };
  }, []);

  // POINTER DOWN
  const handlePointerDown = (e) => {
    if (readOnly) return;
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
      } catch (err) {
        // Pointer capture fallback if not supported
      }

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
    if (readOnly || !isPointerActiveRef.current || !currentStroke) return;
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

  // POINTER UP / CANCEL
  const handlePointerUp = (e) => {
    if (readOnly || !isPointerActiveRef.current || !currentStroke) {
      isPointerActiveRef.current = false;
      setCurrentStroke(null);
      return;
    }

    try {
      e.currentTarget.releasePointerCapture?.(e.pointerId);
    } catch (err) {}

    isPointerActiveRef.current = false;

    // Only commit stroke if it contains points
    if (currentStroke.points.length > 0) {
      onChange?.({
        ...annotation,
        schema_version: annotation.schema_version || 1,
        strokes: [...(annotation.strokes || []), currentStroke]
      });
    }
    setCurrentStroke(null);
  };

  const handlePointerCancel = (e) => {
    handlePointerUp(e);
  };

  // Cursor style based on active tool
  const getCursorClass = () => {
    if (readOnly) return 'cursor-default';
    if (activeTool === 'pen') return 'cursor-crosshair';
    if (activeTool === 'check' || activeTool === 'cross') return 'cursor-pointer';
    if (activeTool === 'eraser') return 'cursor-pointer';
    return 'cursor-default';
  };

  return (
    <div
      ref={containerRef}
      className={`relative inline-block w-full max-w-full rounded-2xl overflow-hidden shadow-lg border border-slate-700 bg-slate-950 select-none ${getCursorClass()}`}
      style={{ touchAction: readOnly ? 'auto' : 'none' }}
    >
      {/* 1. ẢNH GỐC BÀI NỘP CỦA HỌC SINH (BASE IMAGE) */}
      <img
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
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
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
  );
};
