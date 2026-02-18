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

interface DartboardDetection {
  centerX: number;
  centerY: number;
  radius: number;
}

function MobileCamera() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null);
  const [cameraActive, setCameraActive] = useState(false);
  const [feedback, setFeedback] = useState<string>('');
  const [hitCount, setHitCount] = useState(0);
  const [isConnected, setIsConnected] = useState(false);
  const [dartboardDetected, setDartboardDetected] = useState(false);
  const prevFrameRef = useRef<ImageData | null>(null);
  const lastHitRef = useRef<number>(0);
  const dartboardRef = useRef<DartboardDetection | null>(null);
  const dartboardHistoryRef = useRef<DartboardDetection[]>([]);
  console.log("MobileCamera rendered");

  // Starte Kamera
  useEffect(() => {
    const startCamera = async () => {
      try {
        // Prüfe ob HTTPS vorhanden ist (notwendig für getUserMedia)
        if (window.location.protocol !== 'https:' && window.location.hostname !== 'localhost') {
          setFeedback('⚠️ HTTPS erforderlich! Kamera funktioniert nur auf sicheren Verbindungen.');
          setIsConnected(false);
          return;
        }

        // Prüfe ob getUserMedia verfügbar ist
        if (!navigator.mediaDevices?.getUserMedia) {
          setFeedback('❌ Kamera wird von diesem Browser nicht unterstützt');
          setIsConnected(false);
          return;
        }

        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment', width: { ideal: 640 }, height: { ideal: 480 } },
        });
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          setCameraActive(true);
          setIsConnected(true);
          setFeedback('');
        }
      } catch (err) {
        console.error('Kamera-Fehler:', err);
        setIsConnected(false);
        
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
      dartboardHistoryRef.current = [];
      dartboardRef.current = null;
      setDartboardDetected(false);
    };
  }, []);

  // Motion Detection & Dartboard Detection Loop
  useEffect(() => {
    if (!cameraActive || !canvasRef.current || !videoRef.current) return;

    const canvas = canvasRef.current;
    const overlayCanvas = overlayCanvasRef.current;
    const ctx = canvas.getContext('2d');
    const overlayCtx = overlayCanvas?.getContext('2d');
    if (!ctx || !overlayCtx) return;

    let detectionCounter = 0;

    const detectMotion = () => {
      const video = videoRef.current;
      if (!video || video.videoWidth === 0) {
        requestAnimationFrame(detectMotion);
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

      // Dartboard detection every 10 frames (für Performance)
      detectionCounter++;
      if (detectionCounter > 10) {
        const newDetection = detectDartboard(currentFrame);
        
        // Nutze temporale Filterung um Flackern zu vermeiden
        if (newDetection) {
          dartboardHistoryRef.current.push(newDetection);
          // Behalte die letzten 5 Detektionen
          if (dartboardHistoryRef.current.length > 5) {
            dartboardHistoryRef.current.shift();
          }
          
          // Berechne Durchschnitt der letzten Detektionen für Stabilität
          const smoothedDetection = smoothDartboardDetection(dartboardHistoryRef.current);
          
          // Nur aktualisierung wenn sich die Position genug geändert hat (Hysteresis)
          if (!dartboardRef.current || 
              Math.hypot(
                smoothedDetection.centerX - dartboardRef.current.centerX,
                smoothedDetection.centerY - dartboardRef.current.centerY
              ) > 30 ||
              Math.abs(smoothedDetection.radius - dartboardRef.current.radius) > 15) {
            dartboardRef.current = smoothedDetection;
            setDartboardDetected(true);
          }
        } else if (dartboardRef.current) {
          // Kein guter Fund, aber wir haben bereits eine Detection - behalte sie
          console.log('Dartboard-Erkennung schwach aber vorhanden, behalte alte Position');
        } else {
          // Versuche Fallback
          dartboardRef.current = detectDartboard(currentFrame);
          if (dartboardRef.current) {
            setDartboardDetected(true);
          }
        }
        
        detectionCounter = 0;
      }

      // Draw dartboard overlay
      if (dartboardRef.current && overlayCtx && overlayCanvas) {
        overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
        const db = dartboardRef.current;
        
        // Grüner Kreis um erkannte Dartscheibe
        overlayCtx.strokeStyle = 'rgba(0, 255, 0, 0.8)';
        overlayCtx.lineWidth = 3;
        overlayCtx.beginPath();
        overlayCtx.arc(db.centerX, db.centerY, db.radius, 0, Math.PI * 2);
        overlayCtx.stroke();
        
        // Grünes Fadenkreuz im Mittelpunkt
        overlayCtx.strokeStyle = 'rgba(0, 255, 0, 0.6)';
        overlayCtx.lineWidth = 2;
        overlayCtx.beginPath();
        overlayCtx.moveTo(db.centerX - 10, db.centerY);
        overlayCtx.lineTo(db.centerX + 10, db.centerY);
        overlayCtx.moveTo(db.centerX, db.centerY - 10);
        overlayCtx.lineTo(db.centerX, db.centerY + 10);
        overlayCtx.stroke();
      }

      // Motion detection - nur innerhalb der erkannten Dartscheibe
      if (prevFrameRef.current && dartboardRef.current) {
        const motionData = detectMotionArea(prevFrameRef.current, currentFrame, dartboardRef.current);
        if (motionData) {
          // Debounce: max 1 Treffer pro 2 Sekunden
          const now = Date.now();
          if (now - lastHitRef.current > 2000) {
            const dartHit = mapPositionToDart(
              motionData.centerX,
              motionData.centerY,
              dartboardRef.current.centerX,
              dartboardRef.current.centerY,
              dartboardRef.current.radius
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

  const getPixelBrightness = (data: Uint8ClampedArray, x: number, y: number, width: number): number => {
    if (x < 0 || x >= width || y < 0 || y >= Math.floor(data.length / 4 / width)) {
      return 127;
    }
    const idx = (y * width + x) * 4;
    return (data[idx] + data[idx + 1] + data[idx + 2]) / 3;
  };

  const smoothDartboardDetection = (detections: DartboardDetection[]): DartboardDetection => {
    // Berechne gewichteten Durchschnitt: neuere Frames zählen mehr
    const weights = detections.map((_, i) => 1 + i * 0.5); // Linear increasing weights
    const totalWeight = weights.reduce((a, b) => a + b, 0);

    let avgX = 0;
    let avgY = 0;
    let avgRadius = 0;

    for (let i = 0; i < detections.length; i++) {
      const weight = weights[i] / totalWeight;
      avgX += detections[i].centerX * weight;
      avgY += detections[i].centerY * weight;
      avgRadius += detections[i].radius * weight;
    }

    return {
      centerX: Math.round(avgX),
      centerY: Math.round(avgY),
      radius: Math.round(avgRadius),
    };
  };

  const detectDartboard = (frame: ImageData): DartboardDetection | null => {
    const data = frame.data;
    const width = frame.width;
    const height = frame.height;

    // Versuche zuerst Kanten-basierte Erkennung
    const edgeDetection = detectDartboardByEdges(data, width, height);
    if (edgeDetection) {
      return edgeDetection;
    }

    // Fallback: Dartscheibe ist wahrscheinlich in der Bildmitte
    // Das ist eine gute Annahme, wenn der Benutzer die Scheibe zentriert
    return {
      centerX: width / 2,
      centerY: height / 2,
      radius: Math.min(width, height) * 0.28,
    };
  };

  const detectDartboardByEdges = (data: Uint8ClampedArray, width: number, height: number): DartboardDetection | null => {
    // Erstelle ein Kantenbild für bessere Dartscheiben-Erkennung
    const edgeMap = new Uint8ClampedArray(width * height);

    // Sobel Edge Detection - findet Kanten
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        // X-Gradient
        const gx =
          -getPixelBrightness(data, x - 1, y - 1, width) * 1 +
          -getPixelBrightness(data, x - 1, y, width) * 2 +
          -getPixelBrightness(data, x - 1, y + 1, width) * 1 +
          getPixelBrightness(data, x + 1, y - 1, width) * 1 +
          getPixelBrightness(data, x + 1, y, width) * 2 +
          getPixelBrightness(data, x + 1, y + 1, width) * 1;

        // Y-Gradient
        const gy =
          -getPixelBrightness(data, x - 1, y - 1, width) * 1 +
          -getPixelBrightness(data, x, y - 1, width) * 2 +
          -getPixelBrightness(data, x + 1, y - 1, width) * 1 +
          getPixelBrightness(data, x - 1, y + 1, width) * 1 +
          getPixelBrightness(data, x, y + 1, width) * 2 +
          getPixelBrightness(data, x + 1, y + 1, width) * 1;

        const magnitude = Math.sqrt(gx * gx + gy * gy);
        edgeMap[y * width + x] = Math.min(255, magnitude);
      }
    }

    // Finde die beste Position für Dartscheibe (höchste Kantendichte)
    let bestScore = 0;
    let bestCenterX = width / 2;
    let bestCenterY = height / 2;

    // Suche mit größeren Steps für Performance
    const stepSize = 60;

    for (let y = stepSize; y < height - stepSize; y += stepSize) {
      for (let x = stepSize; x < width - stepSize; x += stepSize) {
        // Teste verschiedene Radii um diese Position und addiere alle Kantenpunkte
        let edgeScore = 0;
        
        // Prüfe alle Punkte auf konzentrischen Kreisen im Dartscheiben-Bereich
        for (let r = 40; r < 200; r += 5) {
          const pointsPerCircle = Math.max(8, Math.floor(r / 10));
          
          for (let i = 0; i < pointsPerCircle; i++) {
            const angle = (i / pointsPerCircle) * Math.PI * 2;
            const px = Math.round(x + Math.cos(angle) * r);
            const py = Math.round(y + Math.sin(angle) * r);

            if (px >= 0 && px < width && py >= 0 && py < height) {
              edgeScore += edgeMap[py * width + px];
            }
          }
        }

        // Bevorzuge Positionen nah bei der Bildmitte
        const centerDistancePenalty = Math.hypot(x - width / 2, y - height / 2) * 0.15;
        const finalScore = edgeScore - centerDistancePenalty;

        if (finalScore > bestScore) {
          bestScore = finalScore;
          bestCenterX = x;
          bestCenterY = y;
        }
      }
    }

    // Nur erkannte Dartscheibe akzeptieren wenn Score hoch genug ist
    if (bestScore < 100) {
      return null;
    }

    // Berechne Radius basierend auf Kantenerkennung an dieser Position
    const estimatedRadius = estimateDartboardRadius(edgeMap, width, height, bestCenterX, bestCenterY);

    return {
      centerX: bestCenterX,
      centerY: bestCenterY,
      radius: estimatedRadius,
    };
  };

  const estimateDartboardRadius = (edgeMap: Uint8ClampedArray, width: number, height: number, centerX: number, centerY: number): number => {
    // Finde den Radius indem wir nach der stärksten Kantendichte auf verschiedenen Radii suchen
    let maxEdgeDensity = 0;
    let bestRadius = 120;

    // Teste verschiedene Radii
    for (let r = 40; r < 200; r += 5) {
      let edgeDensity = 0;
      const pointsPerCircle = 32;

      // Sammle alle Kantenpunkte auf diesem Radius
      for (let i = 0; i < pointsPerCircle; i++) {
        const angle = (i / pointsPerCircle) * Math.PI * 2;
        const px = Math.round(centerX + Math.cos(angle) * r);
        const py = Math.round(centerY + Math.sin(angle) * r);

        if (px >= 0 && px < width && py >= 0 && py < height) {
          edgeDensity += edgeMap[py * width + px];
        }
      }

      // Normalisiere auf Durchschnitt pro Punkt
      edgeDensity = edgeDensity / pointsPerCircle;

      // Der beste Radius hat die höchste Kantendichte
      if (edgeDensity > maxEdgeDensity) {
        maxEdgeDensity = edgeDensity;
        bestRadius = r;
      }
    }

    // Stelle sicher dass der Radius sinnvoll ist
    return Math.max(60, Math.min(180, bestRadius));
  };

  const detectMotionArea = (prevFrame: ImageData, currFrame: ImageData, dartboard: DartboardDetection) => {
    const data1 = prevFrame.data;
    const data2 = currFrame.data;
    let motionX = 0,
      motionY = 0,
      motionCount = 0;

    // Nur nach Bewegung innerhalb der Dartscheibe suchen
    for (let i = 0; i < data1.length; i += 8) {
      // Berechne x, y aus pixel index
      const pixelIndex = i / 4;
      const x = pixelIndex % prevFrame.width;
      const y = Math.floor(pixelIndex / prevFrame.width);

      // Prüfe ob Punkt innerhalb der Dartscheibe liegt
      const dx = x - dartboard.centerX;
      const dy = y - dartboard.centerY;
      const distance = Math.sqrt(dx * dx + dy * dy);
      if (distance > dartboard.radius) continue;

      const r1 = data1[i];
      const g1 = data1[i + 1];
      const b1 = data1[i + 2];
      const r2 = data2[i];
      const g2 = data2[i + 1];
      const b2 = data2[i + 2];

      const diff = Math.abs(r1 - r2) + Math.abs(g1 - g2) + Math.abs(b1 - b2);
      if (diff > 30) {
        motionX += x;
        motionY += y;
        motionCount++;
      }
    }

    if (motionCount > 50) {
      return {
        centerX: Math.floor(motionX / motionCount),
        centerY: Math.floor(motionY / motionCount),
        magnitude: motionCount,
      };
    }

    return null;
  };

  const mapPositionToDart = (
    x: number,
    y: number,
    dartCenterX: number,
    dartCenterY: number,
    dartRadius: number
  ) => {
    // Berechne relative Position zur Dartscheibe
    const deltaX = x - dartCenterX;
    const deltaY = y - dartCenterY;

    // Normalisiere auf Dartscheibe Radius (0-1 bedeutet außerhalb)
    const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY) / dartRadius;
    const angle = Math.atan2(deltaY, deltaX) * (180 / Math.PI);

    // Dartscheibe Zahlen (oben anfangen, clockwise)
    const dartNumbers = [
      20, 1, 18, 4, 13, 6, 10, 15, 2, 17, 3, 19, 7, 16, 8, 11, 14, 9, 12, 5,
    ];

    // Normalisiere Winkel (0-360)
    let normalizedAngle = (angle + 90 + 360) % 360;
    const sectionIndex = Math.floor(normalizedAngle / 18) % 20;
    const dartValue = dartNumbers[sectionIndex];

    // Bestimme Multiplier basierend auf Distanz
    let multiplier = 1;
    if (distance > 0.3 && distance < 0.45) {
      multiplier = 3; // Triple Ring
    } else if (distance > 0.85 && distance < 1.0) {
      multiplier = 2; // Double Ring
    } else if (distance < 0.15) {
      return { x, y, value: 50, multiplier: 1, points: 50, timestamp: Date.now() }; // Bull
    } else if (distance < 0.22) {
      return { x, y, value: 25, multiplier: 1, points: 25, timestamp: Date.now() }; // Single Bull
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
        <canvas
          ref={overlayCanvasRef}
          className="absolute inset-0 w-full h-full"
          style={{ pointerEvents: 'none' }}
        />

        {/* Dartboard wird automatisch erkannt und grün markiert */}

        {/* Feedback */}
        {feedback && (
          <div className="absolute bottom-8 left-4 right-4 bg-green-600 text-white px-6 py-3 rounded-lg text-center font-bold shadow-lg">
            {feedback}
          </div>
        )}
        
        {!dartboardDetected && (
          <div className="absolute top-8 left-4 right-4 bg-yellow-500 text-black px-4 py-2 rounded-lg text-center font-bold">
            🎯 Dartscheibe wird erkannt...
          </div>
        )}
        
        {dartboardDetected && (
          <div className="absolute top-8 left-4 right-4 bg-green-600 text-white px-4 py-2 rounded-lg text-center font-bold">
            ✅ Dartscheibe erkannt! Werfe den Pfeil ab!
          </div>
        )}
      </div>

      {/* Footer Info */}
      <div className="bg-gray-900 px-4 py-4 border-t border-gray-700">
        <p className="text-gray-400 text-sm text-center">
          🎯 Die Dartscheibe wird automatisch erkannt (grüner Kreis). Jetzt einen Pfeil werfen!
        </p>
      </div>
    </div>
  );
}

export default MobileCamera;
