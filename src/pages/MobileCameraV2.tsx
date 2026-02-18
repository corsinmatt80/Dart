import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Camera, Wifi, WifiOff, Settings, RotateCcw, Check, RefreshCw, Target } from 'lucide-react';
// @ts-ignore - js-aruco doesn't have types
import * as AR from 'js-aruco';

// ============ TYPES ============
interface Point {
  x: number;
  y: number;
}

interface PolarCoord {
  r: number;      // radius (0-1, normalized to dartboard radius)
  theta: number;  // angle in degrees (0° at top, clockwise)
}

interface DartboardCalibration {
  center: Point;
  radius: number;
  markers: ArucoMarker[];
  isCalibrated: boolean;
}

interface ArucoMarker {
  id: number;
  corners: Point[];
  center: Point;
}

interface DetectedContour {
  points: Point[];
  area: number;
  boundingBox: { x: number; y: number; width: number; height: number };
}

interface Triangle {
  vertices: [Point, Point, Point];
  tip: Point;
  centroid: Point;
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

type CalibrationState = 'detecting-markers' | 'detecting-board' | 'ready' | 'capturing-reference' | 'active';

// ============ CONSTANTS ============
const DART_NUMBERS = [20, 1, 18, 4, 13, 6, 10, 15, 2, 17, 3, 19, 7, 16, 8, 11, 14, 9, 12, 5];
const SEGMENT_ANGLE = 18;

// Ring boundaries (relative to dartboard radius = 1.0)
const DOUBLE_BULL_R = 0.032;
const SINGLE_BULL_R = 0.080;
const TRIPLE_INNER_R = 0.47;
const TRIPLE_OUTER_R = 0.54;
const DOUBLE_INNER_R = 0.89;
const DOUBLE_OUTER_R = 1.0;

// Detection parameters
const MIN_CONTOUR_AREA = 150;
const DIFF_THRESHOLD = 25;
const GAUSSIAN_KERNEL_SIZE = 5;
const DART_DETECTION_COOLDOWN = 2000;

function MobileCameraV2() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null);
  const processingCanvasRef = useRef<HTMLCanvasElement>(null);
  
  const [cameraActive, setCameraActive] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [calibrationState, setCalibrationState] = useState<CalibrationState>('detecting-markers');
  const [feedback, setFeedback] = useState<string>('');
  const [hitCount, setHitCount] = useState(0);
  const [lastHit, setLastHit] = useState<DartHit | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [sensitivity, setSensitivity] = useState(DIFF_THRESHOLD);
  const [minArea, setMinArea] = useState(MIN_CONTOUR_AREA);
  
  const calibrationRef = useRef<DartboardCalibration>({
    center: { x: 0, y: 0 },
    radius: 0,
    markers: [],
    isCalibrated: false
  });
  const referenceFrameRef = useRef<ImageData | null>(null);
  const lastDartTimeRef = useRef<number>(0);
  const arucoDetectorRef = useRef<any>(null);
  const frameCountRef = useRef(0);

  // ============ ARUCO MARKER DETECTION ============
  const initArucoDetector = useCallback(() => {
    try {
      arucoDetectorRef.current = new AR.Detector();
      console.log('ArUco detector initialized');
    } catch (err) {
      console.error('Failed to init ArUco:', err);
    }
  }, []);

  const detectArucoMarkers = useCallback((imageData: ImageData): ArucoMarker[] => {
    if (!arucoDetectorRef.current) return [];
    
    try {
      const markers = arucoDetectorRef.current.detect(imageData);
      return markers.map((m: any) => ({
        id: m.id,
        corners: m.corners.map((c: any) => ({ x: c.x, y: c.y })),
        center: {
          x: m.corners.reduce((sum: number, c: any) => sum + c.x, 0) / 4,
          y: m.corners.reduce((sum: number, c: any) => sum + c.y, 0) / 4
        }
      }));
    } catch (err) {
      return [];
    }
  }, []);

  // ============ CIRCLE DETECTION (Hough Transform) ============
  const detectDartboardCircle = useCallback((
    imageData: ImageData, 
    markers: ArucoMarker[]
  ): { center: Point; radius: number } | null => {
    const { width, height, data } = imageData;
    
    // If we have markers, use them to estimate dartboard position
    if (markers.length >= 2) {
      // Find center from marker positions
      const avgX = markers.reduce((sum, m) => sum + m.center.x, 0) / markers.length;
      const avgY = markers.reduce((sum, m) => sum + m.center.y, 0) / markers.length;
      
      // Estimate radius from marker distances
      const distances = markers.map(m => 
        Math.sqrt(Math.pow(m.center.x - avgX, 2) + Math.pow(m.center.y - avgY, 2))
      );
      const avgDist = distances.reduce((a, b) => a + b, 0) / distances.length;
      
      // Markers are typically placed at ~1.1x dartboard radius
      const estimatedRadius = avgDist / 1.1;
      
      return { center: { x: avgX, y: avgY }, radius: estimatedRadius };
    }
    
    // Fallback: Simple edge-based circle detection
    const edgeMap = computeEdgeMap(data, width, height);
    
    // Accumulator for Hough Circle Transform
    const radiusMin = Math.min(width, height) * 0.15;
    const radiusMax = Math.min(width, height) * 0.45;
    const radiusStep = 5;
    
    let bestScore = 0;
    let bestCenter = { x: width / 2, y: height / 2 };
    let bestRadius = (radiusMin + radiusMax) / 2;
    
    // Coarse search
    const step = 20;
    for (let cy = radiusMax; cy < height - radiusMax; cy += step) {
      for (let cx = radiusMax; cx < width - radiusMax; cx += step) {
        for (let r = radiusMin; r < radiusMax; r += radiusStep) {
          const score = scoreCircle(edgeMap, width, height, cx, cy, r);
          if (score > bestScore) {
            bestScore = score;
            bestCenter = { x: cx, y: cy };
            bestRadius = r;
          }
        }
      }
    }
    
    // Fine-tune around best position
    const fineStep = 5;
    for (let cy = bestCenter.y - step; cy <= bestCenter.y + step; cy += fineStep) {
      for (let cx = bestCenter.x - step; cx <= bestCenter.x + step; cx += fineStep) {
        for (let r = bestRadius - 10; r <= bestRadius + 10; r += 2) {
          const score = scoreCircle(edgeMap, width, height, cx, cy, r);
          if (score > bestScore) {
            bestScore = score;
            bestCenter = { x: cx, y: cy };
            bestRadius = r;
          }
        }
      }
    }
    
    if (bestScore < 50) return null;
    
    return { center: bestCenter, radius: bestRadius };
  }, []);

  // ============ IMAGE PROCESSING UTILITIES ============
  const computeEdgeMap = (data: Uint8ClampedArray, width: number, height: number): Uint8ClampedArray => {
    const edgeMap = new Uint8ClampedArray(width * height);
    
    // Sobel edge detection
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        const idx = y * width + x;
        
        // Get grayscale values
        const getGray = (px: number, py: number) => {
          const i = (py * width + px) * 4;
          return (data[i] + data[i + 1] + data[i + 2]) / 3;
        };
        
        // Sobel kernels
        const gx = -getGray(x-1, y-1) - 2*getGray(x-1, y) - getGray(x-1, y+1)
                  + getGray(x+1, y-1) + 2*getGray(x+1, y) + getGray(x+1, y+1);
        const gy = -getGray(x-1, y-1) - 2*getGray(x, y-1) - getGray(x+1, y-1)
                  + getGray(x-1, y+1) + 2*getGray(x, y+1) + getGray(x+1, y+1);
        
        edgeMap[idx] = Math.min(255, Math.sqrt(gx * gx + gy * gy));
      }
    }
    
    return edgeMap;
  };

  const scoreCircle = (
    edgeMap: Uint8ClampedArray, 
    width: number, 
    height: number,
    cx: number, 
    cy: number, 
    radius: number
  ): number => {
    let score = 0;
    const points = Math.max(36, Math.floor(radius * 0.5));
    
    for (let i = 0; i < points; i++) {
      const angle = (i / points) * Math.PI * 2;
      const px = Math.round(cx + Math.cos(angle) * radius);
      const py = Math.round(cy + Math.sin(angle) * radius);
      
      if (px >= 0 && px < width && py >= 0 && py < height) {
        score += edgeMap[py * width + px];
      }
    }
    
    return score / points;
  };

  const applyGaussianBlur = (imageData: ImageData): ImageData => {
    const { width, height, data } = imageData;
    const output = new Uint8ClampedArray(data.length);
    
    // Simple 5x5 Gaussian kernel (approximated)
    const kernel = [
      1, 4, 6, 4, 1,
      4, 16, 24, 16, 4,
      6, 24, 36, 24, 6,
      4, 16, 24, 16, 4,
      1, 4, 6, 4, 1
    ];
    const kernelSum = 256;
    const halfSize = 2;
    
    for (let y = halfSize; y < height - halfSize; y++) {
      for (let x = halfSize; x < width - halfSize; x++) {
        let r = 0, g = 0, b = 0;
        let ki = 0;
        
        for (let ky = -halfSize; ky <= halfSize; ky++) {
          for (let kx = -halfSize; kx <= halfSize; kx++) {
            const idx = ((y + ky) * width + (x + kx)) * 4;
            const weight = kernel[ki++];
            r += data[idx] * weight;
            g += data[idx + 1] * weight;
            b += data[idx + 2] * weight;
          }
        }
        
        const outIdx = (y * width + x) * 4;
        output[outIdx] = r / kernelSum;
        output[outIdx + 1] = g / kernelSum;
        output[outIdx + 2] = b / kernelSum;
        output[outIdx + 3] = 255;
      }
    }
    
    return new ImageData(output, width, height);
  };

  const computeDifferenceImage = (
    current: ImageData, 
    reference: ImageData
  ): Uint8ClampedArray => {
    const { width, height } = current;
    const diff = new Uint8ClampedArray(width * height);
    
    for (let i = 0; i < current.data.length; i += 4) {
      const pixelIdx = i / 4;
      
      // Grayscale difference
      const gray1 = (current.data[i] + current.data[i+1] + current.data[i+2]) / 3;
      const gray2 = (reference.data[i] + reference.data[i+1] + reference.data[i+2]) / 3;
      
      const d = Math.abs(gray1 - gray2);
      diff[pixelIdx] = d > sensitivity ? 255 : 0;
    }
    
    return diff;
  };

  // ============ CONTOUR DETECTION ============
  const findContours = (
    binaryImage: Uint8ClampedArray, 
    width: number, 
    height: number,
    calibration: DartboardCalibration
  ): DetectedContour[] => {
    const visited = new Uint8ClampedArray(width * height);
    const contours: DetectedContour[] = [];
    
    // Only search within dartboard area
    const { center, radius } = calibration;
    const minX = Math.max(0, Math.floor(center.x - radius * 1.05));
    const maxX = Math.min(width, Math.ceil(center.x + radius * 1.05));
    const minY = Math.max(0, Math.floor(center.y - radius * 1.05));
    const maxY = Math.min(height, Math.ceil(center.y + radius * 1.05));
    
    for (let y = minY; y < maxY; y++) {
      for (let x = minX; x < maxX; x++) {
        const idx = y * width + x;
        
        if (binaryImage[idx] > 0 && !visited[idx]) {
          // Check if within dartboard
          const dx = x - center.x;
          const dy = y - center.y;
          if (Math.sqrt(dx*dx + dy*dy) > radius * 1.05) continue;
          
          // Flood fill to find contour
          const contourPoints: Point[] = [];
          const stack: Point[] = [{ x, y }];
          let minBx = x, maxBx = x, minBy = y, maxBy = y;
          
          while (stack.length > 0) {
            const p = stack.pop()!;
            const pIdx = p.y * width + p.x;
            
            if (p.x < 0 || p.x >= width || p.y < 0 || p.y >= height) continue;
            if (visited[pIdx] || binaryImage[pIdx] === 0) continue;
            
            visited[pIdx] = 1;
            contourPoints.push(p);
            
            minBx = Math.min(minBx, p.x);
            maxBx = Math.max(maxBx, p.x);
            minBy = Math.min(minBy, p.y);
            maxBy = Math.max(maxBy, p.y);
            
            // 8-connectivity
            stack.push({ x: p.x + 1, y: p.y });
            stack.push({ x: p.x - 1, y: p.y });
            stack.push({ x: p.x, y: p.y + 1 });
            stack.push({ x: p.x, y: p.y - 1 });
            stack.push({ x: p.x + 1, y: p.y + 1 });
            stack.push({ x: p.x - 1, y: p.y - 1 });
            stack.push({ x: p.x + 1, y: p.y - 1 });
            stack.push({ x: p.x - 1, y: p.y + 1 });
          }
          
          if (contourPoints.length >= minArea) {
            contours.push({
              points: contourPoints,
              area: contourPoints.length,
              boundingBox: {
                x: minBx,
                y: minBy,
                width: maxBx - minBx,
                height: maxBy - minBy
              }
            });
          }
        }
      }
    }
    
    return contours;
  };

  // ============ TRIANGLE FITTING ============
  const fitTriangleToContour = (contour: DetectedContour): Triangle | null => {
    const { points, boundingBox } = contour;
    if (points.length < 10) return null;
    
    // Find convex hull points (simplified: use extremes)
    let topPoint = points[0];
    let bottomPoint = points[0];
    let leftPoint = points[0];
    let rightPoint = points[0];
    
    for (const p of points) {
      if (p.y < topPoint.y) topPoint = p;
      if (p.y > bottomPoint.y) bottomPoint = p;
      if (p.x < leftPoint.x) leftPoint = p;
      if (p.x > rightPoint.x) rightPoint = p;
    }
    
    // Find three most distant points (approximate triangle vertices)
    const extremePoints = [topPoint, bottomPoint, leftPoint, rightPoint];
    const uniquePoints: Point[] = [];
    
    for (const p of extremePoints) {
      if (!uniquePoints.some(up => Math.abs(up.x - p.x) < 5 && Math.abs(up.y - p.y) < 5)) {
        uniquePoints.push(p);
      }
    }
    
    // If we don't have 3 distinct points, use bounding box corners
    if (uniquePoints.length < 3) {
      // Find the three most extremal points from contour
      const sortedByY = [...points].sort((a, b) => a.y - b.y);
      const top = sortedByY[0];
      const bottom = sortedByY[sortedByY.length - 1];
      
      // Find point furthest from line between top and bottom
      let maxDist = 0;
      let thirdPoint = points[0];
      
      for (const p of points) {
        const dist = pointToLineDistance(p, top, bottom);
        if (dist > maxDist) {
          maxDist = dist;
          thirdPoint = p;
        }
      }
      
      uniquePoints.length = 0;
      uniquePoints.push(top, bottom, thirdPoint);
    }
    
    const vertices: [Point, Point, Point] = [
      uniquePoints[0] || topPoint,
      uniquePoints[1] || bottomPoint,
      uniquePoints[2] || leftPoint
    ];
    
    // Find the shortest side and its opposite corner (the tip)
    const sides = [
      { length: distance(vertices[0], vertices[1]), oppositeIdx: 2 },
      { length: distance(vertices[1], vertices[2]), oppositeIdx: 0 },
      { length: distance(vertices[2], vertices[0]), oppositeIdx: 1 }
    ];
    
    sides.sort((a, b) => a.length - b.length);
    const tipVertex = vertices[sides[0].oppositeIdx];
    
    // Calculate centroid
    const centroid = {
      x: (vertices[0].x + vertices[1].x + vertices[2].x) / 3,
      y: (vertices[0].y + vertices[1].y + vertices[2].y) / 3
    };
    
    // Correct tip position: move towards centroid based on triangle size
    const triangleSize = Math.sqrt(contour.area);
    const correctionFactor = 0.15; // Move tip 15% towards centroid
    
    const correctedTip = {
      x: tipVertex.x + (centroid.x - tipVertex.x) * correctionFactor,
      y: tipVertex.y + (centroid.y - tipVertex.y) * correctionFactor
    };
    
    return {
      vertices,
      tip: correctedTip,
      centroid
    };
  };

  const distance = (p1: Point, p2: Point): number => {
    return Math.sqrt(Math.pow(p2.x - p1.x, 2) + Math.pow(p2.y - p1.y, 2));
  };

  const pointToLineDistance = (point: Point, lineStart: Point, lineEnd: Point): number => {
    const A = point.x - lineStart.x;
    const B = point.y - lineStart.y;
    const C = lineEnd.x - lineStart.x;
    const D = lineEnd.y - lineStart.y;
    
    const dot = A * C + B * D;
    const lenSq = C * C + D * D;
    
    if (lenSq === 0) return distance(point, lineStart);
    
    const param = dot / lenSq;
    
    let xx, yy;
    if (param < 0) {
      xx = lineStart.x;
      yy = lineStart.y;
    } else if (param > 1) {
      xx = lineEnd.x;
      yy = lineEnd.y;
    } else {
      xx = lineStart.x + param * C;
      yy = lineStart.y + param * D;
    }
    
    return distance(point, { x: xx, y: yy });
  };

  // ============ POLAR COORDINATE CONVERSION ============
  const cartesianToPolar = (point: Point, calibration: DartboardCalibration): PolarCoord => {
    const { center, radius } = calibration;
    
    const dx = point.x - center.x;
    const dy = point.y - center.y;
    
    const r = Math.sqrt(dx * dx + dy * dy) / radius;
    
    // Angle: 0° at top, clockwise
    let theta = Math.atan2(dx, -dy) * (180 / Math.PI);
    if (theta < 0) theta += 360;
    
    return { r, theta };
  };

  const polarToScore = (polar: PolarCoord): { value: number; multiplier: number; points: number } => {
    const { r, theta } = polar;
    
    // Outside board
    if (r > DOUBLE_OUTER_R) {
      return { value: 0, multiplier: 0, points: 0 };
    }
    
    // Bulls
    if (r <= DOUBLE_BULL_R) {
      return { value: 50, multiplier: 1, points: 50 };
    }
    if (r <= SINGLE_BULL_R) {
      return { value: 25, multiplier: 1, points: 25 };
    }
    
    // Segment number
    const adjustedTheta = (theta + SEGMENT_ANGLE / 2) % 360;
    const segmentIdx = Math.floor(adjustedTheta / SEGMENT_ANGLE);
    const value = DART_NUMBERS[segmentIdx];
    
    // Multiplier
    let multiplier = 1;
    if (r >= TRIPLE_INNER_R && r <= TRIPLE_OUTER_R) {
      multiplier = 3;
    } else if (r >= DOUBLE_INNER_R && r <= DOUBLE_OUTER_R) {
      multiplier = 2;
    }
    
    return { value, multiplier, points: value * multiplier };
  };

  // ============ CAMERA INITIALIZATION ============
  useEffect(() => {
    initArucoDetector();
    
    const startCamera = async () => {
      try {
        if (window.location.protocol !== 'https:' && window.location.hostname !== 'localhost') {
          setFeedback('⚠️ HTTPS erforderlich');
          return;
        }

        const stream = await navigator.mediaDevices.getUserMedia({
          video: { 
            facingMode: 'environment', 
            width: { ideal: 1920 }, 
            height: { ideal: 1080 },
            frameRate: { ideal: 30 }
          },
        });
        
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
          setCameraActive(true);
          setIsConnected(true);
          setFeedback('📷 Kamera aktiv - ArUco Marker werden gesucht...');
        }
      } catch (err) {
        setIsConnected(false);
        console.error('Camera error:', err);
        setFeedback('❌ Kamera-Fehler');
      }
    };

    startCamera();

    return () => {
      if (videoRef.current?.srcObject) {
        const tracks = (videoRef.current.srcObject as MediaStream).getTracks();
        tracks.forEach(track => track.stop());
      }
    };
  }, [initArucoDetector]);

  // ============ MAIN PROCESSING LOOP ============
  useEffect(() => {
    if (!cameraActive) return;

    const canvas = canvasRef.current;
    const overlay = overlayCanvasRef.current;
    const processing = processingCanvasRef.current;
    if (!canvas || !overlay || !processing) return;

    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const overlayCtx = overlay.getContext('2d');
    const procCtx = processing.getContext('2d', { willReadFrequently: true });
    if (!ctx || !overlayCtx || !procCtx) return;

    let animationId: number;

    const processFrame = () => {
      const video = videoRef.current;
      if (!video || video.videoWidth === 0) {
        animationId = requestAnimationFrame(processFrame);
        return;
      }

      // Set canvas sizes
      const w = video.videoWidth;
      const h = video.videoHeight;
      canvas.width = w;
      canvas.height = h;
      overlay.width = w;
      overlay.height = h;
      processing.width = w;
      processing.height = h;

      // Draw current frame
      ctx.drawImage(video, 0, 0);
      const currentFrame = ctx.getImageData(0, 0, w, h);

      // Clear overlay
      overlayCtx.clearRect(0, 0, w, h);

      frameCountRef.current++;

      // ===== STATE MACHINE =====
      switch (calibrationState) {
        case 'detecting-markers': {
          // Step 1: Detect ArUco markers
          if (frameCountRef.current % 5 === 0) {
            const markers = detectArucoMarkers(currentFrame);
            calibrationRef.current.markers = markers;
            
            // Draw detected markers
            drawMarkers(overlayCtx, markers);
            
            if (markers.length >= 2) {
              setFeedback(`✅ ${markers.length} Marker erkannt - Erkenne Dartscheibe...`);
              setCalibrationState('detecting-board');
            } else if (markers.length === 1) {
              setFeedback(`🔍 1 Marker erkannt - mind. 2 benötigt`);
            } else {
              setFeedback('🔍 Suche ArUco Marker... (oder manuell kalibrieren)');
            }
          }
          break;
        }

        case 'detecting-board': {
          // Step 2: Detect dartboard circle
          if (frameCountRef.current % 3 === 0) {
            const detection = detectDartboardCircle(currentFrame, calibrationRef.current.markers);
            
            if (detection) {
              calibrationRef.current.center = detection.center;
              calibrationRef.current.radius = detection.radius;
              calibrationRef.current.isCalibrated = true;
              
              drawDartboardOverlay(overlayCtx, calibrationRef.current, false);
              setFeedback('🎯 Dartscheibe erkannt - Bestätige Kalibrierung');
              setCalibrationState('ready');
            }
          }
          break;
        }

        case 'ready': {
          // Show detected dartboard, wait for confirmation
          drawDartboardOverlay(overlayCtx, calibrationRef.current, false);
          drawMarkers(overlayCtx, calibrationRef.current.markers);
          break;
        }

        case 'capturing-reference': {
          // Step 3: Capture reference frame
          const blurred = applyGaussianBlur(currentFrame);
          referenceFrameRef.current = blurred;
          setCalibrationState('active');
          setFeedback('✅ Referenzbild gespeichert - Bereit für Darts!');
          setTimeout(() => setFeedback(''), 2000);
          break;
        }

        case 'active': {
          // Step 4-11: Active dart detection
          if (referenceFrameRef.current && frameCountRef.current % 2 === 0) {
            const now = Date.now();
            if (now - lastDartTimeRef.current < DART_DETECTION_COOLDOWN) {
              drawDartboardOverlay(overlayCtx, calibrationRef.current, true);
              break;
            }

            // Apply blur to current frame
            const blurredCurrent = applyGaussianBlur(currentFrame);
            
            // Compute difference image
            const diffImage = computeDifferenceImage(blurredCurrent, referenceFrameRef.current);
            
            // Find contours
            const contours = findContours(diffImage, w, h, calibrationRef.current);
            
            // Process each significant contour
            for (const contour of contours) {
              if (contour.area < minArea) continue;
              
              // Fit triangle
              const triangle = fitTriangleToContour(contour);
              if (!triangle) continue;
              
              // Get polar coordinates of tip
              const polar = cartesianToPolar(triangle.tip, calibrationRef.current);
              
              // Check if within dartboard
              if (polar.r > 1.05) continue;
              
              // Calculate score
              const score = polarToScore(polar);
              if (score.value === 0) continue;
              
              // Create hit
              const hit: DartHit = {
                x: triangle.tip.x,
                y: triangle.tip.y,
                polar,
                ...score,
                timestamp: now
              };
              
              // Send hit
              sendHitToDesktop(hit);
              lastDartTimeRef.current = now;
              setHitCount(prev => prev + 1);
              setLastHit(hit);
              
              const mult = score.multiplier === 3 ? 'T' : score.multiplier === 2 ? 'D' : '';
              setFeedback(`🎯 ${mult}${score.value} = ${score.points} Punkte!`);
              
              // Draw detection
              drawTriangle(overlayCtx, triangle);
              drawHitMarker(overlayCtx, triangle.tip);
              
              // Update reference after a delay
              setTimeout(() => {
                if (videoRef.current && canvasRef.current) {
                  const tempCtx = canvasRef.current.getContext('2d');
                  if (tempCtx) {
                    tempCtx.drawImage(videoRef.current, 0, 0);
                    const newRef = tempCtx.getImageData(0, 0, w, h);
                    referenceFrameRef.current = applyGaussianBlur(newRef);
                  }
                }
                setFeedback('');
              }, 2500);
              
              break; // Only process one dart per frame
            }
          }
          
          drawDartboardOverlay(overlayCtx, calibrationRef.current, true);
          break;
        }
      }

      animationId = requestAnimationFrame(processFrame);
    };

    animationId = requestAnimationFrame(processFrame);
    return () => cancelAnimationFrame(animationId);
  }, [cameraActive, calibrationState, detectArucoMarkers, detectDartboardCircle, sensitivity, minArea]);

  // ============ DRAWING FUNCTIONS ============
  const drawMarkers = (ctx: CanvasRenderingContext2D, markers: ArucoMarker[]) => {
    for (const marker of markers) {
      ctx.strokeStyle = '#00ff00';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(marker.corners[0].x, marker.corners[0].y);
      for (let i = 1; i < marker.corners.length; i++) {
        ctx.lineTo(marker.corners[i].x, marker.corners[i].y);
      }
      ctx.closePath();
      ctx.stroke();
      
      ctx.fillStyle = '#00ff00';
      ctx.font = 'bold 16px Arial';
      ctx.fillText(`ID: ${marker.id}`, marker.center.x - 15, marker.center.y - 10);
    }
  };

  const drawDartboardOverlay = (
    ctx: CanvasRenderingContext2D, 
    cal: DartboardCalibration,
    isActive: boolean
  ) => {
    const { center, radius } = cal;
    const color = isActive ? 'rgba(0, 255, 0' : 'rgba(255, 255, 0';
    
    // Outer circle
    ctx.strokeStyle = `${color}, 0.7)`;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(center.x, center.y, radius, 0, Math.PI * 2);
    ctx.stroke();
    
    // Ring circles
    const rings = [DOUBLE_INNER_R, TRIPLE_OUTER_R, TRIPLE_INNER_R, SINGLE_BULL_R, DOUBLE_BULL_R];
    ctx.strokeStyle = `${color}, 0.4)`;
    ctx.lineWidth = 1;
    for (const r of rings) {
      ctx.beginPath();
      ctx.arc(center.x, center.y, radius * r, 0, Math.PI * 2);
      ctx.stroke();
    }
    
    // Segment lines
    for (let i = 0; i < 20; i++) {
      const angle = (i * SEGMENT_ANGLE - 90) * Math.PI / 180;
      ctx.beginPath();
      ctx.moveTo(center.x, center.y);
      ctx.lineTo(
        center.x + Math.cos(angle) * radius,
        center.y + Math.sin(angle) * radius
      );
      ctx.stroke();
    }
    
    // Numbers
    ctx.fillStyle = `${color}, 0.8)`;
    ctx.font = `bold ${Math.round(radius * 0.08)}px Arial`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    
    for (let i = 0; i < 20; i++) {
      const angle = ((i * SEGMENT_ANGLE) - 90 + SEGMENT_ANGLE / 2) * Math.PI / 180;
      const lx = center.x + Math.cos(angle) * radius * 1.12;
      const ly = center.y + Math.sin(angle) * radius * 1.12;
      ctx.fillText(DART_NUMBERS[i].toString(), lx, ly);
    }
    
    // Center crosshair
    ctx.strokeStyle = `${color}, 0.9)`;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(center.x - 10, center.y);
    ctx.lineTo(center.x + 10, center.y);
    ctx.moveTo(center.x, center.y - 10);
    ctx.lineTo(center.x, center.y + 10);
    ctx.stroke();
  };

  const drawTriangle = (ctx: CanvasRenderingContext2D, triangle: Triangle) => {
    ctx.strokeStyle = 'rgba(255, 165, 0, 0.8)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(triangle.vertices[0].x, triangle.vertices[0].y);
    ctx.lineTo(triangle.vertices[1].x, triangle.vertices[1].y);
    ctx.lineTo(triangle.vertices[2].x, triangle.vertices[2].y);
    ctx.closePath();
    ctx.stroke();
  };

  const drawHitMarker = (ctx: CanvasRenderingContext2D, point: Point) => {
    ctx.fillStyle = 'rgba(255, 0, 0, 0.9)';
    ctx.beginPath();
    ctx.arc(point.x, point.y, 8, 0, Math.PI * 2);
    ctx.fill();
    
    ctx.strokeStyle = 'rgba(255, 255, 0, 0.9)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(point.x, point.y, 15, 0, Math.PI * 2);
    ctx.stroke();
  };

  // ============ ACTIONS ============
  const sendHitToDesktop = (hit: DartHit) => {
    try {
      const hits = JSON.parse(localStorage.getItem('mobile_hits') || '[]');
      hits.push(hit);
      localStorage.setItem('mobile_hits', JSON.stringify(hits));
      window.dispatchEvent(new CustomEvent('dartHit', { detail: hit }));
    } catch (err) {
      console.error('Error sending hit:', err);
    }
  };

  const handleConfirmCalibration = () => {
    setCalibrationState('capturing-reference');
  };

  const handleManualCalibration = () => {
    // Set default center
    const video = videoRef.current;
    if (video) {
      calibrationRef.current = {
        center: { x: video.videoWidth / 2, y: video.videoHeight / 2 },
        radius: Math.min(video.videoWidth, video.videoHeight) * 0.35,
        markers: [],
        isCalibrated: true
      };
      setCalibrationState('ready');
      setFeedback('📍 Manuelle Kalibrierung - passe Position an');
    }
  };

  const handleReset = () => {
    setCalibrationState('detecting-markers');
    referenceFrameRef.current = null;
    calibrationRef.current = {
      center: { x: 0, y: 0 },
      radius: 0,
      markers: [],
      isCalibrated: false
    };
    setFeedback('🔄 Zurückgesetzt - ArUco Marker werden gesucht...');
  };

  const handleNewReference = () => {
    setCalibrationState('capturing-reference');
    setFeedback('📸 Neues Referenzbild wird aufgenommen...');
  };

  // ============ RENDER ============
  return (
    <div className="w-full h-screen bg-black flex flex-col select-none">
      {/* Header */}
      <div className="bg-gray-900 px-4 py-3 border-b border-gray-700 flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-2">
          <Camera size={22} className="text-red-500" />
          <h1 className="text-white font-bold text-lg">Dart Recognition Pro</h1>
        </div>
        <div className="flex items-center gap-3">
          {isConnected ? <Wifi size={18} className="text-green-500" /> : <WifiOff size={18} className="text-red-500" />}
          <span className="text-green-400 font-mono text-sm">{hitCount} Hits</span>
          <button onClick={() => setShowSettings(!showSettings)} className="p-1.5 bg-gray-800 rounded-lg">
            <Settings size={18} className={showSettings ? "text-yellow-400" : "text-gray-400"} />
          </button>
        </div>
      </div>

      {/* Settings */}
      {showSettings && (
        <div className="bg-gray-800 px-4 py-3 border-b border-gray-700 flex-shrink-0 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-white text-sm">Diff-Schwelle:</span>
            <div className="flex items-center gap-2">
              <input type="range" min="10" max="60" value={sensitivity} onChange={(e) => setSensitivity(Number(e.target.value))} className="w-24" />
              <span className="text-gray-400 text-sm w-6">{sensitivity}</span>
            </div>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-white text-sm">Min. Fläche:</span>
            <div className="flex items-center gap-2">
              <input type="range" min="50" max="500" step="50" value={minArea} onChange={(e) => setMinArea(Number(e.target.value))} className="w-24" />
              <span className="text-gray-400 text-sm w-8">{minArea}</span>
            </div>
          </div>
        </div>
      )}

      {/* Video */}
      <div className="flex-1 relative bg-black overflow-hidden">
        <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-cover" />
        <canvas ref={canvasRef} className="hidden" />
        <canvas ref={processingCanvasRef} className="hidden" />
        <canvas ref={overlayCanvasRef} className="absolute inset-0 w-full h-full pointer-events-none" />

        {/* Status */}
        {feedback && (
          <div className={`absolute top-2 left-2 right-2 px-4 py-2 rounded-lg text-center font-bold text-sm ${
            calibrationState === 'active' ? 'bg-blue-600 text-white' : 'bg-yellow-500 text-black'
          }`}>
            {feedback}
          </div>
        )}

        {/* Last Hit */}
        {lastHit && calibrationState === 'active' && (
          <div className="absolute bottom-20 left-4 right-4 bg-gray-900/90 text-white px-4 py-3 rounded-lg">
            <div className="text-center">
              <span className="text-2xl font-bold text-yellow-400">
                {lastHit.multiplier === 3 ? 'T' : lastHit.multiplier === 2 ? 'D' : ''}{lastHit.value}
              </span>
              <span className="text-xl ml-2">= {lastHit.points} Punkte</span>
              <div className="text-xs text-gray-400 mt-1">
                r={lastHit.polar.r.toFixed(2)}, θ={lastHit.polar.theta.toFixed(1)}°
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Controls */}
      <div className="bg-gray-900 px-4 py-3 border-t border-gray-700 flex-shrink-0">
        {calibrationState === 'detecting-markers' && (
          <button onClick={handleManualCalibration} className="w-full py-3 bg-yellow-600 hover:bg-yellow-700 text-white font-bold rounded-lg flex items-center justify-center gap-2">
            <Target size={20} />
            Manuell kalibrieren (ohne Marker)
          </button>
        )}

        {calibrationState === 'ready' && (
          <button onClick={handleConfirmCalibration} className="w-full py-3 bg-green-600 hover:bg-green-700 text-white font-bold rounded-lg flex items-center justify-center gap-2">
            <Check size={20} />
            Kalibrierung bestätigen & Referenzbild aufnehmen
          </button>
        )}

        {calibrationState === 'active' && (
          <div className="flex gap-3">
            <button onClick={handleNewReference} className="flex-1 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg flex items-center justify-center gap-2">
              <RefreshCw size={18} />
              Neues Referenzbild
            </button>
            <button onClick={handleReset} className="flex-1 py-2.5 bg-gray-700 hover:bg-gray-600 text-white font-medium rounded-lg flex items-center justify-center gap-2">
              <RotateCcw size={18} />
              Reset
            </button>
          </div>
        )}

        {(calibrationState === 'detecting-board') && (
          <div className="text-center text-gray-400 text-sm py-2">
            Erkenne Dartscheibe...
          </div>
        )}
      </div>
    </div>
  );
}

export default MobileCameraV2;
