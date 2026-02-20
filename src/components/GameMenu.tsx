import React, { useState } from 'react';
import { useAppStore } from '../store/appStore';
import { navigateTo } from '../App';
import { Skull, Target, RotateCcw, Smartphone, CircleDot, TrendingDown, ChevronDown, ChevronUp } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import ManualWebRTC from '../pages/ManualWebRTC';
import DartDetectionTest from './DartDetectionTest';

function GameMenu() {
  const { players, clearPlayers } = useAppStore();
  const [cameraConnected, setCameraConnected] = useState(false);
  const [showCameraPanel, setShowCameraPanel] = useState(false);
  const [videoStream, setVideoStream] = useState<MediaStream | null>(null);
  const [showDetectionTest, setShowDetectionTest] = useState(false);

  const getManualCameraUrl = () => {
    const baseUrl = window.location.origin + window.location.pathname;
    return `${baseUrl}#/manual-camera`;
  };

  const selectGame = (game: 'killer' | 'darts501' | 'cricket' | 'limbo') => {
    navigateTo(game);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-dark via-blue-900 to-dark flex items-center justify-center p-4">
      <div className="w-full max-w-2xl">
        <h1 className="text-4xl font-bold text-center mb-2 text-accent">Game Selection</h1>
        <p className="text-center text-gray-400 mb-8">Choose your Dart game</p>

        {/* Camera Connection Panel - Collapsible */}
        <div className={`border rounded-lg mb-8 overflow-hidden ${
          cameraConnected 
            ? 'bg-green-600/30 border-green-500' 
            : 'bg-blue-600/30 border-blue-500'
        }`}>
          {/* Header - Always visible */}
          <button
            onClick={() => setShowCameraPanel(!showCameraPanel)}
            className="w-full p-4 flex items-center justify-between hover:bg-white/5 transition"
          >
            <div className="flex items-center gap-3">
              <Smartphone className={cameraConnected ? 'text-green-400' : 'text-blue-400'} size={24} />
              <div className="text-left">
                <h3 className="text-white font-bold">📱 Smartphone-Kamera verbinden</h3>
                <p className={`text-sm ${cameraConnected ? 'text-green-300' : 'text-gray-400'}`}>
                  {cameraConnected ? '✅ Verbunden!' : 'Zum Verbinden klicken'}
                </p>
              </div>
            </div>
            {showCameraPanel ? (
              <ChevronUp className="text-gray-400" size={20} />
            ) : (
              <ChevronDown className="text-gray-400" size={20} />
            )}
          </button>

          {/* Expandable Content */}
          {showCameraPanel && (
            <div className="px-4 pb-4 border-t border-white/10">
              <div className="grid md:grid-cols-2 gap-4 mt-4">
                {/* QR Code for camera page */}
                <div className="bg-white rounded-lg p-4 flex flex-col items-center justify-center">
                  <p className="text-gray-600 text-sm mb-2 font-medium">QR-Code scannen:</p>
                  <QRCodeSVG 
                    value={getManualCameraUrl()} 
                    size={150}
                    level="M"
                    includeMargin={false}
                  />
                  <p className="text-gray-500 text-xs mt-2">
                    Oder: <span className="font-mono bg-gray-100 px-1 rounded">#/manual-camera</span>
                  </p>
                </div>

                {/* Manual WebRTC Desktop Component */}
                <div>
                  <ManualWebRTC 
                    mode="desktop"
                    onConnectionChange={(connected) => setCameraConnected(connected)}
                    onStreamReceived={(stream) => setVideoStream(stream)}
                  />
                </div>
              </div>

              {/* Show detection test when connected */}
              {cameraConnected && videoStream && (
                <div className="mt-4">
                  <button
                    onClick={() => setShowDetectionTest(!showDetectionTest)}
                    className="w-full py-2 bg-yellow-600 hover:bg-yellow-500 rounded-lg text-white font-bold mb-4"
                  >
                    🎯 {showDetectionTest ? 'Dart-Erkennung ausblenden' : 'Dart-Erkennung testen'}
                  </button>
                  {showDetectionTest && (
                    <DartDetectionTest 
                      videoStream={videoStream}
                      onDartDetected={(score) => console.log('Detected:', score)}
                    />
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="grid md:grid-cols-2 gap-6 mb-8">
          {/* Killer Card */}
          <div
            onClick={() => selectGame('killer')}
            className="bg-white/10 backdrop-blur-md rounded-lg p-6 cursor-pointer hover:bg-white/20 transition transform hover:scale-105 border border-white/30"
          >
            <Skull className="text-red-500 mb-4" size={40} />
            <h2 className="text-2xl font-bold text-white mb-2">Killer</h2>
            <p className="text-sm text-gray-400">
              Triff deine Zahlen, eliminiere Gegner. Strategie & Präzision gefragt!
            </p>
          </div>

          {/* 501 Card */}
          <div
            onClick={() => selectGame('darts501')}
            className="bg-white/10 backdrop-blur-md rounded-lg p-6 cursor-pointer hover:bg-white/20 transition transform hover:scale-105 border border-white/30"
          >
            <Target className="text-green-500 mb-4" size={40} />
            <h2 className="text-2xl font-bold text-white mb-2">501</h2>
            <p className="text-sm text-gray-400">
              Der Klassiker – starte bei 501, beende mit Double-Out!
            </p>
          </div>

          {/* Cricket Card */}
          <div
            onClick={() => selectGame('cricket')}
            className="bg-white/10 backdrop-blur-md rounded-lg p-6 cursor-pointer hover:bg-white/20 transition transform hover:scale-105 border border-white/30"
          >
            <CircleDot className="text-yellow-500 mb-4" size={40} />
            <h2 className="text-2xl font-bold text-white mb-2">Cricket</h2>
            <p className="text-sm text-gray-400">
              Schließe 15-20 & Bull – punkte auf offene Felder des Gegners!
            </p>
          </div>

          {/* Limbo Card */}
          <div
            onClick={() => selectGame('limbo')}
            className="bg-white/10 backdrop-blur-md rounded-lg p-6 cursor-pointer hover:bg-white/20 transition transform hover:scale-105 border border-white/30"
          >
            <TrendingDown className="text-purple-500 mb-4" size={40} />
            <h2 className="text-2xl font-bold text-white mb-2">Limbo</h2>
            <p className="text-sm text-gray-400">
              Wirf unter dem Ziel – je niedriger, desto besser!
            </p>
          </div>
        </div>

        <div className="text-center">
          <button
            onClick={clearPlayers}
            className="text-gray-500 hover:text-white transition flex items-center justify-center gap-2 mx-auto"
          >
            <RotateCcw size={16} />
            Spieler zurücksetzen
          </button>
        </div>

        {/* Players Footer */}
        <div className="mt-8 bg-white/5 rounded-lg p-4">
          <p className="text-gray-400 text-sm text-center mb-3">
            {players.length} {players.length === 1 ? 'Spieler' : 'Spieler'} bereit
          </p>
          <div className="flex flex-wrap justify-center gap-2">
            {players.map((player, index) => (
              <div 
                key={player.id || index}
                className="px-4 py-2 bg-gradient-to-r from-blue-600/50 to-purple-600/50 rounded-full border border-white/20 flex items-center gap-2"
              >
                <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-400 to-purple-500 flex items-center justify-center text-white font-bold text-sm">
                  {player.name.charAt(0).toUpperCase()}
                </div>
                <span className="text-white font-medium">{player.name}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export default GameMenu;
