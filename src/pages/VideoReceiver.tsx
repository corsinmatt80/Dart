import React, { useEffect, useRef, useState, useCallback } from 'react';
import Peer, { DataConnection } from 'peerjs';
import { Camera, Wifi, WifiOff, RotateCcw, Maximize2, Minimize2 } from 'lucide-react';

type ConnectionState = 
  | 'initializing'
  | 'waiting'
  | 'connected'
  | 'error';

interface VideoReceiverProps {
  sessionId: string;
  onConnectionChange?: (connected: boolean) => void;
  onSessionError?: () => void;
  onPeerReady?: (ready: boolean) => void;
}

function VideoReceiver({ sessionId, onConnectionChange, onSessionError, onPeerReady }: VideoReceiverProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const peerRef = useRef<Peer | null>(null);
  const dataConnectionRef = useRef<DataConnection | null>(null);
  const initializingRef = useRef(false);
  const retryCountRef = useRef(0);
  const maxRetries = 3;

  const [connectionState, setConnectionState] = useState<ConnectionState>('initializing');
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [isFullscreen, setIsFullscreen] = useState(false);

  // Initialize PeerJS
  const initPeer = useCallback(() => {
    // Prevent double initialization (React StrictMode)
    if (initializingRef.current) {
      console.log('VideoReceiver: Already initializing, skipping');
      return;
    }
    
    // Check retry limit
    if (retryCountRef.current >= maxRetries) {
      console.log('VideoReceiver: Max retries reached, giving up');
      setErrorMessage('Server nicht erreichbar. Bitte Seite neu laden.');
      setConnectionState('error');
      return;
    }
    
    initializingRef.current = true;
    retryCountRef.current++;

    // Cleanup existing peer first
    if (peerRef.current) {
      console.log('VideoReceiver: Destroying existing peer');
      peerRef.current.destroy();
      peerRef.current = null;
    }

    const desktopPeerId = `dart-desktop-${sessionId}`;
    console.log('VideoReceiver: Creating desktop peer:', desktopPeerId);
    console.log('VideoReceiver: Session ID:', sessionId);
    console.log('VideoReceiver: Retry attempt:', retryCountRef.current);

    const peer = new Peer(desktopPeerId, {
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

    peer.on('open', (id) => {
      console.log('VideoReceiver: Desktop peer ready with ID:', id);
      console.log('VideoReceiver: Now waiting for incoming connections...');
      initializingRef.current = false;
      retryCountRef.current = 0; // Reset on success
      setConnectionState('waiting');
      onPeerReady?.(true);
    });

    // Handle incoming data connection
    peer.on('connection', (dataConn) => {
      console.log('VideoReceiver: Incoming data connection from:', dataConn.peer);
      dataConnectionRef.current = dataConn;

      dataConn.on('open', () => {
        console.log('Data connection open');
      });

      dataConn.on('data', (data: any) => {
        console.log('Received:', data);
        
        if (data.type === 'camera_connected') {
          setConnectionState('connected');
          onConnectionChange?.(true);
        }
      });

      dataConn.on('close', () => {
        console.log('Data connection closed');
        setConnectionState('waiting');
        onConnectionChange?.(false);
      });
    });

    // Handle incoming media call
    peer.on('call', (mediaConn) => {
      console.log('Incoming media call from:', mediaConn.peer);
      
      // Answer without sending our own stream
      mediaConn.answer();
      
      mediaConn.on('stream', (remoteStream) => {
        console.log('Received remote stream');
        
        if (videoRef.current) {
          videoRef.current.srcObject = remoteStream;
          videoRef.current.play().catch(err => {
            console.error('Video play error:', err);
          });
        }
        
        setConnectionState('connected');
        onConnectionChange?.(true);
      });

      mediaConn.on('close', () => {
        console.log('Media connection closed');
        if (videoRef.current) {
          videoRef.current.srcObject = null;
        }
        setConnectionState('waiting');
        onConnectionChange?.(false);
      });
    });

    peer.on('error', (err) => {
      console.error('Peer error:', err);
      initializingRef.current = false;
      onPeerReady?.(false);
      
      if (err.type === 'unavailable-id') {
        console.log('VideoReceiver: ID taken, requesting new session');
        // Request parent to generate new session ID
        onSessionError?.();
        return;
      } else {
        setErrorMessage(`Verbindungsfehler: ${err.message}`);
      }
      setConnectionState('error');
    });

    peer.on('disconnected', () => {
      console.log('Peer disconnected');
      // Don't auto-reconnect - let user refresh if needed
      setConnectionState('error');
      setErrorMessage('Verbindung zum Server verloren.');
    });
  }, [sessionId, onConnectionChange, onSessionError, onPeerReady]);

  // Initialize on mount
  useEffect(() => {
    // Reset initializing flag when session changes
    initializingRef.current = false;
    
    if (sessionId) {
      initPeer();
    }

    return () => {
      initializingRef.current = false;
      if (dataConnectionRef.current) {
        dataConnectionRef.current.close();
      }
      if (peerRef.current) {
        peerRef.current.destroy();
        peerRef.current = null;
      }
    };
  }, [sessionId, initPeer]);

  // Toggle fullscreen
  const toggleFullscreen = () => {
    const container = videoRef.current?.parentElement;
    if (!container) return;
    
    if (!document.fullscreenElement) {
      container.requestFullscreen();
      setIsFullscreen(true);
    } else {
      document.exitFullscreen();
      setIsFullscreen(false);
    }
  };

  // Reset connection
  const resetConnection = () => {
    if (peerRef.current) {
      peerRef.current.destroy();
    }
    setConnectionState('initializing');
    setErrorMessage('');
    setTimeout(initPeer, 500);
  };

  return (
    <div className="bg-white/10 backdrop-blur-md rounded-xl overflow-hidden border border-white/20">
      <div className="aspect-video bg-black relative">
        <video
          ref={videoRef}
          autoPlay
          playsInline
          className="w-full h-full object-contain"
        />
        
        {connectionState !== 'connected' && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/80">
            <div className="text-center">
              {connectionState === 'initializing' && (
                <>
                  <div className="w-12 h-12 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
                  <p className="text-gray-400">Initialisiere...</p>
                </>
              )}
              {connectionState === 'waiting' && (
                <>
                  <Camera size={48} className="text-gray-500 mx-auto mb-4" />
                  <p className="text-gray-400">Warte auf Kamera-Verbindung...</p>
                  <p className="text-gray-500 text-sm mt-2">Scanne den QR-Code mit deinem Handy</p>
                </>
              )}
              {connectionState === 'error' && (
                <>
                  <WifiOff size={48} className="text-red-500 mx-auto mb-4" />
                  <p className="text-red-400">{errorMessage}</p>
                </>
              )}
            </div>
          </div>
        )}
        
        {connectionState === 'connected' && (
          <div className="absolute top-2 right-2 flex gap-2">
            <button
              onClick={toggleFullscreen}
              className="p-2 bg-black/50 hover:bg-black/70 rounded-lg text-white transition"
            >
              {isFullscreen ? <Minimize2 size={20} /> : <Maximize2 size={20} />}
            </button>
          </div>
        )}
        
        {connectionState === 'connected' && (
          <div className="absolute top-2 left-2 px-3 py-1 bg-green-600 rounded-full text-white text-sm font-medium flex items-center gap-2">
            <Wifi size={14} />
            Live
          </div>
        )}
      </div>
      
      {/* Video Controls */}
      <div className="p-3 bg-white/5 flex justify-between items-center">
        <span className="text-gray-400 text-sm">
          {connectionState === 'connected' ? '🔴 Live' : 
           connectionState === 'waiting' ? '⏳ Warte...' : 
           connectionState === 'error' ? '❌ Fehler' : '⚫ Offline'}
        </span>
        <button
          onClick={resetConnection}
          className="px-3 py-1 bg-white/10 hover:bg-white/20 rounded-lg text-white text-sm flex items-center gap-1 transition"
        >
          <RotateCcw size={14} /> Reset
        </button>
      </div>
    </div>
  );
}

export default VideoReceiver;
