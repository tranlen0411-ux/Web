/**
 * src/utils/annotationViewportMath.js
 * Pure mathematical utilities for Zoom/Pan Coordinate Transformation (Phase 2 - P2-A1 / P2-A2 / P2-A2.1)
 * 
 * Provides Affine Inverse Coordinate Transform, Scale & Pan Bounding Clamps,
 * Deterministic Zoom Stepping, and Multi-touch Pinch / Pan Geometry Calculations.
 */

export const ZOOM_STEP = 0.25;
export const MIN_SCALE = 1;
export const MAX_SCALE = 4;

/**
 * Clamp a numeric value between min and max
 * @param {number} val
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
export function clamp(val, min, max) {
  if (!Number.isFinite(val)) return min;
  return Math.max(min, Math.min(max, val));
}

/**
 * Clamp scale factor between MIN_SCALE (1) and MAX_SCALE (4)
 * @param {number} scale
 * @returns {number}
 */
export function clampScale(scale) {
  return clamp(scale, MIN_SCALE, MAX_SCALE);
}

/**
 * Increase scale by ZOOM_STEP (0.25) clamped to MAX_SCALE
 * @param {number} currentScale
 * @returns {number}
 */
export function zoomIn(currentScale = 1) {
  const next = Math.round((currentScale + ZOOM_STEP) * 100) / 100;
  return clampScale(next);
}

/**
 * Decrease scale by ZOOM_STEP (0.25) clamped to MIN_SCALE
 * @param {number} currentScale
 * @returns {number}
 */
export function zoomOut(currentScale = 1) {
  const next = Math.round((currentScale - ZOOM_STEP) * 100) / 100;
  return clampScale(next);
}

/**
 * Return default reset viewport state (scale = 1, pan = 0, 0)
 * @returns {{ scale: number, panX: number, panY: number }}
 */
export function resetZoom() {
  return { scale: 1, panX: 0, panY: 0 };
}

/**
 * Format scale number to display percentage string (e.g. 1.0 -> "100%", 1.25 -> "125%")
 * @param {number} scale
 * @returns {string}
 */
export function formatZoomPercentage(scale = 1) {
  const safe = clampScale(scale);
  return `${Math.round(safe * 100)}%`;
}

/**
 * Calculate Euclidean distance between two pointer points
 * @param {{ clientX: number, clientY: number }} p1
 * @param {{ clientX: number, clientY: number }} p2
 * @returns {number}
 */
export function calculateDistance(p1, p2) {
  if (!p1 || !p2) return 0;
  return Math.hypot(p1.clientX - p2.clientX, p1.clientY - p2.clientY);
}

/**
 * Calculate midpoint between two pointer points
 * @param {{ clientX: number, clientY: number }} p1
 * @param {{ clientX: number, clientY: number }} p2
 * @returns {{ clientX: number, clientY: number }}
 */
export function calculateMidpoint(p1, p2) {
  if (!p1 && !p2) return { clientX: 0, clientY: 0 };
  if (!p1) return { clientX: p2.clientX, clientY: p2.clientY };
  if (!p2) return { clientX: p1.clientX, clientY: p1.clientY };
  return {
    clientX: (p1.clientX + p2.clientX) / 2,
    clientY: (p1.clientY + p2.clientY) / 2,
  };
}

/**
 * Calculate new scale and pan for two-finger Pinch Zoom and Two-finger Pan
 * Keeps the content point under initial midpoint anchored under the current midpoint.
 * 
 * @param {Object} params
 * @param {number} params.initialDistance - Distance between pointers at pinch start
 * @param {{ clientX: number, clientY: number }} params.initialMidpoint - Midpoint at pinch start
 * @param {number} params.initialScale - Viewport scale at pinch start
 * @param {{ x: number, y: number }} params.initialPan - Viewport pan at pinch start
 * @param {{ clientX: number, clientY: number }} params.currentP1 - Current pointer 1
 * @param {{ clientX: number, clientY: number }} params.currentP2 - Current pointer 2
 * @param {{ left: number, top: number, width: number, height: number }} params.viewportRect - Un-transformed viewport rect
 * @param {number} params.baseWidth - Un-transformed content base width
 * @param {number} params.baseHeight - Un-transformed content base height
 * @returns {{ scale: number, panX: number, panY: number }}
 */
