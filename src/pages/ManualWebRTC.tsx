import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Camera, Wifi, WifiOff, Copy, Check, ArrowRight, Video, VideoOff, RotateCcw } from 'lucide-react';
import LZString from 'lz-string';

type ConnectionState = 
  | 'idle'
  | 'offer_ready'
  | 'waiting_answer'
  | 'connected'
  | 'error';

interface ManualWebRTCProps {
  mode: 'desktop' | 'camera';
  onStreamReceived?: (stream: MediaStream) => void;
  onConnectionChange?: (connected: boolean) => void;
}

// Compress SDP to shorter string using LZ compression + base64
function compressSDP(sdp: string): string {
  // Remove unnecessary SDP lines to reduce size
  const minified = sdp
    .split('\n')
    .filter(line => !line.startsWith('a=extmap') && !line.startsWith('a=rtcp-rsize'))
    .join('\n');
  return LZString.compressToEncodedURIComponent(minified);
}

function decompressSDP(compressed: string): string {
  return LZString.decompressFromEncodedURIComponent(compressed) || '';
}

function ManualWebRTC({ mode, onStreamReceived, onConnectionChange }: ManualWebRTCProps) {
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const remoteStreamRef = useRef<MediaStream | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  
  const [connectionState, setConnectionState] = useState<ConnectionState>('idle');
  const [localOffer, setLocalOffer] = useState<string>('');
  const [localAnswer, setLocalAnswer] = useState<string>('');
  const [remoteInput, setRemoteInput] = useState<string>('');
  const [copied, setCopied] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);

  const iceServers = {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
      { urls: 'stun:stun2.l.google.com:19302' },
      { urls: 'stun:stun3.l.google.com:19302' },
      { urls: 'stun:stun4.l.google.com:19302' }
    ]
  };

  // Initialize peer connection
  const initPC = useCallback(() => {
    const pc = new RTCPeerConnection(iceServers);
    
    pc.onicecandidate = (event) => {
      if (!event.candidate) {
        // ICE gathering complete - update offer/answer with all candidates
        if (mode === 'desktop' && pc.localDescription) {
          setLocalOffer(compressSDP(JSON.stringify(pc.localDescription)));
        } else if (mode === 'camera' && pc.localDescription) {
          setLocalAnswer(compressSDP(JSON.stringify(pc.localDescription)));
        }
      }
    };

    pc.onconnectionstatechange = () => {
      console.log('Connection state:', pc.connectionState);
      if (pc.connectionState === 'connected') {
        setConnectionState('connected');
        onConnectionChange?.(true);
      } else if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') {
        setConnectionState('error');
        setErrorMessage('Verbindung fehlgeschlagen');
        onConnectionChange?.(false);
      }
    };

    pc.ontrack = (event) => {
      console.log('Received remote track:', event.streams);
      if (event.streams[0]) {
        remoteStreamRef.current = event.streams[0];
        if (videoRef.current) {
          videoRef.current.srcObject = event.streams[0];
          videoRef.current.play().catch(console.error);
        }
        onStreamReceived?.(event.streams[0]);
        setIsStreaming(true);
      }
    };

    pcRef.current = pc;
    return pc;
  }, [mode, onConnectionChange, onStreamReceived]);

  // Desktop: Create offer
  const createOffer = useCallback(async () => {
    try {
      // Close existing connection if any
      if (pcRef.current) {
        pcRef.current.close();
        pcRef.current = null;
      }
      
      // Reset state
      setLocalOffer('');
      setRemoteInput('');
      setErrorMessage('');
      
      const pc = initPC();
      
      // Add a transceiver to receive video
      pc.addTransceiver('video', { direction: 'recvonly' });
      
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      
      setConnectionState('offer_ready');
    } catch (err: any) {
      console.error('Error creating offer:', err);
      setErrorMessage(err.message);
      setConnectionState('error');
    }
  }, [initPC]);

  // Camera: Process offer and create answer
  const processOfferAndAnswer = useCallback(async () => {
    if (!remoteInput.trim()) {
      setErrorMessage('Bitte Angebot-Code einfügen');
      return;
    }

    // Check if camera API is available (requires HTTPS)
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setErrorMessage(
        '❌ Kamera-API nicht verfügbar!\n\n' +
        'Die Kamera funktioniert nur über HTTPS.\n\n' +
        'Bitte nutze die GitHub Pages Version:\n' +
        window.location.origin.replace('http://', 'https://').replace(/:\d+/, '') + '/Dart/#/manual-camera\n\n' +
        'Oder öffne die Seite über https://'
      );
      setConnectionState('error');
      return;
    }

    try {
      // Close existing connection if any
      if (pcRef.current) {
        pcRef.current.close();
        pcRef.current = null;
      }
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach(t => t.stop());
        localStreamRef.current = null;
      }
      
      // Reset state
      setLocalAnswer('');
      setErrorMessage('');

      // Get camera first
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: 'environment',
          width: { ideal: 1280 },
          height: { ideal: 720 }
        },
        audio: false
      });
      
      localStreamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }

      const pc = initPC();
      
      // Add local stream
      stream.getTracks().forEach(track => {
        pc.addTrack(track, stream);
      });

      // Set remote offer
      const offer = JSON.parse(decompressSDP(remoteInput.trim()));
      await pc.setRemoteDescription(new RTCSessionDescription(offer));

      // Create answer
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);

      setConnectionState('offer_ready'); // Re-using state for "answer ready"
    } catch (err: any) {
      console.error('Error processing offer:', err);
      setErrorMessage('Ungültiger Code: ' + err.message);
      setConnectionState('error');
    }
  }, [remoteInput, initPC]);

  // Desktop: Process answer
  const processAnswer = useCallback(async () => {
    if (!remoteInput.trim()) {
      setErrorMessage('Bitte Antwort-Code einfügen');
      return;
    }

    try {
      const pc = pcRef.current;
      if (!pc) {
        setErrorMessage('Keine Verbindung initialisiert');
        return;
      }

      const answer = JSON.parse(decompressSDP(remoteInput.trim()));
      await pc.setRemoteDescription(new RTCSessionDescription(answer));
      
      setConnectionState('waiting_answer');
    } catch (err: any) {
      console.error('Error processing answer:', err);
      setErrorMessage('Ungültiger Code: ' + err.message);
      setConnectionState('error');
    }
  }, [remoteInput]);

  const copyToClipboard = async (text: string) => {
    try {
      // Try modern clipboard API first
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      } else {
        // Fallback: create temporary textarea and use execCommand
        const textArea = document.createElement('textarea');
        textArea.value = text;
        textArea.style.position = 'fixed';
        textArea.style.left = '-9999px';
        textArea.style.top = '-9999px';
        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();
        
        try {
          document.execCommand('copy');
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        } catch (err) {
          // If execCommand fails, prompt user to copy manually
          prompt('Kopiere diesen Code:', text);
        }
        
        document.body.removeChild(textArea);
      }
    } catch (err) {
      // Ultimate fallback: show in prompt
      prompt('Kopiere diesen Code:', text);
    }
  };

  const reset = () => {
    if (pcRef.current) {
      pcRef.current.close();
      pcRef.current = null;
    }
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(t => t.stop());
      localStreamRef.current = null;
    }
    remoteStreamRef.current = null;
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setConnectionState('idle');
    setLocalOffer('');
    setLocalAnswer('');
    setRemoteInput('');
    setErrorMessage('');
    setIsStreaming(false);
    onConnectionChange?.(false);
  };

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (pcRef.current) {
        pcRef.current.close();
      }
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach(t => t.stop());
      }
    };
  }, []);

  // Attach remote stream to video when available
  useEffect(() => {
    if (videoRef.current && remoteStreamRef.current && mode === 'desktop') {
      console.log('Attaching remote stream to video element');
      videoRef.current.srcObject = remoteStreamRef.current;
      videoRef.current.play().catch(console.error);
    }
  }, [isStreaming, mode]);

  // Desktop view
  if (mode === 'desktop') {
    return (
      <div className="bg-gray-800 rounded-lg p-4">
        <h3 className="text-white font-bold mb-4 flex items-center gap-2">
          <Camera size={20} className="text-blue-400" />
          Manuelle Kamera-Verbindung
        </h3>

        {connectionState === 'idle' && (
          <div className="space-y-3">
            <p className="text-gray-400 text-sm">
              Klicke "Angebot erstellen" und kopiere den Code auf dein Handy.
            </p>
            <button
              onClick={createOffer}
              className="w-full py-3 bg-blue-600 hover:bg-blue-500 rounded-lg text-white font-bold"
            >
              1. Angebot erstellen
            </button>
          </div>
        )}

        {connectionState === 'offer_ready' && localOffer && (
          <div className="space-y-3">
            <p className="text-green-400 text-sm">✓ Angebot erstellt! Kopiere diesen Code:</p>
            <textarea
              readOnly
              value={localOffer}
              onClick={(e) => (e.target as HTMLTextAreaElement).select()}
              className="w-full p-2 bg-gray-900 border border-gray-600 rounded text-white text-xs font-mono h-20 select-all cursor-pointer"
            />
            <p className="text-gray-500 text-xs">Tippe auf das Textfeld um alles zu markieren</p>
            <button
              onClick={() => copyToClipboard(localOffer)}
              className="w-full py-2 bg-green-600 hover:bg-green-500 rounded-lg text-white font-bold flex items-center justify-center gap-2"
            >
              {copied ? <Check size={18} /> : <Copy size={18} />}
              {copied ? 'Kopiert!' : 'Angebot kopieren'}
            </button>
            
            <div className="border-t border-gray-700 pt-3 mt-3">
              <p className="text-gray-400 text-sm mb-2">Füge hier die Antwort vom Handy ein:</p>
              <textarea
                value={remoteInput}
                onChange={(e) => setRemoteInput(e.target.value)}
                placeholder="Antwort-Code hier einfügen..."
                className="w-full p-2 bg-gray-900 border border-gray-600 rounded text-white text-xs font-mono h-20"
              />
              <button
                onClick={processAnswer}
                className="w-full py-2 mt-2 bg-purple-600 hover:bg-purple-500 rounded-lg text-white font-bold flex items-center justify-center gap-2"
              >
                <ArrowRight size={18} />
                2. Antwort verarbeiten
              </button>
            </div>
          </div>
        )}

        {connectionState === 'connected' && (
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-green-400">
              <Wifi size={20} />
              <span className="font-bold">Verbunden!</span>
            </div>
          </div>
        )}

        {/* Always render video element for desktop */}
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className={`w-full rounded-lg bg-black mt-3 ${isStreaming ? '' : 'hidden'}`}
          style={{ minHeight: isStreaming ? '200px' : '0' }}
        />

        {connectionState === 'waiting_answer' && (
          <div className="text-center py-4">
            <div className="animate-pulse text-yellow-400">Warte auf Verbindung...</div>
          </div>
        )}

        {errorMessage && (
          <div className="mt-3 p-2 bg-red-600/20 border border-red-500 rounded text-red-400 text-sm">
            {errorMessage}
          </div>
        )}

        {connectionState !== 'idle' && (
          <button
            onClick={reset}
            className="w-full mt-3 py-2 bg-gray-600 hover:bg-gray-500 rounded-lg text-white flex items-center justify-center gap-2"
          >
            <RotateCcw size={16} />
            Zurücksetzen
          </button>
        )}
      </div>
    );
  }

  // Camera view (phone)
  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-blue-900 to-gray-900 p-4">
      <h1 className="text-2xl font-bold text-white mb-4 flex items-center gap-2">
        <Camera size={28} className="text-blue-400" />
        Dart Kamera
      </h1>

      {connectionState === 'idle' && (
        <div className="space-y-4">
          <div className="bg-gray-800 rounded-lg p-4">
            <p className="text-gray-300 text-sm mb-3">
              1. Füge den Angebot-Code vom Desktop hier ein:
            </p>
            <textarea
              value={remoteInput}
              onChange={(e) => setRemoteInput(e.target.value)}
              placeholder="Angebot-Code hier einfügen..."
              className="w-full p-3 bg-gray-900 border border-gray-600 rounded-lg text-white text-xs font-mono h-32"
            />
            <button
              onClick={processOfferAndAnswer}
              className="w-full py-3 mt-3 bg-blue-600 hover:bg-blue-500 rounded-lg text-white font-bold flex items-center justify-center gap-2"
            >
              <Video size={20} />
              Kamera starten & Antwort erstellen
            </button>
          </div>
        </div>
      )}

      {connectionState === 'offer_ready' && localAnswer && (
        <div className="space-y-4">
          <div className="bg-gray-800 rounded-lg p-4">
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              className="w-full rounded-lg bg-black mb-4"
            />
            <p className="text-green-400 text-sm mb-2">✓ Antwort erstellt! Kopiere diesen Code zum Desktop:</p>
            <textarea
              readOnly
              value={localAnswer}
              onClick={(e) => (e.target as HTMLTextAreaElement).select()}
              className="w-full p-2 bg-gray-900 border border-gray-600 rounded text-white text-xs font-mono h-20 select-all cursor-pointer"
            />
            <p className="text-gray-400 text-xs mb-2">Tippe auf das Textfeld um alles zu markieren</p>
            <button
              onClick={() => copyToClipboard(localAnswer)}
              className="w-full py-3 bg-green-600 hover:bg-green-500 rounded-lg text-white font-bold flex items-center justify-center gap-2"
            >
              {copied ? <Check size={20} /> : <Copy size={20} />}
              {copied ? 'Kopiert!' : 'Antwort kopieren'}
            </button>
            <p className="text-yellow-400 text-sm mt-3 text-center">
              Warte auf Verbindung nach Einfügen am Desktop...
            </p>
          </div>
        </div>
      )}

      {connectionState === 'connected' && (
        <div className="space-y-4">
          <div className="bg-green-600/20 border border-green-500 rounded-lg p-4 flex items-center gap-3">
            <Wifi size={24} className="text-green-400" />
            <div>
              <p className="text-green-400 font-bold">Verbunden!</p>
              <p className="text-green-300 text-sm">Video wird gestreamt</p>
            </div>
          </div>
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            className="w-full rounded-lg bg-black"
          />
          {isStreaming && (
            <div className="absolute top-4 right-4 px-3 py-1 bg-red-600 rounded-full text-white text-sm font-bold flex items-center gap-2">
              <span className="w-2 h-2 bg-white rounded-full animate-pulse"></span>
              LIVE
            </div>
          )}
        </div>
      )}

      {errorMessage && (
        <div className="mt-4 p-3 bg-red-600/20 border border-red-500 rounded-lg text-red-400">
          {errorMessage}
        </div>
      )}

      <button
        onClick={reset}
        className="w-full mt-4 py-3 bg-gray-700 hover:bg-gray-600 rounded-lg text-white flex items-center justify-center gap-2"
      >
        <RotateCcw size={18} />
        Zurücksetzen
      </button>
    </div>
  );
}

export default ManualWebRTC;
