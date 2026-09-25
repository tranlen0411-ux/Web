import React, { useRef, useState, useCallback } from 'react';
import { StickyNote } from 'lucide-react';
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
import { AnnotationNotePopover } from './AnnotationNotePopover';
import {
  generateNoteId,
  normalizeNote,
  updateNoteInList,
  removeNoteFromList,
  MAX_NOTES_COUNT,
  DEFAULT_NOTE_COLOR,
} from '../../../utils/annotationNoteUtils';

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
 * Check distance from point (px, py) to line segment (x1, y1)-(x2, y2)
 */
function distToSegment(px, py, x1, y1, x2, y2) {
  const l2 = (x2 - x1) * (x2 - x1) + (y2 - y1) * (y2 - y1);
  if (l2 === 0) return Math.hypot(px - x1, py - y1);
  let t = ((px - x1) * (x2 - x1) + (py - y1) * (y2 - y1)) / l2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (x1 + t * (x2 - x1)), py - (y1 + t * (y2 - y1)));
}

/**
 * Check if a point (px, py) is near a stroke (pen, line, ellipse, arrow)
 */
function isPointNearStroke(stroke, x, y, threshold = 0.04) {
  const tool = stroke.tool || 'pen';

  if (tool === 'pen') {
    if (!stroke.points || stroke.points.length === 0) return false;
    if (stroke.points.some(p => Math.hypot(p.x - x, p.y - y) < threshold)) return true;
    for (let i = 0; i < stroke.points.length - 1; i++) {
      const pA = stroke.points[i];
      const pB = stroke.points[i + 1];
      if (distToSegment(x, y, pA.x, pA.y, pB.x, pB.y) < threshold) return true;
    }
    return false;
  }

  const points = stroke.points || [];
  if (points.length < 2) {
    if (stroke.startPoint && stroke.endPoint) {
      // Use explicit start/end points
    } else if (points.length === 1) {
      return Math.hypot(points[0].x - x, points[0].y - y) < threshold;
    } else {
      return false;
    }
  }

  const p1 = stroke.startPoint || points[0];
  const p2 = stroke.endPoint || points[points.length - 1];

  if (tool === 'line') {
    return distToSegment(x, y, p1.x, p1.y, p2.x, p2.y) < threshold;
  }

  if (tool === 'arrow') {
    const shaftHit = distToSegment(x, y, p1.x, p1.y, p2.x, p2.y) < threshold;
    const tipHit = Math.hypot(x - p2.x, y - p2.y) < threshold * 1.5;
    return shaftHit || tipHit;
  }

  if (tool === 'ellipse') {
    const cx = (p1.x + p2.x) / 2;
    const cy = (p1.y + p2.y) / 2;
    const rx = Math.abs(p2.x - p1.x) / 2;
    const ry = Math.abs(p2.y - p1.y) / 2;

    if (rx < 0.01 && ry < 0.01) {
      return Math.hypot(x - cx, y - cy) < threshold;
    }

    const safeRx = Math.max(rx, 0.001);
    const safeRy = Math.max(ry, 0.001);
    const dx = (x - cx) / safeRx;
    const dy = (y - cy) / safeRy;
    const normDist = Math.hypot(dx, dy);
    const distToPerimeter = Math.abs(normDist - 1.0) * Math.min(safeRx, safeRy);

    return distToPerimeter < threshold || Math.abs(normDist - 1.0) < 0.35;
  }

  return false;
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
 * Helper to render an SVG stroke element (pen, line, ellipse, arrow)
 */
export function renderSvgAnnotationStroke(stroke, isPreview = false) {
  if (!stroke) return null;
  const { id, tool = 'pen', color = '#ef4444', width, points = [] } = stroke;
  const strokeW = Math.max(1, Number(width !== undefined && width !== null && !isNaN(width) ? width : 4));
  const key = isPreview ? 'preview-stroke' : (id || `stroke_${Math.random()}`);

  if (tool === 'pen') {
    return (
      <path
        key={key}
        d={pointsToSvgPath(points)}
        stroke={color}
        strokeWidth={strokeW}
        vectorEffect="non-scaling-stroke"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
        className={isPreview ? '' : 'transition-opacity hover:opacity-80'}
      />
    );
  }

  const p1 = stroke.startPoint || points[0];
  const p2 = stroke.endPoint || points[points.length - 1];
  if (!p1 || !p2) return null;

  const x1 = p1.x * 1000;
  const y1 = p1.y * 1000;
  const x2 = p2.x * 1000;
  const y2 = p2.y * 1000;

  if (tool === 'line') {
    return (
      <line
        key={key}
        x1={x1}
        y1={y1}
        x2={x2}
        y2={y2}
        stroke={color}
        strokeWidth={strokeW}
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
        className={isPreview ? '' : 'transition-opacity hover:opacity-80'}
      />
    );
  }

  if (tool === 'ellipse') {
    const cx = (x1 + x2) / 2;
    const cy = (y1 + y2) / 2;
    const rx = Math.max(Math.abs(x2 - x1) / 2, 1);
    const ry = Math.max(Math.abs(y2 - y1) / 2, 1);

    return (
      <ellipse
        key={key}
        cx={cx}
        cy={cy}
        rx={rx}
        ry={ry}
        stroke={color}
        strokeWidth={strokeW}
        fill="none"
        vectorEffect="non-scaling-stroke"
        className={isPreview ? '' : 'transition-opacity hover:opacity-80'}
      />
    );
  }

  if (tool === 'arrow') {
    const angle = Math.atan2(y2 - y1, x2 - x1);
    const headLength = Math.max(12, strokeW * 3.5);
    const angle1 = angle - Math.PI / 6;
    const angle2 = angle + Math.PI / 6;
    const xLeft = x2 - headLength * Math.cos(angle1);
    const yLeft = y2 - headLength * Math.sin(angle1);
    const xRight = x2 - headLength * Math.cos(angle2);
    const yRight = y2 - headLength * Math.sin(angle2);

    return (
      <g key={key} className={isPreview ? '' : 'transition-opacity hover:opacity-80'}>
        <line
          x1={x1}
          y1={y1}
          x2={x2}
          y2={y2}
          stroke={color}
          strokeWidth={strokeW}
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
        <polygon
          points={`${x2},${y2} ${xLeft},${yLeft} ${xRight},${yRight}`}
          fill={color}
          stroke={color}
          strokeWidth={1}
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
      </g>
    );
  }

  return null;
}

/**
 * SubmissionAnnotationCanvas: Native React + SVG Overlay Canvas (Phase 2 - P2-B2 Text Note Edit & Eraser Integration)
 * Coordinates are 100% normalized in [0, 1] range.
 * Supports Single Shared Transform Layer, Desktop Mouse Pan Dragging, Mobile Pinch Zoom / Pan, and Note Management.
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

  // Note authoring & editing state (Phase 2 - P2-B1 & P2-B2)
  const [pendingNote, setPendingNote] = useState(null);
  const [editingNote, setEditingNote] = useState(null);
  const [isNoteEditorOpen, setIsNoteEditorOpen] = useState(false);
  const [noteLimitMessage, setNoteLimitMessage] = useState('');

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

  // Calculate Popover screen position inside Viewport boundaries
  const calculatePopoverPosition = useCallback((clientX, clientY) => {
    const rect = viewportRef.current?.getBoundingClientRect();
    const vpLeft = rect?.left || 0;
    const vpTop = rect?.top || 0;
    const vpWidth = rect?.width || 800;
    const vpHeight = rect?.height || 600;

    const clickX = (clientX !== undefined && clientX !== null ? clientX : vpLeft + vpWidth / 2) - vpLeft;
    const clickY = (clientY !== undefined && clientY !== null ? clientY : vpTop + vpHeight / 2) - vpTop;

    const popoverWidth = 300;
    const popoverHeight = 180;
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

  // Normalize client pointer coordinates to [0, 1] using Viewport-Anchored Affine Inverse & Image Boundaries
  // Relative offset: localX = clientX - imgRect.left, localY = clientY - imgRect.top
  // Normalized: x = localX / renderedImageWidth, y = localY / renderedImageHeight strictly clamped to [0, 1]
  const getNormalizedPoint = useCallback((e) => {
    if (!e) return { x: 0, y: 0 };
    const clientX = e.clientX !== undefined ? e.clientX : 0;
    const clientY = e.clientY !== undefined ? e.clientY : 0;

    // 1. Direct Image Element Bounds (Accounts for real image render rect and active transform)
    const imgEl = imageRef.current;
    if (imgEl && typeof imgEl.getBoundingClientRect === 'function') {
      const imgRect = imgEl.getBoundingClientRect();
      if (imgRect.width > 0 && imgRect.height > 0) {
        const localX = clientX - imgRect.left;
        const localY = clientY - imgRect.top;
        return {
          x: Math.max(0, Math.min(1, localX / imgRect.width)),
          y: Math.max(0, Math.min(1, localY / imgRect.height)),
        };
      }
    }

    // 2. Fallback to Content / Viewport Transform Inverse
    if (!viewportRef.current || !contentRef.current) return { x: 0, y: 0 };
    const rect = viewportRef.current.getBoundingClientRect();
    const baseWidth = contentRef.current.offsetWidth || rect.width || 800;
    const baseHeight = contentRef.current.offsetHeight || rect.height || 600;

    return screenToNormalized({
      clientX,
      clientY,
      viewportRect: rect,
      baseWidth,
      baseHeight,
      scale,
      panX,
      panY,
    });
  }, [scale, panX, panY]);

  // Note Authoring & Management Handlers (Phase 2 - P2-B1 & P2-B2)
  const handleSaveNote = ({ text, color }) => {
    if (editingNote) {
      // EDIT EXISTING NOTE: replace by ID, preserving original id, x, y
      const nextNotes = updateNoteInList(annotation.notes || [], editingNote.id, {
        text,
        color,
      });

      onChange?.({
        ...annotation,
        schema_version: annotation.schema_version || 1,
        notes: nextNotes,
      });
    } else if (pendingNote) {
      // CREATE NEW NOTE: generate UUID and clamp coordinates
      const validatedNote = normalizeNote({
        id: generateNoteId(),
        x: pendingNote.x,
        y: pendingNote.y,
        text,
        color: color || DEFAULT_NOTE_COLOR,
      });

      if (validatedNote) {
        const nextNotes = [...(annotation.notes || []), validatedNote];
        onChange?.({
          ...annotation,
          schema_version: annotation.schema_version || 1,
          notes: nextNotes,
        });
      }
    }

    setIsNoteEditorOpen(false);
    setPendingNote(null);
    setEditingNote(null);
  };

  const handleDeleteNote = () => {
    if (editingNote) {
      const nextNotes = removeNoteFromList(annotation.notes || [], editingNote.id);
      onChange?.({
        ...annotation,
        schema_version: annotation.schema_version || 1,
        notes: nextNotes,
      });
    }
    setIsNoteEditorOpen(false);
    setPendingNote(null);
    setEditingNote(null);
  };

  const handleCancelNote = () => {
    setIsNoteEditorOpen(false);
    setPendingNote(null);
    setEditingNote(null);
  };

  // Click on existing Note Pin
  const handleNotePinClick = (e, note) => {
    e.stopPropagation();
    e.preventDefault();
    if (readOnly) return;

    if (activeTool === 'eraser') {
      // ERASER TOOL: Delete the note directly without opening editor
      const nextNotes = removeNoteFromList(annotation.notes || [], note.id);
      onChange?.({
        ...annotation,
        schema_version: annotation.schema_version || 1,
        notes: nextNotes,
      });
      return;
    }

    // ALL OTHER TOOLS: Open editor prefilled with existing note data
    const rect = e.currentTarget?.getBoundingClientRect?.();
    const pinCenterX = rect ? rect.left + rect.width / 2 : e.clientX;
    const pinCenterY = rect ? rect.top + rect.height / 2 : e.clientY;
    const pos = calculatePopoverPosition(pinCenterX ?? e.clientX, pinCenterY ?? e.clientY);

    setEditingNote({
      ...note,
      positionStyle: pos,
    });
    setPendingNote(null);
    setIsNoteEditorOpen(true);
  };

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

    // 1. ERASER TOOL (STROKES / STAMPS)
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

    // 3. NOTE TOOL (CLICK/TAP TO PLACE PIN AND OPEN EDITOR)
    if (activeTool === 'note') {
      const existingNotes = annotation.notes || [];
      if (existingNotes.length >= MAX_NOTES_COUNT) {
        setNoteLimitMessage(`Đã đạt giới hạn tối đa ${MAX_NOTES_COUNT} ghi chú trên ảnh này.`);
        setTimeout(() => setNoteLimitMessage(''), 3000);
        return;
      }

      const pos = calculatePopoverPosition(e.clientX, e.clientY);
      setPendingNote({
        x,
        y,
        positionStyle: pos,
      });
      setEditingNote(null);
      setIsNoteEditorOpen(true);
      return;
    }

    // 4. PEN TOOL
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
      return;
    }

    // 5. SHAPE TOOLS (LINE / ELLIPSE / ARROW)
    if (activeTool === 'line' || activeTool === 'ellipse' || activeTool === 'arrow') {
      try {
        e.currentTarget.setPointerCapture?.(e.pointerId);
      } catch (err) {}

      isPointerActiveRef.current = true;
      setCurrentStroke({
        id: generateAnnotationElementId('stroke'),
        tool: activeTool,
        color: activeColor,
        width: strokeWidth,
        points: [{ x, y }, { x, y }],
        startPoint: { x, y },
        endPoint: { x, y }
      });
      return;
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

    // SINGLE POINTER DRAWING (PEN OR SHAPE)
    if (!isPointerActiveRef.current || !currentStroke || suppressSinglePointerDrawRef.current) return;
    const { x, y } = getNormalizedPoint(e);

    // PEN TOOL: Accumulate path points
    if (currentStroke.tool === 'pen') {
      const lastPoint = currentStroke.points[currentStroke.points.length - 1];
      if (lastPoint) {
        const dist = Math.hypot(lastPoint.x - x, lastPoint.y - y);
        if (dist < 0.001) return; // Ignore microscopic jitter
      }

      setCurrentStroke(prev => prev ? {
        ...prev,
        points: [...prev.points, { x, y }]
      } : null);
      return;
    }

    // SHAPE TOOLS (LINE / ELLIPSE / ARROW): Update endPoint
    if (['line', 'ellipse', 'arrow'].includes(currentStroke.tool)) {
      setCurrentStroke(prev => {
        if (!prev) return null;
        const startPoint = prev.startPoint || prev.points[0] || { x, y };
        return {
          ...prev,
          startPoint,
          endPoint: { x, y },
          points: [startPoint, { x, y }]
        };
      });
    }
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

      const tool = currentStroke.tool || 'pen';
      let isValidStroke = false;

      if (tool === 'pen') {
        isValidStroke = currentStroke.points && currentStroke.points.length > 0;
      } else if (['line', 'ellipse', 'arrow'].includes(tool)) {
        const p1 = currentStroke.startPoint || currentStroke.points?.[0];
        const p2 = currentStroke.endPoint || currentStroke.points?.[1];
        if (p1 && p2) {
          const dist = Math.hypot(p2.x - p1.x, p2.y - p1.y);
          // Ignore accidental zero-length click/tap gestures without dragging
          if (dist >= 0.005) {
            isValidStroke = true;
          }
        }
      }

      if (isValidStroke) {
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
    activePointersRef.current.delete(e.pointerId);

    if (activePointersRef.current.size < 2) {
      pinchGestureRef.current = null;
    }

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

    // Safely discard any in-progress drawing without mutating annotation
    isPointerActiveRef.current = false;
    setCurrentStroke(null);
  };

  const handleLostPointerCapture = (e) => {
    handlePointerUp(e);
  };

  // Cursor style based on active tool
  const getCursorClass = () => {
    if (readOnly) return 'cursor-default';
    if (activeTool === 'pan') return isDragging ? 'cursor-grabbing' : 'cursor-grab';
    if (['pen', 'line', 'ellipse', 'arrow'].includes(activeTool)) return 'cursor-crosshair';
    if (activeTool === 'check' || activeTool === 'cross' || activeTool === 'note') return 'cursor-pointer';
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
          {/* NÉT VẼ ĐÃ LƯU (COMMITTED STROKES: PEN, LINE, ELLIPSE, ARROW) */}
          {(annotation.strokes || []).map((stroke) => renderSvgAnnotationStroke(stroke, false))}

          {/* NÉT VẼ ĐANG VẼ DỞ (CURRENT LIVE DRAWING PREVIEW) */}
          {currentStroke && renderSvgAnnotationStroke(currentStroke, true)}
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

        {/* 4. GHI CHÚ GHIM TRÊN ẢNH (TEXT NOTES PIN OVERLAY - PHASE 2 P2-B1 & P2-B2) */}
        {(annotation.notes || []).map((note, index) => (
          <div
            key={note.id || `note_${index}`}
            role="button"
            tabIndex={0}
            aria-label={`Xem ghi chú #${index + 1}`}
            data-testid={`note-pin-${note.id}`}
            style={{
              position: 'absolute',
              left: `${note.x * 100}%`,
              top: `${note.y * 100}%`,
              transform: 'translate(-50%, -100%)',
              pointerEvents: readOnly ? 'none' : 'auto',
            }}
            className="group select-none cursor-pointer z-20 p-1 -m-1 focus:outline-none focus:ring-2 focus:ring-amber-400 focus:ring-offset-2 focus:ring-offset-slate-900 rounded-full"
            title={note.text}
            onPointerDown={(e) => {
              // Prevent canvas from initiating pan or stroke drawing
              e.stopPropagation();
            }}
            onClick={(e) => handleNotePinClick(e, note)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                handleNotePinClick(e, note);
              }
            }}
          >
            {/* Note Pin Head */}
            <div
              className={`flex items-center justify-center w-6 h-6 sm:w-7 sm:h-7 rounded-full shadow-lg border-2 border-white transition-transform ${
                activeTool === 'eraser'
                  ? 'hover:scale-125 ring-2 ring-rose-500 ring-offset-1'
                  : 'group-hover:scale-125'
              }`}
              style={{ backgroundColor: note.color || '#f59e0b' }}
            >
              <StickyNote className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-white" />
            </div>

            {/* Hover Tooltip / Preview Card */}
            <div className="absolute left-1/2 -translate-x-1/2 bottom-full mb-1.5 hidden group-hover:block w-48 sm:w-56 p-2.5 rounded-xl bg-slate-900/95 backdrop-blur-md border border-slate-700 shadow-2xl text-white text-[11px] leading-relaxed break-words z-30 pointer-events-none animate-in fade-in zoom-in-95">
              <div className="font-bold text-[10px] text-amber-400 mb-0.5 flex items-center justify-between">
                <span>Ghi chú #{index + 1}</span>
                {activeTool === 'eraser' && (
                  <span className="text-rose-400 text-[9px] font-medium">Click để xóa</span>
                )}
              </div>
              <p className="whitespace-pre-wrap text-slate-200">{note.text}</p>
            </div>
          </div>
        ))}

        {/* PENDING NOTE PIN PREVIEW (WHILE POPOVER IS OPEN FOR NEW NOTE) */}
        {isNoteEditorOpen && pendingNote && !editingNote && (
          <div
            data-testid="pending-note-pin"
            style={{
              position: 'absolute',
              left: `${pendingNote.x * 100}%`,
              top: `${pendingNote.y * 100}%`,
              transform: 'translate(-50%, -100%)',
              pointerEvents: 'none',
            }}
            className="select-none z-20 p-1 -m-1"
          >
            <div
              className="flex items-center justify-center w-6 h-6 sm:w-7 sm:h-7 rounded-full shadow-lg border-2 border-white ring-4 ring-amber-400/50 animate-pulse transition-transform scale-110"
              style={{ backgroundColor: DEFAULT_NOTE_COLOR }}
            >
              <StickyNote className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-white" />
            </div>
          </div>
        )}
      </div>

      {/* NOTE EDITOR POPOVER */}
      <AnnotationNotePopover
        isOpen={isNoteEditorOpen}
        positionStyle={editingNote?.positionStyle || pendingNote?.positionStyle}
        initialText={editingNote?.text || ''}
        initialColor={editingNote?.color || DEFAULT_NOTE_COLOR}
        isEditing={!!editingNote}
        onSave={handleSaveNote}
        onDelete={handleDeleteNote}
        onCancel={handleCancelNote}
      />

      {/* NOTE LIMIT NOTIFICATION TOAST */}
      {noteLimitMessage && (
        <div className="absolute top-3 left-1/2 -translate-x-1/2 z-40 px-3 py-1.5 rounded-lg bg-rose-600/90 text-white text-xs font-semibold shadow-lg border border-rose-400/50 animate-in fade-in">
          {noteLimitMessage}
        </div>
      )}
    </div>
  );
};
