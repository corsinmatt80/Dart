import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Camera, X, Wifi, WifiOff, Settings, ZoomIn, ZoomOut, Move, RotateCcw, Check } from 'lucide-react';

interface DartboardParams {
  centerX: number;
  centerY: number;
  radius: number;
}

interface DartHit {
  x: number;
  y: number;
  value: number;
  multiplier: number;
  points: number;
  timestamp: number;
}

interface DetectedDart {
  x: number;
  y: number;
  confidence: number;
  clusterId: number;
}

type CalibrationMode = 'auto' | 'manual' | 'confirmed';

function MobileCameraV2() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null);
  
  const [cameraActive, setCameraActive] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [calibrationMode, setCalibrationMode] = useState<CalibrationMode>('auto');
  const [feedback, setFeedback] = useState<string>('');
  const [hitCount, setHitCount] = useState(0);
  const [lastHit, setLastHit] = useState<DartHit | null>(null);
  const [sensitivity, setSensitivity] = useState(35);
  const [showSettings, setShowSettings] = useState(false);
  
  // Manual calibration state
  const [manualCenter, setManualCenter] = useState({ x: 0.5, y: 0.5 });
  const [manualRadius, setManualRadius] = useState(0.35);
  
  const dartboardRef = useRef<DartboardParams | null>(null);
  const previousFrameRef = useRef<ImageData | null>(null);
  const baselineFrameRef = useRef<ImageData | null>(null);
  const lastDartTimeRef = useRef<number>(0);
  const detectionCooldownRef = useRef<boolean>(false);
  const frameCountRef = useRef(0);
  const dartCountInFrameRef = useRef(0);
  
  // Dartboard constants
  const DART_NUMBERS = [20, 1, 18, 4, 13, 6, 10, 15, 2, 17, 3, 19, 7, 16, 8, 11, 14, 9, 12, 5];
  const SEGMENT_ANGLE = 18; // degrees per segment
  
  // Ring radius ratios (relative to outer edge = 1.0)
  const DOUBLE_BULL = 0.032;    // Double bull (50)
  const SINGLE_BULL = 0.080;    // Single bull (25) 
  const TRIPLE_INNER = 0.47;    // Triple ring inner
  const TRIPLE_OUTER = 0.54;    // Triple ring outer
  const DOUBLE_INNER = 0.89;    // Double ring inner
  const DOUBLE_OUTER = 1.0;     // Double ring outer

  // Start camera
  useEffect(() => {
    const startCamera = async () => {
      try {
        if (window.location.protocol !== 'https:' && window.location.hostname !== 'localhost') {
          setFeedback('⚠️ HTTPS erforderlich für Kamera');
          setIsConnected(false);
          return;
        }

        if (!navigator.mediaDevices?.getUserMedia) {
          setFeedback('❌ Kamera wird nicht unterstützt');
          setIsConnected(false);
          return;
        }

        // Request camera with high resolution
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { 
            facingMode: 'environment', 
            width: { ideal: 1920, min: 1280 }, 
            height: { ideal: 1080, min: 720 },
            frameRate: { ideal: 30 }
          },
        });
        
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
          setCameraActive(true);
          setIsConnected(true);
          setFeedback('📷 Kamera aktiv - richte sie auf die Dartscheibe');
        }
      } catch (err) {
        setIsConnected(false);
        console.error('Camera error:', err);
        
        if (err instanceof DOMException) {
          switch (err.name) {
            case 'NotAllowedError':
              setFeedback('❌ Kamera-Zugriff verweigert');
              break;
            case 'NotFoundError':
              setFeedback('❌ Keine Kamera gefunden');
              break;
            case 'NotReadableError':
              setFeedback('❌ Kamera wird bereits verwendet');
              break;
            default:
              setFeedback(`❌ Kamera-Fehler: ${err.message}`);
          }
        }
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

  // Calculate dartboard params from manual settings
  const getDartboardParams = useCallback((width: number, height: number): DartboardParams => {
    return {
      centerX: manualCenter.x * width,
      centerY: manualCenter.y * height,
      radius: manualRadius * Math.min(width, height),
    };
  }, [manualCenter, manualRadius]);

  // Main detection loop
  useEffect(() => {
    if (!cameraActive || !canvasRef.current || !videoRef.current) return;

    const canvas = canvasRef.current;
    const overlayCanvas = overlayCanvasRef.current;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const overlayCtx = overlayCanvas?.getContext('2d');

    if (!ctx || !overlayCtx) return;

    let animationId: number;

    const processFrame = () => {
      const video = videoRef.current;
      if (!video || video.videoWidth === 0) {
        animationId = requestAnimationFrame(processFrame);
        return;
      }

      // Set canvas size
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      if (overlayCanvas) {
        overlayCanvas.width = video.videoWidth;
        overlayCanvas.height = video.videoHeight;
      }

      // Draw video frame
      ctx.drawImage(video, 0, 0);
      const currentFrame = ctx.getImageData(0, 0, canvas.width, canvas.height);

      // Get dartboard params
      const dartboard = getDartboardParams(canvas.width, canvas.height);
      dartboardRef.current = dartboard;

      // Clear overlay
      overlayCtx.clearRect(0, 0, overlayCanvas!.width, overlayCanvas!.height);

      // Draw dartboard overlay
      drawDartboardOverlay(overlayCtx, dartboard, calibrationMode === 'confirmed');

      // Only detect darts when calibration is confirmed
      if (calibrationMode === 'confirmed' && !detectionCooldownRef.current) {
        frameCountRef.current++;
        
        // Detect darts every 2 frames for performance
        if (frameCountRef.current % 2 === 0 && previousFrameRef.current) {
          const detections = detectDartMovement(previousFrameRef.current, currentFrame, dartboard);
          
          if (detections.length > 0) {
            // Count frames with darts detected
            dartCountInFrameRef.current++;
            
            // Require dart to be stable for a few frames
            if (dartCountInFrameRef.current >= 3) {
              const now = Date.now();
              
              // Debounce: 2 seconds between hits
              if (now - lastDartTimeRef.current > 2000) {
                // Take the detection with highest confidence
                const bestDetection = detections.reduce((a, b) => 
                  a.confidence > b.confidence ? a : b
                );
                
                const hit = calculateScore(bestDetection.x, bestDetection.y, dartboard);
                
                if (hit) {
                  sendHitToDesktop(hit);
                  lastDartTimeRef.current = now;
                  setHitCount(prev => prev + 1);
                  setLastHit(hit);
                  
                  const multiplierText = hit.multiplier === 3 ? 'T' : hit.multiplier === 2 ? 'D' : '';
                  setFeedback(`🎯 ${multiplierText}${hit.value} = ${hit.points} Punkte!`);
                  
                  // Draw hit marker
                  drawHitMarker(overlayCtx, bestDetection.x, bestDetection.y);
                  
                  // Set baseline after a hit for better next detection
                  detectionCooldownRef.current = true;
                  setTimeout(() => {
                    baselineFrameRef.current = null;
                    detectionCooldownRef.current = false;
                    dartCountInFrameRef.current = 0;
                    setFeedback('');
                  }, 2500);
                }
              }
            }
          } else {
            // Reset dart count if no detection
            if (dartCountInFrameRef.current > 0) {
              dartCountInFrameRef.current = Math.max(0, dartCountInFrameRef.current - 1);
            }
            
            // Update baseline periodically when no motion
            if (frameCountRef.current % 30 === 0 && !baselineFrameRef.current) {
              baselineFrameRef.current = currentFrame;
            }
          }
        }
      }

      previousFrameRef.current = currentFrame;
      animationId = requestAnimationFrame(processFrame);
    };

    animationId = requestAnimationFrame(processFrame);
    return () => cancelAnimationFrame(animationId);
  }, [cameraActive, calibrationMode, getDartboardParams, sensitivity]);

  // Detect dart by comparing frames
  const detectDartMovement = (
    prevFrame: ImageData, 
    currFrame: ImageData, 
    dartboard: DartboardParams
  ): DetectedDart[] => {
    const width = currFrame.width;
    const height = currFrame.height;
    const prev = prevFrame.data;
    const curr = currFrame.data;
    
    const motionPoints: Array<{ x: number; y: number; diff: number }> = [];
    const threshold = sensitivity;
    
    // Only scan within dartboard area
    const minX = Math.max(0, Math.floor(dartboard.centerX - dartboard.radius * 1.1));
    const maxX = Math.min(width, Math.ceil(dartboard.centerX + dartboard.radius * 1.1));
    const minY = Math.max(0, Math.floor(dartboard.centerY - dartboard.radius * 1.1));
    const maxY = Math.min(height, Math.ceil(dartboard.centerY + dartboard.radius * 1.1));
    
    // Sample every 2nd pixel for performance
    for (let y = minY; y < maxY; y += 2) {
      for (let x = minX; x < maxX; x += 2) {
        // Check if within dartboard circle
        const dx = x - dartboard.centerX;
        const dy = y - dartboard.centerY;
        const dist = Math.sqrt(dx * dx + dy * dy);
        
        if (dist > dartboard.radius * 1.05) continue;
        
        const i = (y * width + x) * 4;
        
        // Calculate color difference
        const rDiff = Math.abs(curr[i] - prev[i]);
        const gDiff = Math.abs(curr[i + 1] - prev[i + 1]);
        const bDiff = Math.abs(curr[i + 2] - prev[i + 2]);
        const totalDiff = rDiff + gDiff + bDiff;
        
        if (totalDiff > threshold) {
          // Additional check: look for dart-like colors (metallic, dark)
          const brightness = (curr[i] + curr[i + 1] + curr[i + 2]) / 3;
          const saturation = Math.max(curr[i], curr[i + 1], curr[i + 2]) - 
                           Math.min(curr[i], curr[i + 1], curr[i + 2]);
          
          // Darts are often dark/metallic (low saturation, medium brightness)
          // or have distinctive flight colors
          const isDartLike = saturation < 100 || brightness < 100 || brightness > 200;
          
          if (isDartLike) {
            motionPoints.push({ x, y, diff: totalDiff });
          }
        }
      }
    }
    
    if (motionPoints.length < 15) return [];
    
    // Cluster motion points to find dart tip
    return clusterMotionPoints(motionPoints, dartboard);
  };

  // Cluster motion points to identify dart position
  const clusterMotionPoints = (
    points: Array<{ x: number; y: number; diff: number }>,
    dartboard: DartboardParams
  ): DetectedDart[] => {
    if (points.length === 0) return [];
    
    const clusters: Array<{
      points: Array<{ x: number; y: number; diff: number }>;
      centerX: number;
      centerY: number;
    }> = [];
    
    const clusterRadius = 25; // pixels
    const visited = new Set<number>();
    
    for (let i = 0; i < points.length; i++) {
      if (visited.has(i)) continue;
      
      const cluster = {
        points: [points[i]],
        centerX: points[i].x,
        centerY: points[i].y,
      };
      visited.add(i);
      
      // Find nearby points
      for (let j = i + 1; j < points.length; j++) {
        if (visited.has(j)) continue;
        
        const dx = points[j].x - cluster.centerX;
        const dy = points[j].y - cluster.centerY;
        
        if (Math.sqrt(dx * dx + dy * dy) < clusterRadius) {
          cluster.points.push(points[j]);
          visited.add(j);
          
          // Update center
          let sumX = 0, sumY = 0;
          for (const p of cluster.points) {
            sumX += p.x;
            sumY += p.y;
          }
          cluster.centerX = sumX / cluster.points.length;
          cluster.centerY = sumY / cluster.points.length;
        }
      }
      
      // Only keep significant clusters
      if (cluster.points.length >= 10) {
        clusters.push(cluster);
      }
    }
    
    // Convert to detected darts
    // Find the point closest to the dartboard center within each cluster (dart tip)
    return clusters.map((cluster, idx) => {
      // Weighted average by diff value (higher diff = more likely dart edge)
      let weightedX = 0, weightedY = 0, totalWeight = 0;
      
      for (const p of cluster.points) {
        const weight = p.diff;
        weightedX += p.x * weight;
        weightedY += p.y * weight;
        totalWeight += weight;
      }
      
      const tipX = weightedX / totalWeight;
      const tipY = weightedY / totalWeight;
      
      // Find the innermost point (closest to bull) as the actual dart tip
      let closestDist = Infinity;
      let closestX = tipX;
      let closestY = tipY;
      
      for (const p of cluster.points) {
        const dx = p.x - dartboard.centerX;
        const dy = p.y - dartboard.centerY;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < closestDist) {
          closestDist = dist;
          closestX = p.x;
          closestY = p.y;
        }
      }
      
      return {
        x: closestX,
        y: closestY,
        confidence: Math.min(1, cluster.points.length / 50),
        clusterId: idx,
      };
    }).filter(d => {
      // Filter out detections outside the dartboard
      const dx = d.x - dartboard.centerX;
      const dy = d.y - dartboard.centerY;
      const dist = Math.sqrt(dx * dx + dy * dy);
      return dist <= dartboard.radius;
    });
  };

  // Calculate score from hit position
  const calculateScore = (x: number, y: number, dartboard: DartboardParams): DartHit | null => {
    const dx = x - dartboard.centerX;
    const dy = y - dartboard.centerY;
    const distance = Math.sqrt(dx * dx + dy * dy) / dartboard.radius;
    
    // Outside the board
    if (distance > DOUBLE_OUTER) return null;
    
    // Calculate angle (0° at top, clockwise)
    let angle = Math.atan2(dx, -dy) * (180 / Math.PI);
    if (angle < 0) angle += 360;
    
    // Adjust for segment offset (segments are centered, not edge-aligned)
    angle = (angle + SEGMENT_ANGLE / 2) % 360;
    const segmentIndex = Math.floor(angle / SEGMENT_ANGLE);
    const value = DART_NUMBERS[segmentIndex];
    
    let multiplier = 1;
    let finalValue = value;
    
    // Determine ring
    if (distance <= DOUBLE_BULL) {
      finalValue = 50;
      multiplier = 1;
    } else if (distance <= SINGLE_BULL) {
      finalValue = 25;
      multiplier = 1;
    } else if (distance >= TRIPLE_INNER && distance <= TRIPLE_OUTER) {
      multiplier = 3;
    } else if (distance >= DOUBLE_INNER && distance <= DOUBLE_OUTER) {
      multiplier = 2;
    }
    
    return {
      x,
      y,
      value: finalValue === 50 || finalValue === 25 ? finalValue : value,
      multiplier: finalValue === 50 || finalValue === 25 ? 1 : multiplier,
      points: finalValue === 50 || finalValue === 25 ? finalValue : value * multiplier,
      timestamp: Date.now(),
    };
  };

  // Draw dartboard overlay with segments
  const drawDartboardOverlay = (
    ctx: CanvasRenderingContext2D,
    dartboard: DartboardParams,
    isConfirmed: boolean
  ) => {
    const { centerX, centerY, radius } = dartboard;
    
    ctx.save();
    
    // Outer circle
    ctx.strokeStyle = isConfirmed ? 'rgba(0, 255, 0, 0.7)' : 'rgba(255, 255, 0, 0.7)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
    ctx.stroke();
    
    // Double ring
    ctx.strokeStyle = isConfirmed ? 'rgba(0, 200, 0, 0.4)' : 'rgba(200, 200, 0, 0.4)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(centerX, centerY, radius * DOUBLE_INNER, 0, Math.PI * 2);
    ctx.stroke();
    
    // Triple ring
    ctx.beginPath();
    ctx.arc(centerX, centerY, radius * TRIPLE_OUTER, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(centerX, centerY, radius * TRIPLE_INNER, 0, Math.PI * 2);
    ctx.stroke();
    
    // Bull rings
    ctx.strokeStyle = isConfirmed ? 'rgba(0, 255, 0, 0.5)' : 'rgba(255, 200, 0, 0.5)';
    ctx.beginPath();
    ctx.arc(centerX, centerY, radius * SINGLE_BULL, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(centerX, centerY, radius * DOUBLE_BULL, 0, Math.PI * 2);
    ctx.stroke();
    
    // Segment lines
    ctx.strokeStyle = isConfirmed ? 'rgba(0, 200, 0, 0.3)' : 'rgba(200, 200, 0, 0.3)';
    ctx.lineWidth = 1;
    
    for (let i = 0; i < 20; i++) {
      const angle = (i * SEGMENT_ANGLE - 90) * Math.PI / 180;
      ctx.beginPath();
      ctx.moveTo(centerX, centerY);
      ctx.lineTo(
        centerX + Math.cos(angle) * radius,
        centerY + Math.sin(angle) * radius
      );
      ctx.stroke();
    }
    
    // Segment numbers
    ctx.fillStyle = isConfirmed ? 'rgba(0, 255, 0, 0.8)' : 'rgba(255, 255, 0, 0.8)';
    ctx.font = `bold ${Math.round(radius * 0.08)}px Arial`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    
    for (let i = 0; i < 20; i++) {
      const angle = ((i * SEGMENT_ANGLE) - 90 + SEGMENT_ANGLE / 2) * Math.PI / 180;
      const labelRadius = radius * 1.12;
      const labelX = centerX + Math.cos(angle) * labelRadius;
      const labelY = centerY + Math.sin(angle) * labelRadius;
      ctx.fillText(DART_NUMBERS[i].toString(), labelX, labelY);
    }
    
    // Center crosshair
    ctx.strokeStyle = isConfirmed ? 'rgba(0, 255, 0, 0.9)' : 'rgba(255, 255, 0, 0.9)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(centerX - 10, centerY);
    ctx.lineTo(centerX + 10, centerY);
    ctx.moveTo(centerX, centerY - 10);
    ctx.lineTo(centerX, centerY + 10);
    ctx.stroke();
    
    ctx.restore();
  };

  // Draw hit marker
  const drawHitMarker = (ctx: CanvasRenderingContext2D, x: number, y: number) => {
    ctx.save();
    
    // Animated circle
    ctx.strokeStyle = 'rgba(255, 0, 0, 0.9)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(x, y, 15, 0, Math.PI * 2);
    ctx.stroke();
    
    // Cross
    ctx.strokeStyle = 'rgba(255, 255, 0, 0.9)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x - 8, y - 8);
    ctx.lineTo(x + 8, y + 8);
    ctx.moveTo(x + 8, y - 8);
    ctx.lineTo(x - 8, y + 8);
    ctx.stroke();
    
    ctx.restore();
  };

  // Send hit to desktop
  const sendHitToDesktop = (hit: DartHit) => {
    try {
      const hits = JSON.parse(localStorage.getItem('mobile_hits') || '[]');
      hits.push(hit);
      localStorage.setItem('mobile_hits', JSON.stringify(hits));
      
      window.dispatchEvent(new CustomEvent('dartHit', { detail: hit }));
      
      console.log('Hit sent:', hit);
    } catch (err) {
      console.error('Error sending hit:', err);
    }
  };

  // Calibration handlers
  const handleMoveCenter = (dx: number, dy: number) => {
    setManualCenter(prev => ({
      x: Math.max(0.1, Math.min(0.9, prev.x + dx)),
      y: Math.max(0.1, Math.min(0.9, prev.y + dy)),
    }));
  };

  const handleChangeRadius = (delta: number) => {
    setManualRadius(prev => Math.max(0.15, Math.min(0.45, prev + delta)));
  };

  const handleConfirmCalibration = () => {
    setCalibrationMode('confirmed');
    baselineFrameRef.current = null;
    previousFrameRef.current = null;
    dartCountInFrameRef.current = 0;
    setFeedback('✅ Kalibrierung abgeschlossen! Wirf einen Dart!');
    setTimeout(() => setFeedback(''), 2000);
  };

  const handleResetCalibration = () => {
    setCalibrationMode('manual');
    setManualCenter({ x: 0.5, y: 0.5 });
    setManualRadius(0.35);
    setFeedback('🔧 Kalibrierung zurückgesetzt');
    setTimeout(() => setFeedback(''), 1500);
  };

  return (
    <div className="w-full h-screen bg-black flex flex-col select-none">
      {/* Header */}
      <div className="bg-gray-900 px-4 py-3 border-b border-gray-700 flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-2">
          <Camera size={22} className="text-red-500" />
          <h1 className="text-white font-bold text-lg">Dart Recognition</h1>
        </div>
        <div className="flex items-center gap-3">
          {isConnected ? (
            <Wifi size={18} className="text-green-500" />
          ) : (
            <WifiOff size={18} className="text-red-500" />
          )}
          <span className="text-green-400 font-mono text-sm">{hitCount} Hits</span>
          <button 
            onClick={() => setShowSettings(!showSettings)}
            className="p-1.5 bg-gray-800 rounded-lg"
          >
            <Settings size={18} className={showSettings ? "text-yellow-400" : "text-gray-400"} />
          </button>
        </div>
      </div>

      {/* Settings Panel */}
      {showSettings && (
        <div className="bg-gray-800 px-4 py-3 border-b border-gray-700 flex-shrink-0">
          <div className="flex items-center justify-between">
            <span className="text-white text-sm">Empfindlichkeit:</span>
            <div className="flex items-center gap-3">
              <input
                type="range"
                min="15"
                max="80"
                value={sensitivity}
                onChange={(e) => setSensitivity(Number(e.target.value))}
                className="w-32"
              />
              <span className="text-gray-400 text-sm w-8">{sensitivity}</span>
            </div>
          </div>
        </div>
      )}

      {/* Video Feed */}
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
          className="absolute inset-0 w-full h-full"
          style={{ pointerEvents: 'none' }}
        />

        {/* Status Banner */}
        {calibrationMode !== 'confirmed' && (
          <div className="absolute top-2 left-2 right-2 bg-yellow-500 text-black px-4 py-2 rounded-lg text-center font-bold text-sm">
            ⚙️ Kalibrierung: Positioniere den Kreis auf der Dartscheibe
          </div>
        )}
        
        {calibrationMode === 'confirmed' && !feedback && (
          <div className="absolute top-2 left-2 right-2 bg-green-600 text-white px-4 py-2 rounded-lg text-center font-bold text-sm">
            🎯 Bereit! Wirf einen Dart
          </div>
        )}

        {/* Feedback Toast */}
        {feedback && (
          <div className="absolute top-2 left-2 right-2 bg-blue-600 text-white px-4 py-3 rounded-lg text-center font-bold shadow-lg animate-pulse">
            {feedback}
          </div>
        )}

        {/* Last Hit Display */}
        {lastHit && calibrationMode === 'confirmed' && (
          <div className="absolute bottom-20 left-4 right-4 bg-gray-900/90 text-white px-4 py-3 rounded-lg">
            <div className="text-center">
              <span className="text-2xl font-bold text-yellow-400">
                {lastHit.multiplier === 3 ? 'T' : lastHit.multiplier === 2 ? 'D' : ''}
                {lastHit.value}
              </span>
              <span className="text-xl ml-2">= {lastHit.points} Punkte</span>
            </div>
          </div>
        )}
      </div>

      {/* Calibration Controls */}
      {calibrationMode !== 'confirmed' && (
        <div className="bg-gray-900 px-4 py-4 border-t border-gray-700 flex-shrink-0">
          {/* Movement Controls */}
          <div className="flex justify-center gap-2 mb-3">
            <button
              onClick={() => handleMoveCenter(-0.02, 0)}
              className="p-3 bg-gray-800 rounded-lg active:bg-gray-700"
            >
              <Move size={20} className="text-white rotate-180" />
            </button>
            <div className="flex flex-col gap-1">
              <button
                onClick={() => handleMoveCenter(0, -0.02)}
                className="p-2 bg-gray-800 rounded-lg active:bg-gray-700"
              >
                <Move size={16} className="text-white -rotate-90" />
              </button>
              <button
                onClick={() => handleMoveCenter(0, 0.02)}
                className="p-2 bg-gray-800 rounded-lg active:bg-gray-700"
              >
                <Move size={16} className="text-white rotate-90" />
              </button>
            </div>
            <button
              onClick={() => handleMoveCenter(0.02, 0)}
              className="p-3 bg-gray-800 rounded-lg active:bg-gray-700"
            >
              <Move size={20} className="text-white" />
            </button>
            
            <div className="w-4" />
            
            <button
              onClick={() => handleChangeRadius(-0.02)}
              className="p-3 bg-gray-800 rounded-lg active:bg-gray-700"
            >
              <ZoomOut size={20} className="text-white" />
            </button>
            <button
              onClick={() => handleChangeRadius(0.02)}
              className="p-3 bg-gray-800 rounded-lg active:bg-gray-700"
            >
              <ZoomIn size={20} className="text-white" />
            </button>
          </div>
          
          {/* Confirm Button */}
          <button
            onClick={handleConfirmCalibration}
            className="w-full py-3 bg-green-600 hover:bg-green-700 active:bg-green-800 text-white font-bold rounded-lg flex items-center justify-center gap-2"
          >
            <Check size={20} />
            Kalibrierung bestätigen
          </button>
        </div>
      )}

      {/* Game Controls */}
      {calibrationMode === 'confirmed' && (
        <div className="bg-gray-900 px-4 py-3 border-t border-gray-700 flex-shrink-0">
          <div className="flex gap-3">
            <button
              onClick={handleResetCalibration}
              className="flex-1 py-2.5 bg-gray-700 hover:bg-gray-600 text-white font-medium rounded-lg flex items-center justify-center gap-2"
            >
              <RotateCcw size={18} />
              Neu kalibrieren
            </button>
            <button
              onClick={() => {
                localStorage.removeItem('mobile_hits');
                setHitCount(0);
                setLastHit(null);
                setFeedback('🗑️ Hits gelöscht');
                setTimeout(() => setFeedback(''), 1500);
              }}
              className="flex-1 py-2.5 bg-red-600 hover:bg-red-700 text-white font-medium rounded-lg flex items-center justify-center gap-2"
            >
              <X size={18} />
              Hits löschen
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default MobileCameraV2;
