import React, { useEffect, useRef, useState } from 'react';
import { Camera, X, Wifi, WifiOff, Settings } from 'lucide-react';

interface DartboardParams {
  centerX: number;
  centerY: number;
  radius: number;
  confidence: number;
}

interface DartDetection {
  x: number;
  y: number;
  radius: number;
  confidence: number;
  timestamp: number;
}

interface CalibrationPoint {
  x: number;
  y: number;
  label: string;
}

function MobileCameraV2() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null);
  
  const [cameraActive, setCameraActive] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [calibrating, setCalibrating] = useState(true);
  const [calibrationStage, setCalibrationStage] = useState(0);
  const [feedback, setFeedback] = useState<string>('');
  const [hitCount, setHitCount] = useState(0);
  
  const dartboardRef = useRef<DartboardParams | null>(null);
  const calibrationPointsRef = useRef<CalibrationPoint[]>([]);
  const lastDartDetectionRef = useRef<number>(0);
  const previousFrameRef = useRef<ImageData | null>(null);
  const dartHistoryRef = useRef<DartDetection[]>([]);
  
  // Dartboard calibration points (20 segments)
  const DART_NUMBERS = [20, 1, 18, 4, 13, 6, 10, 15, 2, 17, 3, 19, 7, 16, 8, 11, 14, 9, 12, 5];
  const SEGMENT_ANGLE = 360 / 20; // 18 degrees per segment
  const BULLSEYE_RADIUS_INNER = 0.05; // 5% of dartboard radius
  const BULLSEYE_RADIUS_OUTER = 0.12; // 12% of dartboard radius
  const SINGLE_BULL_OUTER = 0.15; // Single bull (25)
  const TRIPLE_RING_INNER = 0.32;
  const TRIPLE_RING_OUTER = 0.41;
  const DOUBLE_RING_INNER = 0.93;
  const DOUBLE_RING_OUTER = 1.0;

  // Start camera
  useEffect(() => {
    const startCamera = async () => {
      try {
        if (window.location.protocol !== 'https:' && window.location.hostname !== 'localhost') {
          setFeedback('⚠️ HTTPS required for camera access');
          setIsConnected(false);
          return;
        }

        if (!navigator.mediaDevices?.getUserMedia) {
          setFeedback('❌ Camera not supported');
          setIsConnected(false);
          return;
        }

        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } },
        });
        
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          setCameraActive(true);
          setIsConnected(true);
        }
      } catch (err) {
        setIsConnected(false);
        setFeedback('❌ Camera access denied');
        console.error('Camera error:', err);
      }
    };

    startCamera();

    return () => {
      if (videoRef.current?.srcObject) {
        const tracks = (videoRef.current.srcObject as MediaStream).getTracks();
        tracks.forEach((track) => track.stop());
      }
    };
  }, []);

  // Main detection loop
  useEffect(() => {
    if (!cameraActive || !canvasRef.current || !videoRef.current) return;

    const canvas = canvasRef.current;
    const overlayCanvas = overlayCanvasRef.current;
    const ctx = canvas.getContext('2d');
    const overlayCtx = overlayCanvas?.getContext('2d');

    if (!ctx || !overlayCtx) return;

    let frameCount = 0;

    const processFrame = () => {
      const video = videoRef.current;
      if (!video || video.videoWidth === 0) {
        requestAnimationFrame(processFrame);
        return;
      }

      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      if (overlayCanvas) {
        overlayCanvas.width = video.videoWidth;
        overlayCanvas.height = video.videoHeight;
      }

      ctx.drawImage(video, 0, 0);
      const currentFrame = ctx.getImageData(0, 0, canvas.width, canvas.height);

      if (calibrating) {
        // During calibration: auto-detect dartboard
        frameCount++;
        if (frameCount % 5 === 0) {
          const detected = detectDartboardWithHough(currentFrame);
          if (detected && detected.confidence > 0.6) {
            dartboardRef.current = detected;
            
            // Draw calibration UI
            drawCalibrationOverlay(overlayCtx, overlayCanvas as HTMLCanvasElement, detected);
            setFeedback(`📍 Dartboard detected (confidence: ${(detected.confidence * 100).toFixed(0)}%)`);
          }
        }
      } else if (dartboardRef.current) {
        // During gameplay: detect darts
        frameCount++;
        if (frameCount % 3 === 0) {
          const dartDetections = detectDarts(currentFrame, dartboardRef.current);
          
          // Process new dart detections
          dartDetections.forEach((detection) => {
            const now = Date.now();
            // Debounce: at least 1.5 seconds between hits
            if (now - lastDartDetectionRef.current > 1500) {
              const dartHit = mapDetectionToScore(detection, dartboardRef.current!);
              if (dartHit) {
                sendHitToDesktop(dartHit);
                lastDartDetectionRef.current = now;
                setHitCount((prev) => prev + 1);
                setFeedback(`✅ Hit: ${dartHit.value}${dartHit.multiplier > 1 ? 'x' : ''} (${dartHit.points}pt)`);
                setTimeout(() => setFeedback(''), 2000);
              }
            }
          });
        }

        // Draw gameplay overlay
        drawGameplayOverlay(overlayCtx, overlayCanvas as HTMLCanvasElement, dartboardRef.current);
      }

      previousFrameRef.current = currentFrame;
      requestAnimationFrame(processFrame);
    };

    const animationId = requestAnimationFrame(processFrame);
    return () => cancelAnimationFrame(animationId);
  }, [cameraActive, calibrating]);

  // Hough Circle Detection - improved dartboard detection
  const detectDartboardWithHough = (frame: ImageData): DartboardParams | null => {
    const data = frame.data;
    const width = frame.width;
    const height = frame.height;

    // Edge detection (Canny-like approach)
    const edgeMap = new Uint8ClampedArray(width * height);
    const gradX = new Float32Array(width * height);
    const gradY = new Float32Array(width * height);
    let maxGrad = 0;

    // Sobel filter
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        const idx = y * width + x;
        
        const gx = getSobelGradient(data, x, y, width, true);
        const gy = getSobelGradient(data, x, y, width, false);
        
        gradX[idx] = gx;
        gradY[idx] = gy;
        
        const magnitude = Math.sqrt(gx * gx + gy * gy);
        edgeMap[idx] = Math.min(255, magnitude);
        maxGrad = Math.max(maxGrad, magnitude);
      }
    }

    // Threshold edges
    const threshold = maxGrad * 0.25;
    for (let i = 0; i < edgeMap.length; i++) {
      edgeMap[i] = edgeMap[i] > threshold ? 255 : 0;
    }

    // Hough transform for circles
    const radiusMin = Math.min(width, height) * 0.15;
    const radiusMax = Math.min(width, height) * 0.45;
    const radiusStep = 5;
    
    // Create accumulator space
    const accumulator = new Uint32Array(width * height * Math.ceil((radiusMax - radiusMin) / radiusStep));
    
    // Vote for circles
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const edgeIdx = y * width + x;
        if (edgeMap[edgeIdx] > 0) {
          const gx = gradX[edgeIdx];
          const gy = gradY[edgeIdx];
          const grad = Math.sqrt(gx * gx + gy * gy);
          
          if (grad < 0.01) continue;
          
          // Normalized gradient direction
          const nx = gx / grad;
          const ny = gy / grad;
          
          // Vote along the gradient direction
          for (let r = radiusMin; r < radiusMax; r += radiusStep) {
            const rIdx = Math.floor((r - radiusMin) / radiusStep);
            
            // Center point along gradient
            const cx = Math.round(x - nx * r);
            const cy = Math.round(y - ny * r);
            
            if (cx >= 0 && cx < width && cy >= 0 && cy < height) {
              const accIdx = cy * width * Math.ceil((radiusMax - radiusMin) / radiusStep) + cx * Math.ceil((radiusMax - radiusMin) / radiusStep) + rIdx;
              accumulator[accIdx]++;
            }
          }
        }
      }
    }

    // Find peak in accumulator
    let maxVotes = 0;
    let bestX = width / 2;
    let bestY = height / 2;
    let bestR = radiusMin;

    for (let cy = 0; cy < height; cy++) {
      for (let cx = 0; cx < width; cx++) {
        for (let rIdx = 0; rIdx < Math.ceil((radiusMax - radiusMin) / radiusStep); rIdx++) {
          const accIdx = cy * width * Math.ceil((radiusMax - radiusMin) / radiusStep) + cx * Math.ceil((radiusMax - radiusMin) / radiusStep) + rIdx;
          if (accumulator[accIdx] > maxVotes) {
            maxVotes = accumulator[accIdx];
            bestX = cx;
            bestY = cy;
            bestR = radiusMin + rIdx * radiusStep;
          }
        }
      }
    }

    if (maxVotes < 50) {
      // Fallback to simple detection
      return {
        centerX: width / 2,
        centerY: height / 2,
        radius: Math.min(width, height) * 0.28,
        confidence: 0.4,
      };
    }

    const confidence = Math.min(1, maxVotes / 500);

    return {
      centerX: bestX,
      centerY: bestY,
      radius: bestR,
      confidence,
    };
  };

  // Sobel gradient calculation
  const getSobelGradient = (data: Uint8ClampedArray, x: number, y: number, width: number, isX: boolean): number => {
    const getPixel = (px: number, py: number) => {
      if (px < 0 || px >= width || py < 0 || py >= Math.floor(data.length / 4 / width)) return 127;
      const idx = (py * width + px) * 4;
      return (data[idx] + data[idx + 1] + data[idx + 2]) / 3;
    };

    if (isX) {
      return (
        -getPixel(x - 1, y - 1) - 2 * getPixel(x - 1, y) - getPixel(x - 1, y + 1) +
        getPixel(x + 1, y - 1) + 2 * getPixel(x + 1, y) + getPixel(x + 1, y + 1)
      );
    } else {
      return (
        -getPixel(x - 1, y - 1) - 2 * getPixel(x, y - 1) - getPixel(x + 1, y - 1) +
        getPixel(x - 1, y + 1) + 2 * getPixel(x, y + 1) + getPixel(x + 1, y + 1)
      );
    }
  };

  // Detect darts as circular objects with movement
  const detectDarts = (frame: ImageData, dartboard: DartboardParams): DartDetection[] => {
    const darts: DartDetection[] = [];

    if (!previousFrameRef.current) {
      previousFrameRef.current = frame;
      return darts;
    }

    const data1 = previousFrameRef.current.data;
    const data2 = frame.data;
    const width = frame.width;
    const height = frame.height;

    // Find motion regions within dartboard
    const motionMap = new Uint8ClampedArray(width * height);
    let motionPixels: Array<{ x: number; y: number }> = [];

    for (let i = 0; i < data1.length; i += 4) {
      const pixelIdx = i / 4;
      const x = pixelIdx % width;
      const y = Math.floor(pixelIdx / width);

      // Check if within dartboard
      const dx = x - dartboard.centerX;
      const dy = y - dartboard.centerY;
      const distance = Math.sqrt(dx * dx + dy * dy) / dartboard.radius;

      if (distance > 1.05) continue; // Skip outside dartboard

      const r1 = data1[i];
      const g1 = data1[i + 1];
      const b1 = data1[i + 2];
      const r2 = data2[i];
      const g2 = data2[i + 1];
      const b2 = data2[i + 2];

      const diff = Math.abs(r1 - r2) + Math.abs(g1 - g2) + Math.abs(b1 - b2);
      if (diff > 40) {
        motionMap[pixelIdx] = 255;
        motionPixels.push({ x, y });
      }
    }

    // Cluster motion regions to find darts
    if (motionPixels.length > 50) {
      // Simple clustering with distance threshold
      const clusters: Array<Array<{ x: number; y: number }>> = [];
      const visited = new Set<number>();

      for (let i = 0; i < motionPixels.length; i++) {
        if (visited.has(i)) continue;

        const cluster = [motionPixels[i]];
        visited.add(i);

        for (let j = i + 1; j < motionPixels.length; j++) {
          if (visited.has(j)) continue;

          const dx = motionPixels[i].x - motionPixels[j].x;
          const dy = motionPixels[i].y - motionPixels[j].y;
          if (Math.sqrt(dx * dx + dy * dy) < 30) {
            cluster.push(motionPixels[j]);
            visited.add(j);
          }
        }

        if (cluster.length > 20) {
          clusters.push(cluster);
        }
      }

      // Convert clusters to dart detections
      for (const cluster of clusters) {
        let cx = 0,
          cy = 0;
        for (const p of cluster) {
          cx += p.x;
          cy += p.y;
        }
        cx /= cluster.length;
        cy /= cluster.length;

        darts.push({
          x: cx,
          y: cy,
          radius: Math.sqrt(cluster.length / Math.PI),
          confidence: Math.min(1, cluster.length / 100),
          timestamp: Date.now(),
        });
      }
    }

    return darts;
  };

  // Map dart detection to dart score
  const mapDetectionToScore = (detection: DartDetection, dartboard: DartboardParams) => {
    const dx = detection.x - dartboard.centerX;
    const dy = detection.y - dartboard.centerY;
    const distance = Math.sqrt(dx * dx + dy * dy) / dartboard.radius;
    const angle = (Math.atan2(dy, dx) * 180 / Math.PI + 90 + 360) % 360;

    // Determine score zone
    if (distance < BULLSEYE_RADIUS_INNER) {
      return { x: detection.x, y: detection.y, value: 50, multiplier: 1, points: 50, timestamp: Date.now() };
    }

    if (distance < SINGLE_BULL_OUTER) {
      return { x: detection.x, y: detection.y, value: 25, multiplier: 1, points: 25, timestamp: Date.now() };
    }

    // Calculate segment number
    const segmentIdx = Math.floor(angle / SEGMENT_ANGLE) % 20;
    const dartValue = DART_NUMBERS[segmentIdx];

    // Determine multiplier
    let multiplier = 1;

    if (distance >= TRIPLE_RING_INNER && distance <= TRIPLE_RING_OUTER) {
      multiplier = 3;
    } else if (distance >= DOUBLE_RING_INNER && distance <= DOUBLE_RING_OUTER) {
      multiplier = 2;
    }

    return {
      x: detection.x,
      y: detection.y,
      value: dartValue,
      multiplier,
      points: dartValue * multiplier,
      timestamp: Date.now(),
    };
  };

  // Draw calibration overlay
  const drawCalibrationOverlay = (
    ctx: CanvasRenderingContext2D,
    canvas: HTMLCanvasElement,
    dartboard: DartboardParams
  ) => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Draw detected circle
    ctx.strokeStyle = `rgba(0, 255, 0, ${dartboard.confidence})`;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(dartboard.centerX, dartboard.centerY, dartboard.radius, 0, Math.PI * 2);
    ctx.stroke();

    // Draw center crosshair
    ctx.strokeStyle = 'rgba(0, 255, 0, 0.8)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(dartboard.centerX - 15, dartboard.centerY);
    ctx.lineTo(dartboard.centerX + 15, dartboard.centerY);
    ctx.moveTo(dartboard.centerX, dartboard.centerY - 15);
    ctx.lineTo(dartboard.centerX, dartboard.centerY + 15);
    ctx.stroke();

    // Draw segment guides
    ctx.strokeStyle = 'rgba(100, 255, 100, 0.3)';
    ctx.lineWidth = 1;
    for (let i = 0; i < 20; i++) {
      const angle = (i * SEGMENT_ANGLE - 90) * Math.PI / 180;
      const x1 = dartboard.centerX + Math.cos(angle) * dartboard.radius;
      const y1 = dartboard.centerY + Math.sin(angle) * dartboard.radius;
      ctx.beginPath();
      ctx.moveTo(dartboard.centerX, dartboard.centerY);
      ctx.lineTo(x1, y1);
      ctx.stroke();
    }

    // Draw ring guides
    const rings = [
      { radius: BULLSEYE_RADIUS_OUTER, color: 'rgba(255, 200, 0, 0.4)', label: '25' },
      { radius: TRIPLE_RING_INNER, color: 'rgba(255, 100, 0, 0.3)', label: '3x' },
      { radius: TRIPLE_RING_OUTER, color: 'rgba(255, 100, 0, 0.3)', label: '' },
      { radius: DOUBLE_RING_INNER, color: 'rgba(100, 100, 255, 0.3)', label: '2x' },
      { radius: DOUBLE_RING_OUTER, color: 'rgba(100, 100, 255, 0.3)', label: '' },
    ];

    for (const ring of rings) {
      ctx.strokeStyle = ring.color;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(dartboard.centerX, dartboard.centerY, dartboard.radius * ring.radius, 0, Math.PI * 2);
      ctx.stroke();
    }
  };

  // Draw gameplay overlay
  const drawGameplayOverlay = (
    ctx: CanvasRenderingContext2D,
    canvas: HTMLCanvasElement,
    dartboard: DartboardParams
  ) => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Draw dartboard circle
    ctx.strokeStyle = 'rgba(0, 255, 0, 0.6)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(dartboard.centerX, dartboard.centerY, dartboard.radius, 0, Math.PI * 2);
    ctx.stroke();

    // Draw segment lines and numbers
    ctx.fillStyle = 'rgba(0, 255, 0, 0.5)';
    ctx.font = `${Math.round(dartboard.radius * 0.08)}px Arial`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    for (let i = 0; i < 20; i++) {
      const angle = (i * SEGMENT_ANGLE - 90) * Math.PI / 180;
      const x1 = dartboard.centerX + Math.cos(angle) * dartboard.radius;
      const y1 = dartboard.centerY + Math.sin(angle) * dartboard.radius;

      // Segment line
      ctx.strokeStyle = 'rgba(0, 255, 0, 0.3)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(dartboard.centerX, dartboard.centerY);
      ctx.lineTo(x1, y1);
      ctx.stroke();

      // Number label
      const labelAngle = (i * SEGMENT_ANGLE - 90 + SEGMENT_ANGLE / 2) * Math.PI / 180;
      const labelX = dartboard.centerX + Math.cos(labelAngle) * dartboard.radius * 1.15;
      const labelY = dartboard.centerY + Math.sin(labelAngle) * dartboard.radius * 1.15;
      ctx.fillText(DART_NUMBERS[i].toString(), labelX, labelY);
    }
  };

  const sendHitToDesktop = (dartHit: any) => {
    try {
      const hits = JSON.parse(localStorage.getItem('mobile_hits') || '[]');
      hits.push(dartHit);
      localStorage.setItem('mobile_hits', JSON.stringify(hits));

      window.dispatchEvent(
        new CustomEvent('dartHit', {
          detail: dartHit,
        })
      );
    } catch (err) {
      console.error('Error saving hit:', err);
    }
  };

  const handleCalibrationConfirm = () => {
    if (dartboardRef.current && dartboardRef.current.confidence > 0.5) {
      setCalibrating(false);
      setFeedback('✅ Calibration complete! Ready to detect darts.');
    }
  };

  return (
    <div className="w-full h-screen bg-black flex flex-col">
      {/* Header */}
      <div className="bg-gray-900 px-4 py-3 border-b border-gray-700 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Camera size={24} className="text-red-500" />
          <h1 className="text-white font-bold">Dart Camera (Advanced)</h1>
        </div>
        <div className="flex items-center gap-3">
          {isConnected ? (
            <Wifi size={20} className="text-green-500" />
          ) : (
            <WifiOff size={20} className="text-red-500" />
          )}
          <span className="text-white text-sm">Hits: {hitCount}</span>
          {calibrating && <Settings size={20} className="text-yellow-500 animate-spin" />}
        </div>
      </div>

      {/* Video Feed */}
      <div className="flex-1 relative bg-black overflow-hidden">
        <video
          ref={videoRef}
          autoPlay
          playsInline
          className="w-full h-full object-cover"
        />
        <canvas ref={canvasRef} className="hidden" />
        <canvas
          ref={overlayCanvasRef}
          className="absolute inset-0 w-full h-full"
          style={{ pointerEvents: 'none' }}
        />

        {/* Feedback */}
        {feedback && (
          <div className="absolute bottom-8 left-4 right-4 bg-green-600 text-white px-6 py-3 rounded-lg text-center font-bold shadow-lg">
            {feedback}
          </div>
        )}

        {calibrating && dartboardRef.current && (
          <div className="absolute bottom-8 left-4 right-4 flex gap-3">
            <button
              onClick={handleCalibrationConfirm}
              className="flex-1 px-4 py-3 bg-green-600 hover:bg-green-700 text-white font-bold rounded-lg transition"
            >
              ✅ Confirm Calibration
            </button>
          </div>
        )}

        {calibrating && !dartboardRef.current && (
          <div className="absolute top-8 left-4 right-4 bg-yellow-500 text-black px-4 py-2 rounded-lg text-center font-bold">
            🎯 Detecting dartboard... Point at the dartboard
          </div>
        )}

        {!calibrating && dartboardRef.current && (
          <div className="absolute top-8 left-4 right-4 bg-blue-600 text-white px-4 py-2 rounded-lg text-center font-bold">
            🎯 Ready to score! Throw your darts
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="bg-gray-900 px-4 py-4 border-t border-gray-700">
        <p className="text-gray-400 text-sm text-center">
          {calibrating
            ? '🔧 Calibration mode - hold dartboard in view, then press confirm'
            : '🎯 Detected darts will be scored automatically'}
        </p>
      </div>
    </div>
  );
}

export default MobileCameraV2;
