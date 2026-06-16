import { useEffect, useRef, useState } from 'react';
import { Camera, Wifi, WifiOff } from 'lucide-react';
import { createGuest, type ConnState } from '../lib/connection';

function hostIdFromHash(): string {
  const q = window.location.hash.split('?')[1] || '';
  return new URLSearchParams(q).get('h') || '';
}

export default function PhoneCamera() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [state, setState] = useState<ConnState>('connecting');
  const [error, setError] = useState('');
  const hostId = hostIdFromHash();

  useEffect(() => {
    if (!hostId) {
      setError('Keine Host-ID in der URL — bitte den QR-Code auf dem Desktop scannen.');
      return;
    }

    let guest: ReturnType<typeof createGuest> | null = null;
    let stream: MediaStream | null = null;
    let disposed = false;

    navigator.mediaDevices
      .getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      })
      .then((s) => {
        if (disposed) {
          s.getTracks().forEach((t) => t.stop());
          return;
        }
        stream = s;
        if (videoRef.current) {
          videoRef.current.srcObject = s;
          videoRef.current.play().catch(() => {});
        }
        guest = createGuest(hostId, s, setState);
      })
      .catch((e) => setError('Kamerazugriff fehlgeschlagen: ' + e));

    return () => {
      disposed = true;
      guest?.destroy();
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [hostId]);

  return (
    <div className="flex min-h-screen flex-col bg-black text-white">
      <div className="flex items-center justify-between p-4">
        <div className="flex items-center gap-2 font-bold">
          <Camera size={20} className="text-accent" /> Dart-Kamera
        </div>
        <div className="flex items-center gap-2 text-sm">
          {state === 'connected' ? (
            <Wifi className="text-green-400" size={18} />
          ) : (
            <WifiOff className="text-yellow-400" size={18} />
          )}
          {state === 'connected' ? 'verbunden' : 'verbinde …'}
        </div>
      </div>

      {error ? (
        <div className="m-4 rounded-lg border border-red-500 bg-red-900/40 p-4 text-red-200">{error}</div>
      ) : (
        <>
          <video ref={videoRef} className="w-full flex-1 object-contain" playsInline muted autoPlay />
          <p className="p-4 text-center text-sm text-gray-400">
            Halte die Kamera ruhig auf das Dartboard. Das Bild wird an den Desktop gestreamt und dort
            ausgewertet.
          </p>
        </>
      )}
    </div>
  );
}
