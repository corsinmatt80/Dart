import React, { useEffect, useRef, useState } from 'react';
import { Camera, X } from 'lucide-react';

interface CameraCaptureProps {
  onHit: (hitData: { x: number; y: number; value: number; multiplier: number }) => void;
  onBack?: () => void;
  disabled?: boolean;
}

function CameraCapture({ onHit, onBack, disabled = false }: CameraCaptureProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isActive, setIsActive] = useState(false);
  const [cameraActive, setCameraActive] = useState(false);
  const prevFrameRef = useRef<ImageData | null>(null);
  const motionThresholdRef = useRef(30);
  const [feedback, setFeedback] = useState<string>('');

  useEffect(() => {
    if (!isActive) return;

    const startCamera = async () => {
      try {
        // Prüfe ob HTTPS vorhanden ist (notwendig für getUserMedia)
        if (window.location.protocol !== 'https:' && window.location.hostname !== 'localhost') {
          setFeedback('⚠️ HTTPS erforderlich! Kamera funktioniert nur auf sicheren Verbindungen.');
          return;
        }

        // Prüfe ob getUserMedia verfügbar ist
        if (!navigator.mediaDevices?.getUserMedia) {
          setFeedback('❌ Kamera wird von diesem Browser nicht unterstützt');
          return;
        }

        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment', width: { ideal: 640 }, height: { ideal: 480 } },
        });
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          setCameraActive(true);
          setFeedback('');
        }
      } catch (err) {
        console.error('Kamera-Fehler:', err);
        
        // Bessere Fehlerbehandlung
        if (err instanceof DOMException) {
          if (err.name === 'NotAllowedError') {
            setFeedback('❌ Kamera-Zugriff verweigert. Bitte Berechtigung erteilen.');
          } else if (err.name === 'NotFoundError') {
            setFeedback('❌ Keine Kamera gefunden.');
          } else if (err.name === 'NotReadableError') {
            setFeedback('❌ Kamera wird bereits verwendet.');
          } else {
            setFeedback(`❌ Kamera-Fehler: ${err.message}`);
          }
        } else {
          setFeedback('❌ Kamera nicht verfügbar');
        }
      }
    };

    startCamera();

    return () => {
      if (videoRef.current && videoRef.current.srcObject) {
        const tracks = (videoRef.current.srcObject as MediaStream).getTracks();
        tracks.forEach((track) => track.stop());
      }
      setCameraActive(false);
    };
  }, [isActive]);

  // Motion Detection Loop
  useEffect(() => {
    if (!cameraActive || !canvasRef.current || !videoRef.current) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const detectMotion = () => {
      const video = videoRef.current;
      if (!video || video.videoWidth === 0) {
        requestAnimationFrame(detectMotion);
        return;
      }

      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;

      // Zeichne Video-Frame
      ctx.drawImage(video, 0, 0);
      const currentFrame = ctx.getImageData(0, 0, canvas.width, canvas.height);

      if (prevFrameRef.current) {
        const motionData = detectMotionArea(prevFrameRef.current, currentFrame);
        if (motionData) {
          // Bewegung erkannt!
          const dartHit = mapPositionToDart(
            motionData.centerX,
            motionData.centerY,
            canvas.width,
            canvas.height
          );
          onHit(dartHit);
          setFeedback(`Treffer erkannt! Bereich: ${dartHit.value}${dartHit.multiplier > 1 ? 'x' + dartHit.multiplier : ''}`);
          
          // Reset nach kurzer Zeit
          setTimeout(() => setFeedback(''), 2000);
        }
      }

      prevFrameRef.current = currentFrame;
      requestAnimationFrame(detectMotion);
    };

    const animationId = requestAnimationFrame(detectMotion);
    return () => cancelAnimationFrame(animationId);
  }, [cameraActive, onHit]);

  const detectMotionArea = (prevFrame: ImageData, currFrame: ImageData) => {
    const data1 = prevFrame.data;
    const data2 = currFrame.data;
    let motionX = 0,
      motionY = 0,
      motionCount = 0;

    // Vereinfachte Motion Detection: Jeden 2. Pixel prüfen für Performance
    for (let i = 0; i < data1.length; i += 8) {
      const r1 = data1[i];
      const g1 = data1[i + 1];
      const b1 = data1[i + 2];
      const r2 = data2[i];
      const g2 = data2[i + 1];
      const b2 = data2[i + 2];

      const diff = Math.abs(r1 - r2) + Math.abs(g1 - g2) + Math.abs(b1 - b2);
      if (diff > motionThresholdRef.current) {
        motionX += i % prevFrame.width;
        motionY += Math.floor(i / prevFrame.width);
        motionCount++;
      }
    }

    if (motionCount > 100) {
      // Genug Bewegung erkannt
      return {
        centerX: Math.floor(motionX / motionCount),
        centerY: Math.floor(motionY / motionCount),
        magnitude: motionCount,
      };
    }

    return null;
  };

  const mapPositionToDart = (x: number, y: number, width: number, height: number) => {
    // Normalisiere Koordinaten (0-1)
    const normalizedX = x / width;
    const normalizedY = y / height;

    // Dartscheibe liegt typischerweise in der Mitte
    const centerX = 0.5;
    const centerY = 0.5;
    const deltaX = normalizedX - centerX;
    const deltaY = normalizedY - centerY;

    // Berechne Winkel und Distanz vom Zentrum
    const angle = Math.atan2(deltaY, deltaX) * (180 / Math.PI);
    const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);

    // Dartscheibe Zahlen (oben anfangen, clockwise)
    const dartNumbers = [
      20, 1, 18, 4, 13, 6, 10, 15, 2, 17, 3, 19, 7, 16, 8, 11, 14, 9, 12, 5,
    ];

    // Normalisiere Winkel (0-360)
    let normalizedAngle = (angle + 90 + 360) % 360;
    const sectionIndex = Math.floor(normalizedAngle / 18) % 20;
    const dartValue = dartNumbers[sectionIndex];

    // Bestimme Multiplier basierend auf Distanz vom Zentrum
    let multiplier = 1;
    if (distance > 0.3 && distance < 0.45) {
      multiplier = 3; // Triple Ring
    } else if (distance > 0.85 && distance < 1.0) {
      multiplier = 2; // Double Ring
    } else if (distance < 0.15) {
      return { x, y, value: 50, multiplier: 1, points: 50 }; // Bull
    } else if (distance < 0.22) {
      return { x, y, value: 25, multiplier: 1, points: 25 }; // Single Bull
    }

    return {
      x,
      y,
      value: dartValue,
      multiplier,
      points: dartValue * multiplier,
    };
  };

  return (
    <div className="w-full space-y-4">
      <button
        onClick={() => setIsActive(!isActive)}
        disabled={disabled}
        className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 rounded-lg font-bold text-white transition disabled:opacity-50"
      >
        <Camera size={20} />
        {isActive ? 'Kamera AUS' : 'Kamera AN'}
      </button>

      {isActive && (
        <div className="relative bg-black rounded-lg overflow-hidden">
          <video
            ref={videoRef}
            autoPlay
            playsInline
            className="w-full aspect-video object-cover"
          />
          <canvas ref={canvasRef} className="hidden" />

          {/* Fadenkreuz markieren */}
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="w-20 h-20 border-2 border-red-500 rounded-full" />
            <div className="absolute w-0.5 h-12 bg-red-500" />
            <div className="absolute w-12 h-0.5 bg-red-500" />
          </div>

          {feedback && (
            <div className="absolute bottom-4 left-4 right-4 bg-green-500 text-white px-4 py-2 rounded-lg text-center font-bold">
              {feedback}
            </div>
          )}

          <button
            onClick={() => {
              setIsActive(false);
              if (onBack) setTimeout(onBack, 100);
            }}
            className="absolute top-4 right-4 p-2 bg-red-600 hover:bg-red-700 rounded-lg text-white"
          >
            <X size={20} />
          </button>
        </div>
      )}

      {cameraActive && (
        <div className="bg-blue-900/30 border border-blue-500 rounded-lg p-3">
          <p className="text-sm text-blue-200">
            💡 Positioniere deine Dartscheibe im Video. Die rote Markierung wird die registrierte
            Treffer-Position anzeigen.
          </p>
        </div>
      )}
    </div>
  );
}

export default CameraCapture;
