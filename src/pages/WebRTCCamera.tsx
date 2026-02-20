import React, { useEffect, useRef, useState, useCallback } from 'react';
import Peer, { DataConnection, MediaConnection } from 'peerjs';
import { Camera, Wifi, WifiOff, RotateCcw, CheckCircle, Loader2, Video, VideoOff } from 'lucide-react';

type ConnectionState = 
  | 'initializing'
  | 'camera_request'
  | 'camera_ready'
  | 'connecting'
  | 'connected'
  | 'error';

function WebRTCCamera() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const peerRef = useRef<Peer | null>(null);
  const dataConnectionRef = useRef<DataConnection | null>(null);
  const mediaConnectionRef = useRef<MediaConnection | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const [connectionState, setConnectionState] = useState<ConnectionState>('initializing');
  const [sessionId, setSessionId] = useState<string>('');
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [isStreaming, setIsStreaming] = useState(false);

  // Extract session ID from URL hash
  useEffect(() => {
    const hash = window.location.hash;
    console.log('WebRTCCamera: Full hash:', hash);
    const hashParams = hash.includes('?') ? hash.split('?')[1] : '';
    console.log('WebRTCCamera: Hash params:', hashParams);
    const urlParams = new URLSearchParams(hashParams);
    const session = urlParams.get('session');
    console.log('WebRTCCamera: Extracted session:', session);
    
    if (session) {
      setSessionId(session);
    } else {
      setErrorMessage('Keine Session-ID gefunden. Bitte QR-Code erneut scannen.');
      setConnectionState('error');
    }
  }, []);

  // Initialize camera
  const initCamera = useCallback(async () => {
    try {
      setConnectionState('camera_request');
      
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: 'environment',
          width: { ideal: 1280, min: 640 },
          height: { ideal: 720, min: 480 },
          frameRate: { ideal: 30, min: 15 }
        },
        audio: false
      });

      streamRef.current = stream;
      
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }

      setConnectionState('camera_ready');
    } catch (err: any) {
      console.error('Camera error:', err);
      setErrorMessage('Kamera-Zugriff verweigert. Bitte Berechtigung erteilen.');
      setConnectionState('error');
    }
  }, []);

  // Connect to desktop peer
  const connectToDesktop = useCallback(() => {
    if (!sessionId || !streamRef.current) {
      setErrorMessage('Kamera nicht bereit oder keine Session.');
      return;
    }

    setConnectionState('connecting');
    
    const targetPeerId = `dart-desktop-${sessionId}`;
    const myPeerId = `dart-camera-${sessionId}-${Date.now()}`;

    const peer = new Peer(myPeerId, {
      debug: 2,
      config: {
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:stun1.l.google.com:19302' },
          { urls: 'stun:stun2.l.google.com:19302' },
          { urls: 'stun:stun3.l.google.com:19302' },
          { urls: 'stun:stun4.l.google.com:19302' }
        ]
      }
    });

    peerRef.current = peer;

    peer.on('open', () => {
      console.log('Camera peer ready, connecting to:', targetPeerId);
      
      // Create data connection first
      const dataConn = peer.connect(targetPeerId, { reliable: true });
      dataConnectionRef.current = dataConn;
      
      dataConn.on('open', () => {
        console.log('Data connection established to:', targetPeerId);
        
        // Now make the media call
        const stream = streamRef.current;
        if (stream) {
          const mediaConn = peer.call(targetPeerId, stream);
          mediaConnectionRef.current = mediaConn;
          
          mediaConn.on('stream', () => {
            // We don't expect a stream back, but handle it
          });
          
          mediaConn.on('close', () => {
            console.log('Media connection closed');
            setIsStreaming(false);
            setConnectionState('camera_ready');
          });
          
          mediaConn.on('error', (err) => {
            console.error('Media error:', err);
          });
          
          setIsStreaming(true);
          setConnectionState('connected');
          
          // Notify desktop that camera is ready
          dataConn.send({ type: 'camera_connected', timestamp: Date.now() });
        }
      });

      dataConn.on('data', (data: any) => {
        console.log('Received from desktop:', data);
        if (data.type === 'ping') {
          dataConn.send({ type: 'pong', timestamp: data.timestamp });
        }
      });

      dataConn.on('close', () => {
        console.log('Data connection closed');
        setConnectionState('camera_ready');
        setIsStreaming(false);
      });

      dataConn.on('error', (err) => {
        console.error('Data connection error:', err);
      });
    });

    peer.on('error', (err) => {
      console.error('Peer error:', err);
      setErrorMessage(`Verbindungsfehler: ${err.message}`);
      setConnectionState('error');
    });

    peer.on('disconnected', () => {
      console.log('Peer disconnected');
      setConnectionState('camera_ready');
      setIsStreaming(false);
    });
  }, [sessionId]);

  // Initialize camera on mount
  useEffect(() => {
    if (sessionId) {
      initCamera();
    }
  }, [sessionId, initCamera]);

  // Auto-connect when camera is ready
  useEffect(() => {
    if (connectionState === 'camera_ready' && streamRef.current && !peerRef.current) {
      console.log('Auto-connecting to desktop in 500ms...');
      const timer = setTimeout(() => {
        if (streamRef.current && !peerRef.current) {
          console.log('Auto-connect: executing connectToDesktop');
          connectToDesktop();
        }
      }, 500);
      return () => clearTimeout(timer);
    }
  }, [connectionState, connectToDesktop]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
      }
      if (peerRef.current) {
        peerRef.current.destroy();
      }
    };
  }, []);

  // Disconnect
  const disconnect = () => {
    if (mediaConnectionRef.current) {
      mediaConnectionRef.current.close();
    }
    if (dataConnectionRef.current) {
      dataConnectionRef.current.close();
    }
    if (peerRef.current) {
      peerRef.current.destroy();
      peerRef.current = null;
    }
    setIsStreaming(false);
    setConnectionState('camera_ready');
  };

  const getStatusColor = () => {
    switch (connectionState) {
      case 'connected': return 'bg-green-600';
      case 'connecting': return 'bg-yellow-600';
      case 'camera_ready': return 'bg-blue-600';
      case 'error': return 'bg-red-600';
      default: return 'bg-gray-600';
    }
  };

  const getStatusText = () => {
    switch (connectionState) {
      case 'initializing': return 'Initialisiere...';
      case 'camera_request': return 'Kamera-Zugriff anfordern...';
      case 'camera_ready': return 'Kamera bereit - Verbinde...';
      case 'connecting': return 'Verbinde mit Desktop...';
      case 'connected': return 'Verbunden & Streaming';
      case 'error': return 'Fehler';
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-blue-900 to-gray-900 flex flex-col">
      {/* Header */}
      <div className="p-4 flex items-center justify-between">
        <h1 className="text-xl font-bold text-white flex items-center gap-2">
          <Camera size={24} className="text-blue-400" />
          Dart Kamera
        </h1>
        <div className={`px-3 py-1 rounded-full text-white text-sm font-medium flex items-center gap-2 ${getStatusColor()}`}>
          {connectionState === 'connecting' && <Loader2 size={14} className="animate-spin" />}
          {connectionState === 'connected' && <Wifi size={14} />}
          {connectionState === 'error' && <WifiOff size={14} />}
          {getStatusText()}
        </div>
      </div>

      {/* Video Preview */}
      <div className="flex-1 relative bg-black">
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className="w-full h-full object-cover"
        />
        
        {connectionState === 'camera_request' && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/80">
            <div className="text-center text-white">
              <Loader2 size={48} className="animate-spin mx-auto mb-4" />
              <p>Kamera-Zugriff wird angefordert...</p>
              <p className="text-sm text-gray-400 mt-2">Bitte "Erlauben" tippen</p>
            </div>
          </div>
        )}

        {isStreaming && (
          <div className="absolute top-4 left-4 px-3 py-1 bg-red-600 rounded-full text-white text-sm font-bold flex items-center gap-2">
            <span className="w-2 h-2 bg-white rounded-full animate-pulse"></span>
            LIVE
          </div>
        )}
      </div>

      {/* Controls */}
      <div className="p-4 space-y-3">
        {sessionId && (
          <div className="bg-white/10 rounded-lg p-3 text-center">
            <p className="text-gray-400 text-xs">Session:</p>
            <p className="text-white font-mono font-bold text-lg">{sessionId}</p>
          </div>
        )}

        {errorMessage && (
          <div className="bg-red-600/20 border border-red-500 rounded-lg p-3 text-center">
            <p className="text-red-400 text-sm">{errorMessage}</p>
          </div>
        )}

        {connectionState === 'camera_ready' && (
          <button
            onClick={connectToDesktop}
            className="w-full py-4 bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-500 hover:to-emerald-500 rounded-xl text-white font-bold text-lg flex items-center justify-center gap-2 transition"
          >
            <Video size={24} />
            Mit Desktop verbinden
          </button>
        )}

        {connectionState === 'connected' && (
          <button
            onClick={disconnect}
            className="w-full py-4 bg-gradient-to-r from-red-600 to-orange-600 hover:from-red-500 hover:to-orange-500 rounded-xl text-white font-bold text-lg flex items-center justify-center gap-2 transition"
          >
            <VideoOff size={24} />
            Trennen
          </button>
        )}

        {connectionState === 'error' && (
          <button
            onClick={() => window.location.reload()}
            className="w-full py-4 bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-500 hover:to-purple-500 rounded-xl text-white font-bold text-lg flex items-center justify-center gap-2 transition"
          >
            <RotateCcw size={24} />
            Neu laden
          </button>
        )}
      </div>
    </div>
  );
}

export default WebRTCCamera;
