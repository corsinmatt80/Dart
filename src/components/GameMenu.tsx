import React, { useState, useEffect } from 'react';
import { useAppStore } from '../store/appStore';
import { Zap, Target, RotateCcw, Smartphone } from 'lucide-react';

function GameMenu() {
  const { players, initializeGame, resetGame } = useAppStore();
  const [localIp, setLocalIp] = useState<string>('localhost');

  useEffect(() => {
    // Simple IP detection without WebRTC
    const getLocalIp = () => {
      try {
        // Fallback: try to determine from window.location
        const hostname = window.location.hostname;
        if (hostname && hostname !== 'localhost' && hostname !== '127.0.0.1') {
          setLocalIp(hostname);
        } else {
          // Try WebRTC only as backup
          const rtcPeerConnection = 
            window.RTCPeerConnection ||
            (window as any).webkitRTCPeerConnection ||
            (window as any).mozRTCPeerConnection;

          if (!rtcPeerConnection) {
            setLocalIp('192.168.1.x');
            return;
          }

          const pc = new rtcPeerConnection({ iceServers: [] });
          pc.createDataChannel('');

          pc.onicecandidate = (ice: any) => {
            if (!ice || !ice.candidate) return;
            const ipRegex = /([0-9]{1,3}(\.[0-9]{1,3}){3})/;
            const ipAddress = ipRegex.exec(ice.candidate.candidate)?.[1];
            if (ipAddress && !ipAddress.startsWith('127.')) {
              setLocalIp(ipAddress);
              pc.close();
            }
          };

          pc.createOffer().then((offer: any) => {
            pc.setLocalDescription(offer).catch(() => {});
          }).catch(() => {});
        }
      } catch (err) {
        console.error('IP detection error:', err);
        setLocalIp('192.168.1.x');
      }
    };

    getLocalIp();
  }, []);

  const selectGame = (game: 'killer' | 'darts501') => {
    initializeGame(game, players);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-dark via-blue-900 to-dark flex items-center justify-center p-4">
      <div className="w-full max-w-2xl">
        <h1 className="text-4xl font-bold text-center mb-2 text-accent">Game Selection</h1>
        <p className="text-center text-gray-400 mb-12">Choose your Dart game</p>

        {/* Mobile Camera Info */}
        <div className="bg-blue-600/30 border border-blue-500 rounded-lg p-4 mb-8">
          <div className="flex items-start gap-3">
            <Smartphone className="text-blue-400 mt-1" size={20} />
            <div className="flex-1">
              <h3 className="text-white font-bold mb-2">📱 Connect with smartphone</h3>
              <p className="text-blue-200 text-sm mb-3">Open this URL on your smartphone:</p>
              
              <code className="bg-blue-900/50 px-3 py-2 rounded text-blue-100 text-xs block break-all font-mono">
                https://corsinmatt80.github.io/Dart/#/camera
              </code>
              <p className="text-blue-200 text-xs mt-3">Your smartphone will film the dartboard and automatically detect hits!</p>
            </div>
          </div>
        </div>

        <div className="grid md:grid-cols-2 gap-6 mb-8">
          {/* Killer Card */}
          <div
            onClick={() => selectGame('killer')}
            className="bg-white/10 backdrop-blur-md rounded-lg p-6 cursor-pointer hover:bg-white/20 transition transform hover:scale-105 border border-white/30"
          >
            <Zap className="text-accent mb-4" size={40} />
            <h2 className="text-2xl font-bold text-white mb-2">Killer</h2>
            <p className="text-gray-300 mb-4">
              The classic elimination game. Get three on your number, then eliminate opponents.
            </p>
            <div className="text-accent font-semibold">Click to Play →</div>
          </div>

          {/* 501 Card */}
          <div
            onClick={() => selectGame('darts501')}
            className="bg-white/10 backdrop-blur-md rounded-lg p-6 cursor-pointer hover:bg-white/20 transition transform hover:scale-105 border border-white/30"
          >
            <Target className="text-accent mb-4" size={40} />
            <h2 className="text-2xl font-bold text-white mb-2">501</h2>
            <p className="text-gray-300 mb-4">
              The professional scoring game. Count down from 501 to exactly 0 on a double.
            </p>
            <div className="text-accent font-semibold">Click to Play →</div>
          </div>
        </div>

        <button
          onClick={resetGame}
          className="w-full px-6 py-3 bg-white/10 hover:bg-white/20 rounded-lg font-bold text-white transition flex items-center justify-center gap-2 border border-white/30"
        >
          <RotateCcw size={20} /> Change Players
        </button>

        {/* Players Info */}
        <div className="mt-8 bg-white/5 rounded-lg p-4 border border-white/20">
          <p className="text-gray-400 text-sm mb-2">Players ({players.length})</p>
          <div className="flex flex-wrap gap-2">
            {players.map((player) => (
              <span key={player.id} className="bg-accent/20 text-accent px-3 py-1 rounded-full text-sm">
                {player.name}
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export default GameMenu;
