import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Camera, Wifi, WifiOff, RotateCcw, Check, Target, ZoomIn, ZoomOut, Move } from 'lucide-react';

// ============ TYPES ============
interface Point {
  x: number;
  y: number;
}

interface Ellipse {
  centerX: number;
  centerY: number;
  radiusX: number;
  radiusY: number;
  rotation: number; // in radians
}

interface DartboardCalibration {
  ellipse: Ellipse | null;
  isCalibrated: boolean;
  rotationOffset: number; // Degrees to rotate the segment numbers (where is 20?)
}

interface PolarCoord {
  r: number;      // normalized radius (0-1)
  theta: number;  // angle in degrees (0° at 20, clockwise)
}

interface DartHit {
  x: number;
  y: number;
  polar: PolarCoord;
  value: number;
  multiplier: number;
  points: number;
  timestamp: number;
}

interface DetectedContour {
  points: Point[];
  area: number;
  boundingBox: { x: number; y: number; width: number; height: number };
  centroid: Point;
}

type CalibrationMode = 'auto-detecting' | 'manual-adjust' | 'confirming' | 'active';

// ============ CONSTANTS ============
const DART_NUMBERS = [20, 1, 18, 4, 13, 6, 10, 15, 2, 17, 3, 19, 7, 16, 8, 11, 14, 9, 12, 5];
const SEGMENT_ANGLE = 18; // degrees per segment

// Ring boundaries (relative to outer double ring = 1.0)
const DOUBLE_BULL_R = 0.032;
const SINGLE_BULL_R = 0.080;
const INNER_SINGLE_OUTER_R = 0.47;  // End of inner single
const TRIPLE_OUTER_R = 0.54;        // End of triple
const OUTER_SINGLE_OUTER_R = 0.89;  // End of outer single
const DOUBLE_OUTER_R = 1.0;         // End of double (board edge)

// Detection parameters
const DART_DETECTION_COOLDOWN = 2000;
const MIN_DART_AREA = 80;
const DIFF_THRESHOLD = 30;

