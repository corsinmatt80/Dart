import React, { useEffect, useRef, useState } from 'react';
import { Camera, X, Wifi, WifiOff } from 'lucide-react';

interface DartHit {
  x: number;
  y: number;
  value: number;
  multiplier: number;
  points: number;
  timestamp: number;
}

function MobileCamera() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [cameraActive, setCameraActive] = useState(false);
  const [feedback, setFeedback] = useState<string>('');
  const [hitCount, setHitCount] = useState(0);
  const [isConnected, setIsConnected] = useState(false);
  const prevFrameRef = useRef<ImageData | null>(null);
  const lastHitRef = useRef<number>(0);
  console.log("MobileCamera rendered");

  // Starte Kamera
  useEffect(() => {
    const startCamera = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment', width: { ideal: 640 }, height: { ideal: 480 } },
        });
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          setCameraActive(true);
          setIsConnected(true);
        }
      } catch (err) {
        console.error('Kamera-Fehler:', err);
        setFeedback('❌ Kamera nicht verfügbar');
        setIsConnected(false);
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
  }, []);

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

      ctx.drawImage(video, 0, 0);
      const currentFrame = ctx.getImageData(0, 0, canvas.width, canvas.height);

      if (prevFrameRef.current) {
        const motionData = detectMotionArea(prevFrameRef.current, currentFrame);
        if (motionData) {
          // Debounce: max 1 Treffer pro 2 Sekunden
          const now = Date.now();
          if (now - lastHitRef.current > 2000) {
            const dartHit = mapPositionToDart(
              motionData.centerX,
              motionData.centerY,
              canvas.width,
              canvas.height
            );

            // Sende Treffer an Desktop
            sendHitToDesktop(dartHit);
            lastHitRef.current = now;
            setHitCount((prev) => prev + 1);
            setFeedback(`✅ Treffer #${hitCount + 1}: ${dartHit.value}${dartHit.multiplier > 1 ? 'x' + dartHit.multiplier : ''}`);
            
            setTimeout(() => setFeedback(''), 2000);
          }
        }
      }

      prevFrameRef.current = currentFrame;
      requestAnimationFrame(detectMotion);
    };

    const animationId = requestAnimationFrame(detectMotion);
    return () => cancelAnimationFrame(animationId);
  }, [cameraActive, hitCount]);

  const detectMotionArea = (prevFrame: ImageData, currFrame: ImageData) => {
    const data1 = prevFrame.data;
    const data2 = currFrame.data;
    let motionX = 0,
      motionY = 0,
      motionCount = 0;

    for (let i = 0; i < data1.length; i += 8) {
      const r1 = data1[i];
      const g1 = data1[i + 1];
      const b1 = data1[i + 2];
      const r2 = data2[i];
      const g2 = data2[i + 1];
      const b2 = data2[i + 2];

      const diff = Math.abs(r1 - r2) + Math.abs(g1 - g2) + Math.abs(b1 - b2);
      if (diff > 30) {
        motionX += i % prevFrame.width;
        motionY += Math.floor(i / prevFrame.width);
        motionCount++;
      }
    }

    if (motionCount > 100) {
      return {
        centerX: Math.floor(motionX / motionCount),
        centerY: Math.floor(motionY / motionCount),
        magnitude: motionCount,
      };
    }

    return null;
  };

  const mapPositionToDart = (x: number, y: number, width: number, height: number) => {
    const normalizedX = x / width;
    const normalizedY = y / height;

    const centerX = 0.5;
    const centerY = 0.5;
    const deltaX = normalizedX - centerX;
    const deltaY = normalizedY - centerY;

    const angle = Math.atan2(deltaY, deltaX) * (180 / Math.PI);
    const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);

    const dartNumbers = [
      20, 1, 18, 4, 13, 6, 10, 15, 2, 17, 3, 19, 7, 16, 8, 11, 14, 9, 12, 5,
    ];

    let normalizedAngle = (angle + 90 + 360) % 360;
    const sectionIndex = Math.floor(normalizedAngle / 18) % 20;
    const dartValue = dartNumbers[sectionIndex];

    let multiplier = 1;
    if (distance > 0.3 && distance < 0.45) {
      multiplier = 3;
    } else if (distance > 0.85 && distance < 1.0) {
      multiplier = 2;
    } else if (distance < 0.15) {
      return { x, y, value: 50, multiplier: 1, points: 50, timestamp: Date.now() };
    } else if (distance < 0.22) {
      return { x, y, value: 25, multiplier: 1, points: 25, timestamp: Date.now() };
    }

    return {
      x,
      y,
      value: dartValue,
      multiplier,
      points: dartValue * multiplier,
      timestamp: Date.now(),
    };
  };

  const sendHitToDesktop = (dartHit: DartHit) => {
    try {
      // Speichere im localStorage (wird vom Desktop-Fenster abgerufen)
      const hits = JSON.parse(localStorage.getItem('mobile_hits') || '[]');
      hits.push(dartHit);
      localStorage.setItem('mobile_hits', JSON.stringify(hits));

      // Sende auch als Custom Event (falls Desktop-Tab offen)
      window.dispatchEvent(
        new CustomEvent('dartHit', {
          detail: dartHit,
        })
      );

      console.log('Treffer gesendet:', dartHit);
    } catch (err) {
      console.error('Fehler beim Speichern:', err);
    }
  };

  return (
    <div className="w-full h-screen bg-black flex flex-col">
      {/* Header */}
      <div className="bg-gray-900 px-4 py-3 border-b border-gray-700 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Camera size={24} className="text-red-500" />
          <h1 className="text-white font-bold">Dart Kamera</h1>
        </div>
        <div className="flex items-center gap-2">
          {isConnected ? (
            <Wifi size={20} className="text-green-500" />
          ) : (
            <WifiOff size={20} className="text-red-500" />
          )}
          <span className="text-white text-sm">Treffer: {hitCount}</span>
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

        {/* Fadenkreuz */}
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="w-24 h-24 border-2 border-red-500 rounded-full" />
          <div className="absolute w-0.5 h-16 bg-red-500/70" />
          <div className="absolute w-16 h-0.5 bg-red-500/70" />
        </div>

        {/* Feedback */}
        {feedback && (
          <div className="absolute bottom-8 left-4 right-4 bg-green-600 text-white px-6 py-3 rounded-lg text-center font-bold shadow-lg">
            {feedback}
          </div>
        )}
      </div>

      {/* Footer Info */}
      <div className="bg-gray-900 px-4 py-4 border-t border-gray-700">
        <p className="text-gray-400 text-sm text-center">
          📱 Positioniere die Dartscheibe im Video. Werfe einen Pfeil ab!
        </p>
      </div>
    </div>
  );
}

export default MobileCamera;
