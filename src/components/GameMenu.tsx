import React from 'react';
import { useAppStore } from '../store/appStore';
import { Zap, Target, RotateCcw, Camera, ExternalLink, Printer } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';

function GameMenu() {
  const { players, initializeGame, resetGame } = useAppStore();
  
  const cameraUrl = 'https://corsinmatt80.github.io/Dart/#camera';

  const selectGame = (game: 'killer' | 'darts501') => {
    initializeGame(game, players);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-dark via-blue-900 to-dark flex items-center justify-center p-4">
      <div className="w-full max-w-2xl">
        <h1 className="text-4xl font-bold text-center mb-2 text-accent">Game Selection</h1>
        <p className="text-center text-gray-400 mb-12">Choose your Dart game</p>

        {/* Mobile Camera Info with QR Code */}
        <div className="bg-gradient-to-r from-blue-600/30 to-purple-600/30 border border-blue-500/50 rounded-xl p-5 mb-8 shadow-lg">
          <div className="flex items-center gap-2 mb-4">
            <Camera className="text-blue-400" size={24} />
            <h3 className="text-white font-bold text-lg">Smartphone-Kamera verbinden</h3>
          </div>
          
          <div className="flex flex-col md:flex-row gap-5 items-center">
            {/* QR Code */}
            <div className="bg-white p-3 rounded-xl shadow-xl">
              <QRCodeSVG 
                value={cameraUrl}
                size={140}
                level="H"
                includeMargin={false}
                bgColor="#ffffff"
                fgColor="#1e293b"
              />
            </div>
            
            {/* Instructions */}
            <div className="flex-1 text-center md:text-left">
              <p className="text-blue-200 mb-3">
                <span className="text-2xl mr-2">📱</span>
                Scanne den QR-Code mit deinem Handy oder öffne den Link:
              </p>
              
              <a 
                href={cameraUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg transition font-medium text-sm mb-2"
              >
                <ExternalLink size={16} />
                Kamera öffnen
              </a>
              
              <a 
                href="https://corsinmatt80.github.io/Dart/aruco-markers.html"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 bg-gray-600 hover:bg-gray-700 text-white px-4 py-2 rounded-lg transition font-medium text-sm mb-3 ml-2"
              >
                <Printer size={16} />
                ArUco Marker drucken
              </a>
              
              <p className="text-blue-300/70 text-xs">
                Platziere die gedruckten Marker um die Dartscheibe für bessere Erkennung!
              </p>
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