export function calculatePinchTransform({
  initialDistance,
  initialMidpoint,
  initialScale = 1,
  initialPan = { x: 0, y: 0 },
  currentP1,
  currentP2,
  viewportRect,
  baseWidth,
  baseHeight,
}) {
  if (!initialDistance || initialDistance <= 0 || !initialMidpoint || !currentP1 || !currentP2 || !viewportRect) {
    return { scale: initialScale, panX: initialPan?.x || 0, panY: initialPan?.y || 0 };
  }

  // 1. Calculate new scale
  const currentDist = calculateDistance(currentP1, currentP2);
  const scaleRatio = currentDist / Math.max(initialDistance, 1);
  const newScale = clampScale(initialScale * scaleRatio);

  // 2. Find content anchor under initial midpoint in content coordinate space
  const initMidX = initialMidpoint.clientX - viewportRect.left;
  const initMidY = initialMidpoint.clientY - viewportRect.top;
  const safeInitScale = initialScale > 0 ? initialScale : 1;
  const contentAnchorX = (initMidX - (initialPan.x || 0)) / safeInitScale;
  const contentAnchorY = (initMidY - (initialPan.y || 0)) / safeInitScale;

  // 3. Current midpoint on screen
  const currentMidpoint = calculateMidpoint(currentP1, currentP2);
  const currMidX = currentMidpoint.clientX - viewportRect.left;
  const currMidY = currentMidpoint.clientY - viewportRect.top;

  // 4. Proposed pan that keeps content anchor under current midpoint at newScale
  const proposedPanX = currMidX - (contentAnchorX * newScale);
  const proposedPanY = currMidY - (contentAnchorY * newScale);

  // 5. Clamp pan to viewport bounds
  const clamped = clampPan({
    viewportWidth: viewportRect.width || 0,
    viewportHeight: viewportRect.height || 0,
    baseWidth: baseWidth || 0,
    baseHeight: baseHeight || 0,
    scale: newScale,
    panX: proposedPanX,
    panY: proposedPanY,
  });

  return {
    scale: newScale,
    panX: clamped.panX,
    panY: clamped.panY,
  };
}

/**
 * Clamp pan offsets so that the scaled content remains bounded within valid viewport extents
 * @param {Object} params
 * @param {number} params.viewportWidth - Un-transformed viewport width
 * @param {number} params.viewportHeight - Un-transformed viewport height
 * @param {number} params.baseWidth - Un-transformed content base width
 * @param {number} params.baseHeight - Un-transformed content base height
 * @param {number} params.scale - Current scale factor (>= 1)
 * @param {number} params.panX - Proposed panX offset in px
 * @param {number} params.panY - Proposed panY offset in px
 * @returns {{ panX: number, panY: number }}
 */
export function clampPan({
  viewportWidth = 0,
  viewportHeight = 0,
  baseWidth = 0,
  baseHeight = 0,
  scale = 1,
  panX = 0,
  panY = 0,
}) {
  const safeScale = clampScale(scale);

  // When scale <= 1, content fits or centers, no panning allowed
  if (safeScale <= 1) {
    return { panX: 0, panY: 0 };
  }

  const scaledWidth = baseWidth * safeScale;
  const scaledHeight = baseHeight * safeScale;

  // Horizontal bounds:
  // If scaled content is wider than viewport, minPanX = viewportWidth - scaledWidth, maxPanX = 0
  // If scaled content is narrower or equal, lock panX = 0
  let minPanX = 0;
  let maxPanX = 0;
  if (scaledWidth > viewportWidth) {
    minPanX = viewportWidth - scaledWidth;
    maxPanX = 0;
  }

  // Vertical bounds:
  // If scaled content is taller than viewport, minPanY = viewportHeight - scaledHeight, maxPanY = 0
  let minPanY = 0;
  let maxPanY = 0;
  if (scaledHeight > viewportHeight) {
    minPanY = viewportHeight - scaledHeight;
    maxPanY = 0;
  }

  return {
    panX: clamp(panX, minPanX, maxPanX),
    panY: clamp(panY, minPanY, maxPanY),
  };
}