// ============ COMPONENT ============
function MobileCameraV3() {
  // Refs
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null);
  
  // State
  const [cameraActive, setCameraActive] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [mode, setMode] = useState<CalibrationMode>('auto-detecting');
  const [feedback, setFeedback] = useState('');
  const [hitCount, setHitCount] = useState(0);
  const [lastHit, setLastHit] = useState<DartHit | null>(null);
  const [detectionQuality, setDetectionQuality] = useState(0);
  
  // Manual adjustment state
  const [manualEllipse, setManualEllipse] = useState<Ellipse>({
    centerX: 0, centerY: 0, radiusX: 150, radiusY: 150, rotation: 0
  });
  const [rotationOffset, setRotationOffset] = useState(0);
  
  // Refs for processing
  const calibrationRef = useRef<DartboardCalibration>({
    ellipse: null,
    isCalibrated: false,
    rotationOffset: 0
  });
  const referenceFrameRef = useRef<ImageData | null>(null);
  const lastDartTimeRef = useRef<number>(0);
  const frameCountRef = useRef(0);
  const detectionHistoryRef = useRef<Ellipse[]>([]);

  // ============ IMAGE PROCESSING UTILITIES ============

  /**
   * Convert RGB to HSV color space
   */
  const rgbToHsv = (r: number, g: number, b: number): { h: number; s: number; v: number } => {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const d = max - min;
    
    let h = 0;
    const s = max === 0 ? 0 : d / max;
    const v = max;
    
    if (d !== 0) {
      switch (max) {
        case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
        case g: h = ((b - r) / d + 2) / 6; break;
        case b: h = ((r - g) / d + 4) / 6; break;
      }
    }
    
    return { h: h * 360, s: s * 100, v: v * 100 };
  };

  /**
   * Create a color mask for dartboard detection (red and green areas)
   */
  const createDartboardColorMask = useCallback((imageData: ImageData): Uint8ClampedArray => {
    const { width, height, data } = imageData;
    const mask = new Uint8ClampedArray(width * height);
    
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const pixelIdx = i / 4;
      
      const hsv = rgbToHsv(r, g, b);
      
      // Detect red segments (H: 0-15 or 345-360, S > 40, V > 30)
      const isRed = ((hsv.h < 15 || hsv.h > 345) && hsv.s > 40 && hsv.v > 30);
      
      // Detect green segments (H: 80-160, S > 30, V > 25)
      const isGreen = (hsv.h > 80 && hsv.h < 160 && hsv.s > 30 && hsv.v > 25);
      
      // Also detect black areas (very low V) which are part of the board
      const isBlack = (hsv.v < 15 && hsv.s < 30);
      
      // White/beige areas (low S, high V)
      const isWhite = (hsv.s < 25 && hsv.v > 60);
      
      mask[pixelIdx] = (isRed || isGreen || isBlack || isWhite) ? 255 : 0;
    }
    
    return mask;
  }, []);

  /**
   * Apply morphological operations to clean up the mask
   */
  const morphologicalClose = useCallback((mask: Uint8ClampedArray, width: number, height: number, kernelSize: number): Uint8ClampedArray => {
    const dilated = new Uint8ClampedArray(width * height);
    const closed = new Uint8ClampedArray(width * height);
    const half = Math.floor(kernelSize / 2);
    
    // Dilate
    for (let y = half; y < height - half; y++) {
      for (let x = half; x < width - half; x++) {
        let maxVal = 0;
        for (let ky = -half; ky <= half; ky++) {
          for (let kx = -half; kx <= half; kx++) {
            maxVal = Math.max(maxVal, mask[(y + ky) * width + (x + kx)]);
          }
        }
        dilated[y * width + x] = maxVal;
      }
    }
    
    // Erode
    for (let y = half; y < height - half; y++) {
      for (let x = half; x < width - half; x++) {
        let minVal = 255;
        for (let ky = -half; ky <= half; ky++) {
          for (let kx = -half; kx <= half; kx++) {
            minVal = Math.min(minVal, dilated[(y + ky) * width + (x + kx)]);
          }
        }
        closed[y * width + x] = minVal;
      }
    }
    
    return closed;
  }, []);

  /**
   * Find the largest connected component (the dartboard)
   */
  const findLargestBlob = useCallback((mask: Uint8ClampedArray, width: number, height: number): DetectedContour | null => {
    const visited = new Uint8ClampedArray(width * height);
    let largestBlob: DetectedContour | null = null;
    let largestArea = 0;
    
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = y * width + x;
        if (mask[idx] > 0 && visited[idx] === 0) {
          // Flood fill
          const points: Point[] = [];
          const stack: Point[] = [{ x, y }];
          let minX = x, maxX = x, minY = y, maxY = y;
          let sumX = 0, sumY = 0;
          
          while (stack.length > 0) {
            const p = stack.pop()!;
            const pIdx = p.y * width + p.x;
            
            if (p.x < 0 || p.x >= width || p.y < 0 || p.y >= height) continue;
            if (visited[pIdx] !== 0 || mask[pIdx] === 0) continue;
            
            visited[pIdx] = 1;
            points.push(p);
            sumX += p.x;
            sumY += p.y;
            
            minX = Math.min(minX, p.x);
            maxX = Math.max(maxX, p.x);
            minY = Math.min(minY, p.y);
            maxY = Math.max(maxY, p.y);
            
            // 4-connectivity for speed
            stack.push({ x: p.x + 1, y: p.y });
            stack.push({ x: p.x - 1, y: p.y });
            stack.push({ x: p.x, y: p.y + 1 });
            stack.push({ x: p.x, y: p.y - 1 });
          }
          
          if (points.length > largestArea) {
            largestArea = points.length;
            largestBlob = {
              points,
              area: points.length,
              boundingBox: { x: minX, y: minY, width: maxX - minX, height: maxY - minY },
              centroid: { x: sumX / points.length, y: sumY / points.length }
            };
          }
        }
      }
    }
    
    return largestBlob;
  }, []);

  /**
   * Find edge points of a blob for ellipse fitting
   */
  const findEdgePoints = useCallback((mask: Uint8ClampedArray, width: number, height: number, blob: DetectedContour): Point[] => {
    const edges: Point[] = [];
    const { boundingBox } = blob;
    
    for (let y = boundingBox.y; y < boundingBox.y + boundingBox.height; y++) {
      for (let x = boundingBox.x; x < boundingBox.x + boundingBox.width; x++) {
        const idx = y * width + x;
        if (mask[idx] > 0) {
          // Check if it's an edge pixel (has at least one neighbor that is 0)
          const hasEmptyNeighbor = 
            (x > 0 && mask[idx - 1] === 0) ||
            (x < width - 1 && mask[idx + 1] === 0) ||
            (y > 0 && mask[idx - width] === 0) ||
            (y < height - 1 && mask[idx + width] === 0);
          
          if (hasEmptyNeighbor) {
            edges.push({ x, y });
          }
        }
      }
    }
    
    // Sample edges if there are too many
    if (edges.length > 200) {
      const sampled: Point[] = [];
      const step = Math.floor(edges.length / 200);
      for (let i = 0; i < edges.length; i += step) {
        sampled.push(edges[i]);
      }
      return sampled;
    }
    
    return edges;
  }, []);

  /**
   * Fit an ellipse to a set of points using least squares
   * Uses the direct ellipse fitting method
   */
  const fitEllipse = useCallback((points: Point[]): Ellipse | null => {
    if (points.length < 6) return null;
    
    // Normalize points to improve numerical stability
    let sumX = 0, sumY = 0;
    for (const p of points) {
      sumX += p.x;
      sumY += p.y;
    }
    const cx = sumX / points.length;
    const cy = sumY / points.length;
    
    let maxDist = 0;
    for (const p of points) {
      const d = Math.sqrt((p.x - cx) ** 2 + (p.y - cy) ** 2);
      if (d > maxDist) maxDist = d;
    }
    const scale = maxDist > 0 ? maxDist : 1;
    
    // Build design matrix for general conic: Ax² + Bxy + Cy² + Dx + Ey + F = 0
    // We'll use a simpler approach: fit to the normalized points
    const normalized = points.map(p => ({
      x: (p.x - cx) / scale,
      y: (p.y - cy) / scale
    }));
    
    // Use moment-based ellipse fitting
    let m00 = normalized.length;
    let m10 = 0, m01 = 0, m20 = 0, m02 = 0, m11 = 0;
    
    for (const p of normalized) {
      m10 += p.x;
      m01 += p.y;
      m20 += p.x * p.x;
      m02 += p.y * p.y;
      m11 += p.x * p.y;
    }
    
    // Central moments
    const mu20 = m20 / m00 - (m10 / m00) ** 2;
    const mu02 = m02 / m00 - (m01 / m00) ** 2;
    const mu11 = m11 / m00 - (m10 / m00) * (m01 / m00);
    
    // Eigenvalues for ellipse semi-axes
    const delta = Math.sqrt((mu20 - mu02) ** 2 + 4 * mu11 ** 2);
    const lambda1 = (mu20 + mu02 + delta) / 2;
    const lambda2 = (mu20 + mu02 - delta) / 2;
    
    if (lambda1 <= 0 || lambda2 <= 0) return null;
    
    // Semi-axes (scaled back)
    const a = Math.sqrt(lambda1) * scale * 2;
    const b = Math.sqrt(lambda2) * scale * 2;
    
    // Rotation angle
    let theta = 0;
    if (mu11 !== 0) {
      theta = 0.5 * Math.atan2(2 * mu11, mu20 - mu02);
    } else if (mu20 < mu02) {
      theta = Math.PI / 2;
    }
    
    return {
      centerX: cx,
      centerY: cy,
      radiusX: Math.max(a, b),
      radiusY: Math.min(a, b),
      rotation: theta
    };
  }, []);

  /**
   * Validate if the detected ellipse looks like a dartboard
   */
  const validateEllipse = useCallback((ellipse: Ellipse, width: number, height: number): number => {
    // Must be reasonably circular (aspect ratio between 0.7 and 1.0)
    const aspectRatio = Math.min(ellipse.radiusX, ellipse.radiusY) / Math.max(ellipse.radiusX, ellipse.radiusY);
    if (aspectRatio < 0.6 || aspectRatio > 1.0) return 0;
    
    // Must be a reasonable size (10-50% of frame)
    const avgRadius = (ellipse.radiusX + ellipse.radiusY) / 2;
    const frameSize = Math.min(width, height);
    const relativeSize = avgRadius / frameSize;
    if (relativeSize < 0.1 || relativeSize > 0.5) return 0;
    
    // Must be roughly centered (within 60% of frame)
    const centerDistX = Math.abs(ellipse.centerX - width / 2) / width;
    const centerDistY = Math.abs(ellipse.centerY - height / 2) / height;
    if (centerDistX > 0.4 || centerDistY > 0.4) return 0;
    
    // Calculate quality score
    let quality = 0;
    quality += aspectRatio * 40; // Up to 40 points for circularity
    quality += (1 - Math.abs(relativeSize - 0.3) * 2) * 30; // Up to 30 points for ideal size
    quality += (1 - centerDistX - centerDistY) * 30; // Up to 30 points for centering
    
    return Math.max(0, Math.min(100, quality));
  }, []);

  /**
   * Stabilize ellipse detection using temporal averaging
   */
  const stabilizeEllipse = useCallback((newEllipse: Ellipse): Ellipse => {
    const history = detectionHistoryRef.current;
    history.push(newEllipse);
    
    // Keep last 10 detections
    while (history.length > 10) {
      history.shift();
    }
    
    if (history.length < 3) return newEllipse;
    
    // Average the last few detections
    let sumCX = 0, sumCY = 0, sumRX = 0, sumRY = 0, sumRot = 0;
    for (const e of history) {
      sumCX += e.centerX;
      sumCY += e.centerY;
      sumRX += e.radiusX;
      sumRY += e.radiusY;
      sumRot += e.rotation;
    }
    
    return {
      centerX: sumCX / history.length,
      centerY: sumCY / history.length,
      radiusX: sumRX / history.length,
      radiusY: sumRY / history.length,
      rotation: sumRot / history.length
    };
  }, []);

  // ============ COORDINATE TRANSFORMATION ============

  /**
   * Transform a point to polar coordinates relative to the dartboard ellipse
   */
  const pointToEllipsePolar = useCallback((point: Point, ellipse: Ellipse): PolarCoord => {
    // Translate to ellipse center
    const dx = point.x - ellipse.centerX;
    const dy = point.y - ellipse.centerY;
    
    // Rotate to align with ellipse axes
    const cos = Math.cos(-ellipse.rotation);
    const sin = Math.sin(-ellipse.rotation);
    const rx = dx * cos - dy * sin;
    const ry = dx * sin + dy * cos;
    
    // Normalize by semi-axes to get unit circle coordinates
    const nx = rx / ellipse.radiusX;
    const ny = ry / ellipse.radiusY;
    
    // Calculate radius on unit circle
    const r = Math.sqrt(nx * nx + ny * ny);
    
    // Calculate angle (0° at top/20, going clockwise)
    let theta = Math.atan2(nx, -ny) * (180 / Math.PI);
    if (theta < 0) theta += 360;
    
    // Apply rotation offset to align with dart numbers
    theta = (theta + calibrationRef.current.rotationOffset + 360) % 360;
    
    return { r, theta };
  }, []);

  /**
   * Convert polar coordinates to dart score
   */
  const polarToScore = useCallback((polar: PolarCoord): { value: number; multiplier: number; points: number } => {
    const { r, theta } = polar;
    
    // Outside board
    if (r > DOUBLE_OUTER_R * 1.05) {
      return { value: 0, multiplier: 0, points: 0 };
    }
    
    // Bulls
    if (r <= DOUBLE_BULL_R) {
      return { value: 50, multiplier: 2, points: 50 }; // Double bull
    }
    if (r <= SINGLE_BULL_R) {
      return { value: 25, multiplier: 1, points: 25 }; // Single bull
    }
    
    // Determine segment number
    const adjustedTheta = (theta + SEGMENT_ANGLE / 2) % 360;
    const segmentIdx = Math.floor(adjustedTheta / SEGMENT_ANGLE) % 20;
    const value = DART_NUMBERS[segmentIdx];
    
    // Determine multiplier based on radius
    let multiplier = 1;
    if (r >= OUTER_SINGLE_OUTER_R && r <= DOUBLE_OUTER_R) {
      multiplier = 2; // Double ring
    } else if (r >= INNER_SINGLE_OUTER_R && r <= TRIPLE_OUTER_R) {
      multiplier = 3; // Triple ring
    }
    
    return { value, multiplier, points: value * multiplier };
  }, []);

  // ============ DART DETECTION ============

  /**
   * Compute frame difference to detect new darts
   */
  const detectDartInDifference = useCallback((
    currentFrame: ImageData,
    referenceFrame: ImageData,
    ellipse: Ellipse
  ): Point | null => {
    const { width, height, data: current } = currentFrame;
    const reference = referenceFrame.data;
    
    // Only look within the dartboard area
    const searchRadius = Math.max(ellipse.radiusX, ellipse.radiusY) * 1.1;
    const minX = Math.max(0, Math.floor(ellipse.centerX - searchRadius));
    const maxX = Math.min(width, Math.ceil(ellipse.centerX + searchRadius));
    const minY = Math.max(0, Math.floor(ellipse.centerY - searchRadius));
    const maxY = Math.min(height, Math.ceil(ellipse.centerY + searchRadius));
    
    const diffPoints: Point[] = [];
    
    for (let y = minY; y < maxY; y++) {
      for (let x = minX; x < maxX; x++) {
        const i = (y * width + x) * 4;
        
        // Calculate color difference
        const dr = Math.abs(current[i] - reference[i]);
        const dg = Math.abs(current[i + 1] - reference[i + 1]);
        const db = Math.abs(current[i + 2] - reference[i + 2]);
        const diff = (dr + dg + db) / 3;
        
        if (diff > DIFF_THRESHOLD) {
          // Check if within ellipse bounds
          const polar = pointToEllipsePolar({ x, y }, ellipse);
          if (polar.r < 1.1) {
            diffPoints.push({ x, y });
          }
        }
      }
    }
    
    if (diffPoints.length < MIN_DART_AREA) return null;
    if (diffPoints.length > 5000) return null; // Too much change, probably lighting
    
    // Find the tip (the point closest to center from the diff region)
    // First, find the centroid of the changed region
    let sumX = 0, sumY = 0;
    for (const p of diffPoints) {
      sumX += p.x;
      sumY += p.y;
    }
    const centroid = { x: sumX / diffPoints.length, y: sumY / diffPoints.length };
    
    // The dart tip should be the point of the changed region that's closest to the board center
    let closestToBoardCenter: Point = centroid;
    let minDistToCenter = Infinity;
    
    // Sort by distance from center and take the closest few points
    const sortedByDist = diffPoints.map(p => ({
      point: p,
      dist: Math.sqrt((p.x - ellipse.centerX) ** 2 + (p.y - ellipse.centerY) ** 2)
    })).sort((a, b) => a.dist - b.dist);
    
    // Average the closest 10% of points to find the tip
    const tipCandidates = sortedByDist.slice(0, Math.max(5, Math.floor(sortedByDist.length * 0.1)));
    let tipX = 0, tipY = 0;
    for (const c of tipCandidates) {
      tipX += c.point.x;
      tipY += c.point.y;
    }
    
    return {
      x: tipX / tipCandidates.length,
      y: tipY / tipCandidates.length  
    };
  }, [pointToEllipsePolar]);

  // ============ DRAWING FUNCTIONS ============

  const drawEllipseOverlay = useCallback((
    ctx: CanvasRenderingContext2D,
    ellipse: Ellipse,
    isActive: boolean,
    rotOffset: number
  ) => {
    ctx.save();
    ctx.translate(ellipse.centerX, ellipse.centerY);
    ctx.rotate(ellipse.rotation);
    
    const color = isActive ? 'rgba(0, 255, 0' : 'rgba(255, 255, 0';
    
    // Draw outer ellipse (double ring)
    ctx.strokeStyle = `${color}, 0.8)`;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.ellipse(0, 0, ellipse.radiusX, ellipse.radiusY, 0, 0, Math.PI * 2);
    ctx.stroke();
    
    // Draw ring boundaries
    const rings = [OUTER_SINGLE_OUTER_R, TRIPLE_OUTER_R, INNER_SINGLE_OUTER_R, SINGLE_BULL_R, DOUBLE_BULL_R];
    ctx.strokeStyle = `${color}, 0.4)`;
    ctx.lineWidth = 1;
    
    for (const r of rings) {
      ctx.beginPath();
      ctx.ellipse(0, 0, ellipse.radiusX * r, ellipse.radiusY * r, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
    
    // Draw segment lines
    for (let i = 0; i < 20; i++) {
      const angle = ((i * SEGMENT_ANGLE - rotOffset) * Math.PI / 180) - Math.PI / 2;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(
        Math.cos(angle) * ellipse.radiusX,
        Math.sin(angle) * ellipse.radiusY
      );
      ctx.stroke();
    }
    
    // Draw segment numbers
    ctx.fillStyle = `${color}, 0.9)`;
    ctx.font = `bold ${Math.round(Math.min(ellipse.radiusX, ellipse.radiusY) * 0.1)}px Arial`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    
    for (let i = 0; i < 20; i++) {
      const angle = ((i * SEGMENT_ANGLE - rotOffset + SEGMENT_ANGLE / 2) * Math.PI / 180) - Math.PI / 2;
      const labelRadius = Math.min(ellipse.radiusX, ellipse.radiusY) * 1.15;
      const lx = Math.cos(angle) * labelRadius;
      const ly = Math.sin(angle) * labelRadius;
      ctx.fillText(DART_NUMBERS[i].toString(), lx, ly);
    }
    
    // Center crosshair
    ctx.strokeStyle = `${color}, 0.9)`;
    ctx.lineWidth = 2;
    const crossSize = 15;
    ctx.beginPath();
    ctx.moveTo(-crossSize, 0);
    ctx.lineTo(crossSize, 0);
    ctx.moveTo(0, -crossSize);
    ctx.lineTo(0, crossSize);
    ctx.stroke();
    
    ctx.restore();
  }, []);

  const drawHitMarker = useCallback((ctx: CanvasRenderingContext2D, point: Point, score: { value: number; multiplier: number }) => {
    // Red dot at hit point
    ctx.fillStyle = 'rgba(255, 0, 0, 0.9)';
    ctx.beginPath();
    ctx.arc(point.x, point.y, 10, 0, Math.PI * 2);
    ctx.fill();
    
    // Yellow ring
    ctx.strokeStyle = 'rgba(255, 255, 0, 0.9)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(point.x, point.y, 18, 0, Math.PI * 2);
    ctx.stroke();
    
    // Score label
    const mult = score.multiplier === 3 ? 'T' : score.multiplier === 2 ? 'D' : '';
    ctx.fillStyle = 'white';
    ctx.font = 'bold 18px Arial';
    ctx.textAlign = 'center';
    ctx.fillText(`${mult}${score.value}`, point.x, point.y - 30);
  }, []);

  // ============ HIT COMMUNICATION ============

  const sendHitToDesktop = useCallback((hit: DartHit) => {
    try {
      const hits = JSON.parse(localStorage.getItem('mobile_hits') || '[]');
      hits.push(hit);
      localStorage.setItem('mobile_hits', JSON.stringify(hits));
      window.dispatchEvent(new CustomEvent('dartHit', { detail: hit }));
    } catch (err) {
      console.error('Error sending hit:', err);
    }
  }, []);

  // ============ CAMERA INITIALIZATION ============

  useEffect(() => {
    const startCamera = async () => {
      try {
        if (window.location.protocol !== 'https:' && window.location.hostname !== 'localhost') {
          setFeedback('⚠️ HTTPS erforderlich');
          return;
        }

        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: 'environment',
            width: { ideal: 1280 },
            height: { ideal: 720 },
            frameRate: { ideal: 30 }
          },
        });

        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
          setCameraActive(true);
          setIsConnected(true);
          setFeedback('📷 Kamera aktiv - Dartscheibe wird gesucht...');
        }
      } catch (err) {
        setIsConnected(false);
        console.error('Camera error:', err);
        setFeedback('❌ Kamera-Zugriff verweigert');
      }
    };

    startCamera();

    return () => {
      if (videoRef.current?.srcObject) {
        (videoRef.current.srcObject as MediaStream).getTracks().forEach(t => t.stop());
      }
    };
  }, []);

  // ============ MAIN PROCESSING LOOP ============

  useEffect(() => {
    if (!cameraActive) return;

    const canvas = canvasRef.current;
    const overlay = overlayCanvasRef.current;
    if (!canvas || !overlay) return;

    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const overlayCtx = overlay.getContext('2d');
    if (!ctx || !overlayCtx) return;

    let animationId: number;

    const processFrame = () => {
      const video = videoRef.current;
      if (!video || video.videoWidth === 0) {
        animationId = requestAnimationFrame(processFrame);
        return;
      }

      const w = video.videoWidth;
      const h = video.videoHeight;
      canvas.width = w;
      canvas.height = h;
      overlay.width = w;
      overlay.height = h;

      ctx.drawImage(video, 0, 0);
      overlayCtx.clearRect(0, 0, w, h);

      frameCountRef.current++;

      switch (mode) {
        case 'auto-detecting': {
          // Auto-detect dartboard every 5 frames
          if (frameCountRef.current % 5 === 0) {
            const frame = ctx.getImageData(0, 0, w, h);
            
            // Create color mask
            const mask = createDartboardColorMask(frame);
            
            // Clean up mask
            const cleaned = morphologicalClose(mask, w, h, 5);
            
            // Find largest blob
            const blob = findLargestBlob(cleaned, w, h);
            
            if (blob && blob.area > 1000) {
              // Find edge points
              const edges = findEdgePoints(cleaned, w, h, blob);
              
              if (edges.length > 20) {
                // Fit ellipse
                const ellipse = fitEllipse(edges);
                
                if (ellipse) {
                  // Validate and score
                  const quality = validateEllipse(ellipse, w, h);
                  setDetectionQuality(quality);
                  
                  if (quality > 50) {
                    // Stabilize
                    const stable = stabilizeEllipse(ellipse);
                    calibrationRef.current.ellipse = stable;
                    
                    // Draw overlay
                    drawEllipseOverlay(overlayCtx, stable, false, rotationOffset);
                    
                    if (quality > 70) {
                      setFeedback('🎯 Dartscheibe erkannt! Tippe zum Bestätigen');
                    } else {
                      setFeedback('🔍 Dartscheibe wird erkannt...');
                    }
                  }
                }
              }
            } else {
              setFeedback('🔍 Suche Dartscheibe...');
              setDetectionQuality(0);
            }
          } else if (calibrationRef.current.ellipse) {
            // Draw last detected ellipse
            drawEllipseOverlay(overlayCtx, calibrationRef.current.ellipse, false, rotationOffset);
          }
          break;
        }

        case 'manual-adjust': {
          // Draw manual ellipse
          drawEllipseOverlay(overlayCtx, manualEllipse, false, rotationOffset);
          setFeedback('✋ Ellipse manuell anpassen');
          break;
        }

        case 'confirming': {
          // Show confirmed ellipse
          const ellipse = calibrationRef.current.ellipse || manualEllipse;
          drawEllipseOverlay(overlayCtx, ellipse, false, rotationOffset);
          setFeedback('Kalibrierung bestätigt - Referenzbild wird erstellt...');
          
          // Capture reference frame
          referenceFrameRef.current = ctx.getImageData(0, 0, w, h);
          
          // Save calibration
          calibrationRef.current = {
            ellipse,
            isCalibrated: true,
            rotationOffset
          };
          
          setMode('active');
          setFeedback('✅ Bereit! Wirf deinen Dart!');
          setTimeout(() => setFeedback(''), 2000);
          break;
        }

        case 'active': {
          const ellipse = calibrationRef.current.ellipse;
          if (!ellipse || !referenceFrameRef.current) {
            setMode('auto-detecting');
            break;
          }
          
          // Draw dartboard overlay
          drawEllipseOverlay(overlayCtx, ellipse, true, calibrationRef.current.rotationOffset);
          
          // Check cooldown
          const now = Date.now();
          if (now - lastDartTimeRef.current < DART_DETECTION_COOLDOWN) {
            break;
          }
          
          // Detect dart
          if (frameCountRef.current % 2 === 0) {
            const frame = ctx.getImageData(0, 0, w, h);
            const dartTip = detectDartInDifference(frame, referenceFrameRef.current, ellipse);
            
            if (dartTip) {
              const polar = pointToEllipsePolar(dartTip, ellipse);
              const score = polarToScore(polar);
              
              if (score.points > 0) {
                const hit: DartHit = {
                  x: dartTip.x,
                  y: dartTip.y,
                  polar,
                  ...score,
                  timestamp: now
                };
                
                sendHitToDesktop(hit);
                lastDartTimeRef.current = now;
                setHitCount(prev => prev + 1);
                setLastHit(hit);
                
                const mult = score.multiplier === 3 ? 'T' : score.multiplier === 2 ? 'D' : '';
                setFeedback(`🎯 ${mult}${score.value} = ${score.points} Punkte!`);
                
                drawHitMarker(overlayCtx, dartTip, score);
                
                // Update reference after delay
                setTimeout(() => {
                  if (videoRef.current && canvasRef.current) {
                    const tempCtx = canvasRef.current.getContext('2d');
                    if (tempCtx) {
                      tempCtx.drawImage(videoRef.current, 0, 0);
                      referenceFrameRef.current = tempCtx.getImageData(0, 0, w, h);
                    }
                  }
                  setFeedback('');
                }, 2500);
              }
            }
          }
          break;
        }
      }

      animationId = requestAnimationFrame(processFrame);
    };

    animationId = requestAnimationFrame(processFrame);
    return () => cancelAnimationFrame(animationId);
  }, [
    cameraActive, mode, rotationOffset, manualEllipse,
    createDartboardColorMask, morphologicalClose, findLargestBlob, findEdgePoints,
    fitEllipse, validateEllipse, stabilizeEllipse, drawEllipseOverlay, drawHitMarker,
    detectDartInDifference, pointToEllipsePolar, polarToScore, sendHitToDesktop
  ]);

  // ============ UI HANDLERS ============

  const handleConfirmCalibration = () => {
    if (mode === 'auto-detecting' && calibrationRef.current.ellipse) {
      setMode('confirming');
    } else if (mode === 'manual-adjust') {
      calibrationRef.current.ellipse = manualEllipse;
      setMode('confirming');
    }
  };

  const handleManualMode = () => {
    const video = videoRef.current;
    if (video) {
      setManualEllipse({
        centerX: video.videoWidth / 2,
        centerY: video.videoHeight / 2,
        radiusX: Math.min(video.videoWidth, video.videoHeight) * 0.35,
        radiusY: Math.min(video.videoWidth, video.videoHeight) * 0.35,
        rotation: 0
      });
    }
    setMode('manual-adjust');
  };

  const handleReset = () => {
    calibrationRef.current = { ellipse: null, isCalibrated: false, rotationOffset: 0 };
    referenceFrameRef.current = null;
    detectionHistoryRef.current = [];
    setMode('auto-detecting');
    setDetectionQuality(0);
    setFeedback('🔍 Suche Dartscheibe...');
  };

  const adjustManualEllipse = (prop: keyof Ellipse, delta: number) => {
    setManualEllipse(prev => ({
      ...prev,
      [prop]: prev[prop] + delta
    }));
  };

  // ============ RENDER ============

  return (
    <div className="h-screen w-screen bg-black flex flex-col overflow-hidden">
      {/* Header */}
      <div className="bg-gray-900 px-4 py-2 flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-2">
          <Camera size={20} className="text-accent" />
          <span className="text-white font-bold text-sm">Dart Camera V3</span>
          {detectionQuality > 0 && mode === 'auto-detecting' && (
            <span className={`text-xs px-2 py-0.5 rounded ${
              detectionQuality > 70 ? 'bg-green-600' : detectionQuality > 50 ? 'bg-yellow-600' : 'bg-red-600'
            }`}>
              {Math.round(detectionQuality)}%
            </span>
          )}
        </div>
        <div className="flex items-center gap-3">
          {isConnected ? (
            <Wifi size={18} className="text-green-500" />
          ) : (
            <WifiOff size={18} className="text-red-500" />
          )}
          <span className="text-green-400 font-mono text-sm">{hitCount} Hits</span>
        </div>
      </div>

      {/* Video Container */}
      <div className="flex-1 relative bg-black overflow-hidden">
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className="w-full h-full object-cover"
        />
        <canvas ref={canvasRef} className="hidden" />
        <canvas
          ref={overlayCanvasRef}
          className="absolute inset-0 w-full h-full pointer-events-none"
        />
        
        {/* Feedback */}
        {feedback && (
          <div className={`absolute top-2 left-2 right-2 px-4 py-2 rounded-lg text-center font-bold text-sm ${
            mode === 'active' ? 'bg-green-600 text-white' : 'bg-yellow-500 text-black'
          }`}>
            {feedback}
          </div>
        )}
        
        {/* Last hit display */}
        {lastHit && mode === 'active' && (
          <div className="absolute bottom-20 left-4 right-4 bg-gray-900/90 text-white px-4 py-3 rounded-lg">
            <div className="text-center">
              <span className="text-2xl font-bold text-yellow-400">
                {lastHit.multiplier === 3 ? 'T' : lastHit.multiplier === 2 ? 'D' : ''}{lastHit.value}
              </span>
              <span className="text-xl ml-2">= {lastHit.points} Punkte</span>
            </div>
          </div>
        )}
      </div>

      {/* Manual Adjustment Controls */}
      {mode === 'manual-adjust' && (
        <div className="bg-gray-900 px-4 py-3 border-t border-gray-700 space-y-3 flex-shrink-0">
          <div className="grid grid-cols-3 gap-2">
            <button onClick={() => adjustManualEllipse('centerX', -10)} className="p-2 bg-gray-700 rounded">
              <Move size={16} className="mx-auto" /> ←
            </button>
            <button onClick={() => adjustManualEllipse('centerY', -10)} className="p-2 bg-gray-700 rounded">
              <Move size={16} className="mx-auto" /> ↑
            </button>
            <button onClick={() => adjustManualEllipse('centerX', 10)} className="p-2 bg-gray-700 rounded">
              <Move size={16} className="mx-auto" /> →
            </button>
            <button onClick={() => adjustManualEllipse('radiusX', -10)} className="p-2 bg-gray-700 rounded">
              <ZoomOut size={16} className="mx-auto" /> W
            </button>
            <button onClick={() => adjustManualEllipse('centerY', 10)} className="p-2 bg-gray-700 rounded">
              <Move size={16} className="mx-auto" /> ↓
            </button>
            <button onClick={() => adjustManualEllipse('radiusX', 10)} className="p-2 bg-gray-700 rounded">
              <ZoomIn size={16} className="mx-auto" /> W
            </button>
          </div>
          <div className="flex gap-2">
            <button onClick={() => adjustManualEllipse('radiusY', -10)} className="flex-1 p-2 bg-gray-700 rounded text-sm">
              <ZoomOut size={14} className="inline mr-1" /> Höhe
            </button>
            <button onClick={() => adjustManualEllipse('radiusY', 10)} className="flex-1 p-2 bg-gray-700 rounded text-sm">
              <ZoomIn size={14} className="inline mr-1" /> Höhe
            </button>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-white text-sm">20 bei:</span>
            <input
              type="range"
              min="0"
              max="360"
              value={rotationOffset}
              onChange={(e) => setRotationOffset(parseInt(e.target.value))}
              className="flex-1"
            />
            <span className="text-white text-sm w-12">{rotationOffset}°</span>
          </div>
        </div>
      )}

      {/* Footer Controls */}
      <div className="bg-gray-900 px-4 py-3 border-t border-gray-700 flex-shrink-0">
        {mode === 'auto-detecting' && (
          <div className="flex gap-2">
            <button
              onClick={handleConfirmCalibration}
              disabled={detectionQuality < 50}
              className="flex-1 py-3 bg-green-600 hover:bg-green-700 disabled:bg-gray-600 disabled:text-gray-400 text-white font-bold rounded-lg flex items-center justify-center gap-2"
            >
              <Check size={18} /> Bestätigen
            </button>
            <button
              onClick={handleManualMode}
              className="flex-1 py-3 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-lg flex items-center justify-center gap-2"
            >
              <Target size={18} /> Manuell
            </button>
          </div>
        )}
        
        {mode === 'manual-adjust' && (
          <div className="flex gap-2">
            <button
              onClick={handleConfirmCalibration}
              className="flex-1 py-3 bg-green-600 hover:bg-green-700 text-white font-bold rounded-lg flex items-center justify-center gap-2"
            >
              <Check size={18} /> Bestätigen
            </button>
            <button
              onClick={handleReset}
              className="py-3 px-4 bg-gray-600 hover:bg-gray-500 text-white font-medium rounded-lg"
            >
              <RotateCcw size={18} />
            </button>
          </div>
        )}
        
        {mode === 'active' && (
          <div className="flex gap-2">
            <button
              onClick={handleReset}
              className="flex-1 py-3 bg-gray-700 hover:bg-gray-600 text-white font-medium rounded-lg flex items-center justify-center gap-2"
            >
              <RotateCcw size={18} /> Neu kalibrieren
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export default MobileCameraV3;
