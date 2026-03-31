import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Camera, Wifi, WifiOff, RotateCcw, Check, Target, ZoomIn, ZoomOut, Move } from 'lucide-react';
import { detectDartboardEllipse } from './cv/dartboardDetection';

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
const BOARD_DETECTION_INTERVAL = 3;
const BOARD_DETECTION_MAX_SIDE = 720;
const BOARD_CONFIRM_THRESHOLD = 40;

// ============ COMPONENT ============
function MobileCameraV3() {
  // Refs
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null);
  const detectionCanvasRef = useRef<HTMLCanvasElement | null>(null);
  
  // State
  const [cameraActive, setCameraActive] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [mode, setMode] = useState<CalibrationMode>('auto-detecting');
  const [feedback, setFeedback] = useState('');
  const [hitCount, setHitCount] = useState(0);
  const [lastHit, setLastHit] = useState<DartHit | null>(null);
  const [detectionQuality, setDetectionQuality] = useState(0);
  const [detectionStats, setDetectionStats] = useState({ edge: 0, ring: 0, pattern: 0 });
  
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
  const smoothedEllipseRef = useRef<Ellipse | null>(null);
  const detectionMissesRef = useRef(0);

  // ============ DARTBOARD DETECTION HELPERS ============

  const blendAngle = (from: number, to: number, alpha: number): number => {
    const delta = Math.atan2(Math.sin(to - from), Math.cos(to - from));
    return from + delta * alpha;
  };

  const stabilizeEllipse = useCallback((newEllipse: Ellipse): Ellipse => {
    const history = detectionHistoryRef.current;
    history.push(newEllipse);
    while (history.length > 12) {
      history.shift();
    }

    const previous = smoothedEllipseRef.current;
    if (!previous) {
      smoothedEllipseRef.current = newEllipse;
      return newEllipse;
    }

    const averageRadius = (previous.radiusX + previous.radiusY) / 2;
    const centerJump = Math.hypot(
      newEllipse.centerX - previous.centerX,
      newEllipse.centerY - previous.centerY,
    ) / Math.max(averageRadius, 1);

    const alpha = centerJump > 0.25 ? 0.2 : 0.35;

    const stabilized: Ellipse = {
      centerX: previous.centerX + (newEllipse.centerX - previous.centerX) * alpha,
      centerY: previous.centerY + (newEllipse.centerY - previous.centerY) * alpha,
      radiusX: previous.radiusX + (newEllipse.radiusX - previous.radiusX) * alpha,
      radiusY: previous.radiusY + (newEllipse.radiusY - previous.radiusY) * alpha,
      rotation: blendAngle(previous.rotation, newEllipse.rotation, alpha),
    };

    smoothedEllipseRef.current = stabilized;
    return stabilized;
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
          if (frameCountRef.current % BOARD_DETECTION_INTERVAL === 0) {
            const detectionCanvas = detectionCanvasRef.current ?? document.createElement('canvas');
            detectionCanvasRef.current = detectionCanvas;

            const detectionCtx = detectionCanvas.getContext('2d', { willReadFrequently: true });
            if (detectionCtx) {
              const scale = Math.min(1, BOARD_DETECTION_MAX_SIDE / Math.max(w, h));
              const detectW = Math.max(240, Math.round(w * scale));
              const detectH = Math.max(240, Math.round(h * scale));

              if (detectionCanvas.width !== detectW || detectionCanvas.height !== detectH) {
                detectionCanvas.width = detectW;
                detectionCanvas.height = detectH;
              }

              detectionCtx.drawImage(video, 0, 0, detectW, detectH);
              const detectionFrame = detectionCtx.getImageData(0, 0, detectW, detectH);

              const previousScaled = calibrationRef.current.ellipse
                ? {
                    centerX: calibrationRef.current.ellipse.centerX * scale,
                    centerY: calibrationRef.current.ellipse.centerY * scale,
                    radiusX: calibrationRef.current.ellipse.radiusX * scale,
                    radiusY: calibrationRef.current.ellipse.radiusY * scale,
                    rotation: calibrationRef.current.ellipse.rotation,
                  }
                : null;

              const detection = detectDartboardEllipse(detectionFrame, previousScaled);

              if (detection) {
                const invScale = 1 / scale;
                const detectedEllipse: Ellipse = {
                  centerX: detection.ellipse.centerX * invScale,
                  centerY: detection.ellipse.centerY * invScale,
                  radiusX: detection.ellipse.radiusX * invScale,
                  radiusY: detection.ellipse.radiusY * invScale,
                  rotation: detection.ellipse.rotation,
                };

                const stable = stabilizeEllipse(detectedEllipse);
                calibrationRef.current.ellipse = stable;
                detectionMissesRef.current = 0;
                setDetectionQuality(prev => Math.round(prev * 0.45 + detection.quality * 0.55));
                setDetectionStats({
                  edge: detection.edgeScore,
                  ring: detection.ringScore,
                  pattern: detection.patternScore,
                });

                if (detection.quality > 80) {
                  setFeedback('🎯 Dartscheibe sicher erkannt! Tippe auf Bestätigen');
                } else if (detection.quality > 62) {
                  setFeedback('🎯 Dartscheibe erkannt - Kamera kurz ruhig halten');
                } else {
                  setFeedback('🔍 Dartscheibenmuster wird stabilisiert...');
                }
              } else {
                detectionMissesRef.current += 1;
                setDetectionQuality(prev => Math.max(0, prev - 4));
                setDetectionStats(prev => ({
                  edge: prev.edge * 0.92,
                  ring: prev.ring * 0.92,
                  pattern: prev.pattern * 0.92,
                }));

                if (detectionMissesRef.current > 20) {
                  calibrationRef.current.ellipse = null;
                  smoothedEllipseRef.current = null;
                  detectionHistoryRef.current = [];
                }

                if (detectionMissesRef.current > 8) {
                  if (!calibrationRef.current.ellipse) {
                    setFeedback('🔍 Suche Dartscheibenmuster...');
                  } else {
                    setFeedback('⚠️ Dartscheibe nicht stabil im Bild');
                  }
                }
              }
            }
          }

          if (calibrationRef.current.ellipse) {
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
    stabilizeEllipse, drawEllipseOverlay, drawHitMarker,
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
    smoothedEllipseRef.current = null;
    detectionMissesRef.current = 0;
    setMode('auto-detecting');
    setDetectionQuality(0);
    setDetectionStats({ edge: 0, ring: 0, pattern: 0 });
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
          {mode === 'auto-detecting' && (
            <span className="text-[10px] text-gray-300 font-mono bg-black/40 px-1.5 py-0.5 rounded">
              Q{Math.round(detectionQuality)} E{Math.round(detectionStats.edge * 100)} R{Math.round(detectionStats.ring * 100)} P{Math.round(detectionStats.pattern * 100)}
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
              disabled={detectionQuality < BOARD_CONFIRM_THRESHOLD}
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