/**
 * Convert client screen coordinates (e.clientX, e.clientY) to normalized [0, 1] content coordinates
 * Uses un-transformed Viewport Rect and explicit Affine Inverse transformation.
 * 
 * @param {Object} params
 * @param {number} params.clientX - Pointer clientX
 * @param {number} params.clientY - Pointer clientY
 * @param {{ left: number, top: number, width: number, height: number }} params.viewportRect - Un-transformed viewport DOMRect
 * @param {number} params.baseWidth - Un-transformed content base layout width (e.g. contentRef.offsetWidth)
 * @param {number} params.baseHeight - Un-transformed content base layout height (e.g. contentRef.offsetHeight)
 * @param {number} [params.scale=1] - Viewport zoom scale
 * @param {number} [params.panX=0] - Viewport pan X offset
 * @param {number} [params.panY=0] - Viewport pan Y offset
 * @param {number} [params.rotation=0] - Viewport rotation angle in degrees (0, 90, 180, 270)
 * @returns {{ x: number, y: number }} Normalized coordinates strictly clamped to [0, 1]
 */
export function screenToNormalized({
  clientX,
  clientY,
  viewportRect,
  baseWidth,
  baseHeight,
  scale = 1,
  panX = 0,
  panY = 0,
  rotation = 0,
}) {
  if (!viewportRect || !baseWidth || !baseHeight || baseWidth <= 0 || baseHeight <= 0) {
    return { x: 0, y: 0 };
  }

  const safeScale = scale > 0 ? scale : 1;

  // 1. Convert client to viewport space (un-transformed)
  const viewportX = clientX - viewportRect.left;
  const viewportY = clientY - viewportRect.top;

  let contentX, contentY;

  if (rotation && rotation % 360 !== 0) {
    // When rotated, transform origin is center (50% 50%)
    const cx = baseWidth / 2;
    const cy = baseHeight / 2;
    const x2 = viewportX - (cx + panX);
    const y2 = viewportY - (cy + panY);
    const x1 = x2 / safeScale;
    const y1 = y2 / safeScale;
    const rad = (-rotation * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);

    contentX = x1 * cos - y1 * sin + cx;
    contentY = x1 * sin + y1 * cos + cy;
  } else {
    // Standard unrotated viewport (top-left anchor 0 0)
    contentX = (viewportX - panX) / safeScale;
    contentY = (viewportY - panY) / safeScale;
  }

  // 4. Normalize against un-transformed base dimensions and clamp to [0, 1]
  const normalizedX = clamp(contentX / baseWidth, 0, 1);
  const normalizedY = clamp(contentY / baseHeight, 0, 1);

  return {
    x: normalizedX,
    y: normalizedY,
  };
}

/**
 * Convert normalized [0, 1] content coordinates to un-transformed content pixel coordinates
 * @param {number} normalizedX
 * @param {number} normalizedY
 * @param {number} baseWidth
 * @param {number} baseHeight
 * @returns {{ x: number, y: number }}
 */
export function normalizedToContentPixels(normalizedX, normalizedY, baseWidth, baseHeight) {
  return {
    x: clamp(normalizedX, 0, 1) * (baseWidth || 0),
    y: clamp(normalizedY, 0, 1) * (baseHeight || 0),
  };
}
