import React, { useRef, useState, useCallback, useEffect } from 'react';
import { Crosshair, Camera, Check, X, RotateCcw, Play, Pause, Target } from 'lucide-react';
import { 
  detectDartboard, 
  detectDartInDifference, 
  polarToScore, 
  pointToEllipsePolar,
  Ellipse 
} from '../utils/dartboardCV';

interface DartDetectionTestProps {
  videoStream: MediaStream | null;
  onDartDetected?: (score: { value: number; multiplier: number; points: number }) => void;
}

function DartDetectionTest({ videoStream, onDartDetected }: DartDetectionTestProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null);
  
  const referenceFrameRef = useRef<ImageData | null>(null);
  const ellipseRef = useRef<Ellipse | null>(null);
  const animationFrameRef = useRef<number>(0);
  
  const [isCalibrated, setIsCalibrated] = useState(false);
  const [isDetecting, setIsDetecting] = useState(false);
  const [lastScore, setLastScore] = useState<{ value: number; multiplier: number; points: number } | null>(null);
  const [detectionLog, setDetectionLog] = useState<string[]>([]);
  const [showOverlay, setShowOverlay] = useState(true);

  // Attach video stream
  useEffect(() => {
    if (videoRef.current && videoStream) {
      videoRef.current.srcObject = videoStream;
      videoRef.current.play().catch(console.error);
    }
  }, [videoStream]);

  // Log function
  const log = useCallback((message: string) => {
    console.log('[DartDetection]', message);
    setDetectionLog(prev => [...prev.slice(-9), `${new Date().toLocaleTimeString()}: ${message}`]);
  }, []);

  // Capture current frame
  const captureFrame = useCallback((): ImageData | null => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || video.readyState < 2) return null;

    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    ctx.drawImage(video, 0, 0);
    return ctx.getImageData(0, 0, canvas.width, canvas.height);
  }, []);

  // Calibrate dartboard
  const calibrate = useCallback(() => {
    log('Kalibriere Dartscheibe...');
    const frame = captureFrame();
    if (!frame) {
      log('❌ Kein Video-Frame verfügbar');
      return;
    }

    const ellipse = detectDartboard(frame);
    if (!ellipse) {
      log('❌ Dartscheibe nicht erkannt - stelle sicher, dass die ganze Scheibe sichtbar ist');
      return;
    }

    ellipseRef.current = ellipse;
    referenceFrameRef.current = frame;
    setIsCalibrated(true);
    log(`✅ Kalibriert! Zentrum: (${Math.round(ellipse.centerX)}, ${Math.round(ellipse.centerY)}), Radius: ${Math.round(ellipse.radiusX)}`);
    
    drawOverlay(ellipse);
  }, [captureFrame, log]);

  // Draw calibration overlay
  const drawOverlay = useCallback((ellipse: Ellipse) => {
    const overlayCanvas = overlayCanvasRef.current;
    const video = videoRef.current;
    if (!overlayCanvas || !video) return;

    overlayCanvas.width = video.videoWidth;
    overlayCanvas.height = video.videoHeight;
    const ctx = overlayCanvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
    
    // Draw dartboard outline
    ctx.strokeStyle = 'lime';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.ellipse(
      ellipse.centerX, ellipse.centerY,
      ellipse.radiusX, ellipse.radiusY,
      ellipse.rotation, 0, Math.PI * 2
    );
    ctx.stroke();

    // Draw center cross
    const crossSize = 20;
    ctx.strokeStyle = 'red';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(ellipse.centerX - crossSize, ellipse.centerY);
    ctx.lineTo(ellipse.centerX + crossSize, ellipse.centerY);
    ctx.moveTo(ellipse.centerX, ellipse.centerY - crossSize);
    ctx.lineTo(ellipse.centerX, ellipse.centerY + crossSize);
    ctx.stroke();

    // Draw triple ring
    ctx.strokeStyle = 'rgba(255, 255, 0, 0.5)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(
      ellipse.centerX, ellipse.centerY,
      ellipse.radiusX * 0.474, ellipse.radiusY * 0.474,
      ellipse.rotation, 0, Math.PI * 2
    );
    ctx.stroke();
  }, []);

  // Set reference frame (before throwing)
  const setReference = useCallback(() => {
    const frame = captureFrame();
    if (!frame) {
      log('❌ Kein Frame verfügbar');
      return;
    }
    referenceFrameRef.current = frame;
    log('📸 Referenz-Frame gesetzt - wirf jetzt den Dart!');
  }, [captureFrame, log]);

  // Detect dart by comparing to reference
  const detectDart = useCallback(() => {
    if (!ellipseRef.current || !referenceFrameRef.current) {
      log('❌ Erst kalibrieren!');
      return;
    }

    const currentFrame = captureFrame();
    if (!currentFrame) {
      log('❌ Kein Frame verfügbar');
      return;
    }

    const dartTip = detectDartInDifference(
      currentFrame, 
      referenceFrameRef.current, 
      ellipseRef.current
    );

    if (dartTip) {
      const polar = pointToEllipsePolar(dartTip, ellipseRef.current);
      const score = polarToScore(polar);
      
      setLastScore(score);
      log(`🎯 Dart erkannt! ${score.points} Punkte (${score.multiplier}x${score.value})`);
      onDartDetected?.(score);

      // Draw dart marker on overlay
      const overlayCtx = overlayCanvasRef.current?.getContext('2d');
      if (overlayCtx && ellipseRef.current) {
        // Redraw ellipse
        drawOverlay(ellipseRef.current);
        
        // Draw dart marker
        overlayCtx.fillStyle = 'magenta';
        overlayCtx.beginPath();
        overlayCtx.arc(dartTip.x, dartTip.y, 8, 0, Math.PI * 2);
        overlayCtx.fill();
        overlayCtx.strokeStyle = 'white';
        overlayCtx.lineWidth = 2;
        overlayCtx.stroke();
        
        // Draw score text
        overlayCtx.font = 'bold 24px sans-serif';
        overlayCtx.fillStyle = 'white';
        overlayCtx.strokeStyle = 'black';
        overlayCtx.lineWidth = 3;
        overlayCtx.strokeText(`${score.points}`, dartTip.x + 15, dartTip.y - 10);
        overlayCtx.fillText(`${score.points}`, dartTip.x + 15, dartTip.y - 10);
      }
    } else {
      log('Kein Dart erkannt - versuche es nochmal');
    }
  }, [captureFrame, log, onDartDetected, drawOverlay]);

  // Auto-detection loop
  const startAutoDetection = useCallback(() => {
    setIsDetecting(true);
    log('▶️ Auto-Erkennung gestartet');
    
    let lastDetectionTime = 0;
    const minInterval = 500; // Min 500ms between detections
    
    const loop = () => {
      const now = Date.now();
      if (now - lastDetectionTime > minInterval && ellipseRef.current && referenceFrameRef.current) {
        const currentFrame = captureFrame();
        if (currentFrame) {
          const dartTip = detectDartInDifference(
            currentFrame, 
            referenceFrameRef.current, 
            ellipseRef.current
          );
          
          if (dartTip) {
            const polar = pointToEllipsePolar(dartTip, ellipseRef.current);
            const score = polarToScore(polar);
            setLastScore(score);
            log(`🎯 ${score.points} Punkte (${score.multiplier}x${score.value})`);
            onDartDetected?.(score);
            
            // Update reference for next dart
            referenceFrameRef.current = currentFrame;
            lastDetectionTime = now;
          }
        }
      }
      animationFrameRef.current = requestAnimationFrame(loop);
    };
    
    loop();
  }, [captureFrame, log, onDartDetected]);

  const stopAutoDetection = useCallback(() => {
    setIsDetecting(false);
    cancelAnimationFrame(animationFrameRef.current);
    log('⏹️ Auto-Erkennung gestoppt');
  }, [log]);

  // Cleanup
  useEffect(() => {
    return () => {
      cancelAnimationFrame(animationFrameRef.current);
    };
  }, []);

  if (!videoStream) {
    return (
      <div className="bg-gray-800 rounded-lg p-6 text-center">
        <Camera size={48} className="mx-auto text-gray-500 mb-4" />
        <p className="text-gray-400">Verbinde zuerst die Kamera</p>
      </div>
    );
  }

  return (
    <div className="bg-gray-800 rounded-lg p-4 space-y-4">
      <h3 className="text-white font-bold flex items-center gap-2">
        <Target size={20} className="text-yellow-400" />
        Dart-Erkennung Test
      </h3>

      {/* Video with overlay */}
      <div className="relative bg-black rounded-lg overflow-hidden">
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className="w-full"
        />
        {showOverlay && (
          <canvas
            ref={overlayCanvasRef}
            className="absolute inset-0 w-full h-full pointer-events-none"
          />
        )}
        <canvas ref={canvasRef} className="hidden" />
        
        {/* Score overlay */}
        {lastScore && (
          <div className="absolute top-4 right-4 bg-green-600 px-4 py-2 rounded-lg text-white font-bold text-xl">
            {lastScore.points} Punkte
            <div className="text-sm font-normal opacity-80">
              {lastScore.multiplier > 1 ? `${lastScore.multiplier}×` : ''}{lastScore.value}
            </div>
          </div>
        )}
      </div>

      {/* Controls */}
      <div className="space-y-2">
        {/* Calibration */}
        <div className="flex gap-2">
          <button
            onClick={calibrate}
            className={`flex-1 py-2 rounded-lg font-bold flex items-center justify-center gap-2 ${
              isCalibrated 
                ? 'bg-green-600/20 text-green-400 border border-green-600' 
                : 'bg-blue-600 text-white hover:bg-blue-500'
            }`}
          >
            {isCalibrated ? <Check size={18} /> : <Crosshair size={18} />}
            {isCalibrated ? 'Kalibriert ✓' : '1. Kalibrieren'}
          </button>
          
          <button
            onClick={() => setShowOverlay(!showOverlay)}
            className="px-4 py-2 bg-gray-600 hover:bg-gray-500 rounded-lg text-white"
            title="Overlay umschalten"
          >
            {showOverlay ? <Check size={18} /> : <X size={18} />}
          </button>
        </div>

        {/* Manual detection */}
        {isCalibrated && (
          <div className="flex gap-2">
            <button
              onClick={setReference}
              className="flex-1 py-2 bg-yellow-600 hover:bg-yellow-500 rounded-lg text-white font-bold"
            >
              📸 2. Referenz setzen
            </button>
            <button
              onClick={detectDart}
              className="flex-1 py-2 bg-green-600 hover:bg-green-500 rounded-lg text-white font-bold"
            >
              🎯 3. Dart erkennen
            </button>
          </div>
        )}

        {/* Auto detection */}
        {isCalibrated && (
          <button
            onClick={isDetecting ? stopAutoDetection : startAutoDetection}
            className={`w-full py-2 rounded-lg font-bold flex items-center justify-center gap-2 ${
              isDetecting 
                ? 'bg-red-600 hover:bg-red-500 text-white' 
                : 'bg-purple-600 hover:bg-purple-500 text-white'
            }`}
          >
            {isDetecting ? <Pause size={18} /> : <Play size={18} />}
            {isDetecting ? 'Auto-Erkennung stoppen' : 'Auto-Erkennung starten'}
          </button>
        )}

        {/* Reset */}
        <button
          onClick={() => {
            setIsCalibrated(false);
            setLastScore(null);
            ellipseRef.current = null;
            referenceFrameRef.current = null;
            if (overlayCanvasRef.current) {
              overlayCanvasRef.current.getContext('2d')?.clearRect(0, 0, overlayCanvasRef.current.width, overlayCanvasRef.current.height);
            }
            log('🔄 Reset');
          }}
          className="w-full py-2 bg-gray-600 hover:bg-gray-500 rounded-lg text-white flex items-center justify-center gap-2"
        >
          <RotateCcw size={16} />
          Zurücksetzen
        </button>
      </div>

      {/* Log */}
      <div className="bg-gray-900 rounded p-2 h-32 overflow-auto">
        <p className="text-gray-500 text-xs font-mono">Protokoll:</p>
        {detectionLog.map((entry, i) => (
          <p key={i} className="text-gray-300 text-xs font-mono">{entry}</p>
        ))}
        {detectionLog.length === 0 && (
          <p className="text-gray-500 text-xs">Noch keine Aktivität</p>
        )}
      </div>
    </div>
  );
}

export default DartDetectionTest;
