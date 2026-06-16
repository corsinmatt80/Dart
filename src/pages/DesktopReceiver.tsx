import { useEffect, useRef, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { Smartphone, Wifi, WifiOff, ArrowLeft } from 'lucide-react';
import { navigateToMenu } from '../App';
import { loadOpenCV, resetOpenCV, type CV } from '../lib/opencv';
import { detectBoard, drawOverlay } from '../lib/dartDetector';
import { createHost, type ConnState } from '../lib/connection';
import { scorePoint, type DetectionResult } from '../lib/dartGeometry';

const DETECT_INTERVAL_MS = 350;

export default function DesktopReceiver() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const resultRef = useRef<DetectionResult | null>(null);
  const cvRef = useRef<CV | null>(null);

  const [hostId, setHostId] = useState('');
  const [state, setState] = useState<ConnState>('connecting');
  const [cvStatus, setCvStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [cvError, setCvError] = useState('');
  const [cvRetry, setCvRetry] = useState(0);
  const [metrics, setMetrics] = useState<{ conf: number; rms: number; center: string } | null>(null);

  const cameraUrl = `${window.location.origin}${window.location.pathname}#/camera?h=${hostId}`;

  // OpenCV erst laden, wenn die Verbindung steht – das Parsen von ~10 MB JS
  // blockiert den Main Thread und wuerde sonst den WebRTC-Handshake stoeren
  // ("Bild kommt nicht an"). Ueber cvRetry retrybar.
  useEffect(() => {
    if (state !== 'connected') return;
    if (cvRef.current) {
      setCvStatus('ready');
      return;
    }
    let disposed = false;
    setCvStatus('loading');
    setCvError('');
    loadOpenCV()
      .then((c) => {
        if (disposed) return;
        cvRef.current = c;
        setCvStatus('ready');
      })
      .catch((e: unknown) => {
        if (disposed) return;
        cvRef.current = null;
        setCvStatus('error');
        setCvError(e instanceof Error ? e.message : String(e));
        console.error('OpenCV-Ladefehler:', e);
      });
    return () => {
      disposed = true;
    };
  }, [state, cvRetry]);

  const retryCv = () => {
    resetOpenCV();
    setCvRetry((n) => n + 1);
  };

  // Verbindung + Overlay-Render-Loop. Das Video-Element ist jetzt direkt
  // sichtbar (Browser-Compositor zeigt es auch waehrend der Main Thread durch
  // OpenCV blockiert ist – sonst wirkt das Bild "weg"). Das Canvas liegt nur
  // als Overlay darueber und zeichnet ausschliesslich die Detection-Ringe.
  useEffect(() => {
    let raf = 0;

    const host = createHost((stream) => {
      const v = videoRef.current;
      if (v) {
        v.srcObject = stream;
        v.play().catch(() => {});
      }
    }, setState);
    setHostId(host.hostId);

    const render = () => {
      raf = requestAnimationFrame(render);
      const v = videoRef.current;
      const c = canvasRef.current;
      if (!v || !c || !v.videoWidth) return;
      if (c.width !== v.videoWidth) {
        c.width = v.videoWidth;
        c.height = v.videoHeight;
      }
      const ctx = c.getContext('2d');
      if (!ctx) return;
      ctx.clearRect(0, 0, c.width, c.height);
      if (resultRef.current) drawOverlay(ctx, resultRef.current);
    };
    raf = requestAnimationFrame(render);

    return () => {
      cancelAnimationFrame(raf);
      host.destroy();
    };
  }, []);

  // Detection-Loop mit eigenem Offscreen-Canvas (damit das sichtbare Overlay-
  // Canvas frei bleibt). setTimeout-Chain statt rAF, damit der Browser
  // zwischen den Detection-Laeufen rendern und WebRTC-Frames decoden kann.
  useEffect(() => {
    let stopped = false;
    const off = document.createElement('canvas');
    const offCtx = off.getContext('2d', { willReadFrequently: true });

    const tick = () => {
      if (stopped) return;
      const cv = cvRef.current;
      const v = videoRef.current;
      if (cv && v && v.videoWidth && offCtx) {
        if (off.width !== v.videoWidth) {
          off.width = v.videoWidth;
          off.height = v.videoHeight;
        }
        try {
          offCtx.drawImage(v, 0, 0, off.width, off.height);
          const id = offCtx.getImageData(0, 0, off.width, off.height);
          const src = cv.matFromImageData(id);
          const r = detectBoard(cv, src, { workSize: 800 });
          src.delete();
          if (r) {
            resultRef.current = r;
            setMetrics({
              conf: r.confidence,
              rms: r.rmsPx,
              center: scorePoint(r, r.bull[0], r.bull[1]),
            });
          }
        } catch {
          /* einzelne Frame-Fehler ignorieren */
        }
      }
      setTimeout(tick, DETECT_INTERVAL_MS);
    };
    const handle = setTimeout(tick, DETECT_INTERVAL_MS);
    return () => {
      stopped = true;
      clearTimeout(handle);
    };
  }, []);

  const connected = state === 'connected';

  return (
    <div className="min-h-screen bg-gradient-to-br from-dark via-blue-900 to-dark p-4 text-white">
      <div className="mx-auto max-w-5xl">
        <button
          onClick={navigateToMenu}
          className="mb-4 flex items-center gap-2 rounded-lg border border-white/30 bg-white/10 px-4 py-2 hover:bg-white/20"
        >
          <ArrowLeft size={18} /> Menü
        </button>

        <h1 className="mb-1 text-3xl font-bold text-accent">Handy-Kamera verbinden</h1>
        <p className="mb-6 text-gray-400">
          Scanne den QR-Code mit dem Handy. Das Kamerabild wird hier angezeigt und live ausgewertet.
        </p>

        <div className="grid gap-6 md:grid-cols-[320px_1fr]">
          {/* Verbindungs-Panel */}
          <div className="rounded-lg border border-white/20 bg-white/5 p-5">
            <div className="mb-3 flex items-center gap-2 font-bold">
              <Smartphone size={18} className="text-blue-400" /> 1. Verbinden
            </div>
            <div className="flex justify-center rounded-lg bg-white p-3">
              {hostId ? <QRCodeSVG value={cameraUrl} size={220} /> : <div className="h-[220px]" />}
            </div>
            <p className="mt-3 break-all text-xs text-gray-400">{cameraUrl}</p>

            <div className="mt-4 flex items-center gap-2 text-sm">
              {connected ? (
                <Wifi className="text-green-400" size={18} />
              ) : (
                <WifiOff className="text-yellow-400" size={18} />
              )}
              <span>
                {state === 'waiting' && 'Warte auf Handy …'}
                {state === 'connecting' && 'Verbinde …'}
                {state === 'connected' && 'Verbunden'}
                {state === 'error' && 'Fehler bei der Verbindung'}
                {state === 'closed' && 'Verbindung getrennt'}
              </span>
            </div>
            <div className="mt-2 text-sm">
              OpenCV:{' '}
              {cvStatus === 'idle' && <span className="text-gray-400">wartet auf Verbindung</span>}
              {cvStatus === 'loading' && <span className="text-yellow-400">lädt … (~10 MB)</span>}
              {cvStatus === 'ready' && <span className="text-green-400">bereit</span>}
              {cvStatus === 'error' && <span className="text-red-400">Fehler</span>}
            </div>
            {cvStatus === 'error' && (
              <div className="mt-2 rounded border border-red-500/50 bg-red-900/30 p-2 text-xs text-red-200">
                <p className="mb-2">
                  OpenCV (Dartboard-Erkennung) konnte nicht geladen werden. Verbindung und Live-Bild
                  funktionieren trotzdem; nur die automatische Erkennung ist deaktiviert.
                </p>
                {cvError && <p className="mb-2 break-all opacity-70">{cvError}</p>}
                <button
                  onClick={retryCv}
                  className="rounded bg-red-500/80 px-3 py-1 font-semibold text-white hover:bg-red-500"
                >
                  Erneut versuchen
                </button>
              </div>
            )}
          </div>

          {/* Video + Overlay */}
          <div className="rounded-lg border border-white/20 bg-black/40 p-3">
            <div className="relative">
              {/* Video direkt sichtbar – damit es auch dann fluessig laeuft,
                  wenn der Main Thread durch OpenCV blockiert ist. */}
              <video
                ref={videoRef}
                className="block w-full rounded bg-black"
                playsInline
                muted
                autoPlay
              />
              {/* Canvas liegt als reines Detection-Overlay darueber. */}
              <canvas
                ref={canvasRef}
                className="pointer-events-none absolute inset-0 h-full w-full"
              />
              {!connected && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/60 text-gray-400">
                  Warte auf Kamerabild …
                </div>
              )}
            </div>
            {metrics && (
              <div className="mt-3 flex flex-wrap gap-4 text-sm">
                <span>
                  Konfidenz:{' '}
                  <b className={metrics.conf > 0.6 ? 'text-green-400' : 'text-yellow-400'}>
                    {metrics.conf.toFixed(2)}
                  </b>
                </span>
                <span>RMS: <b>{metrics.rms.toFixed(1)} px</b></span>
                <span>Bull-Feld: <b>{metrics.center}</b></span>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
