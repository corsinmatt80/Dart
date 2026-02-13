import React from 'react';
import { useAppStore } from '../../store/appStore';
import { KillerGameState } from './types';
import Dartboard from '../../components/Dartboard';
import CameraCapture from '../../components/CameraCapture';
import ScoreBoard from '../../components/ScoreBoard';
import { Volume2, VolumeX } from 'lucide-react';

function KillerGame() {
  const { gameState, recordHit, endTurn, resetGame } = useAppStore();
  const [soundEnabled, setSoundEnabled] = React.useState(true);
  const [useCamera, setUseCamera] = React.useState(false);

  if (!gameState || (gameState as KillerGameState).gamePhase !== 'playing' && (gameState as KillerGameState).gamePhase !== 'ended') {
    return null;
  }

  const killerState = gameState as KillerGameState;
  const currentPlayer = killerState.players[killerState.currentPlayerIndex];

  const handleHit = (hitData: any) => {
    if (soundEnabled) {
      // Play sound effect
      const audio = new Audio('data:audio/wav;base64,UklGRiYAAABXQVZFZm10IBAAAAABAAEAQB8AAAB9AAACABAAZGF0YQIAAAAAAA==');
      audio.play().catch(() => {});
    }
    recordHit(hitData);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-dark via-blue-900 to-dark p-4">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex justify-between items-center mb-8">
          <h1 className="text-3xl font-bold text-accent">⚡ Killer Darts</h1>
          <button
            onClick={() => setSoundEnabled(!soundEnabled)}
            className="p-2 bg-white/10 hover:bg-white/20 rounded-lg text-white transition"
          >
            {soundEnabled ? <Volume2 size={24} /> : <VolumeX size={24} />}
          </button>
        </div>

        <div className="grid lg:grid-cols-3 gap-6">
          {/* Dartboard or Camera */}
          <div className="lg:col-span-2">
            {useCamera ? (
              <CameraCapture onHit={handleHit} disabled={killerState.gamePhase === 'ended'} />
            ) : (
              <Dartboard onHit={handleHit} disabled={killerState.gamePhase === 'ended'} />
            )}

            {/* Input Mode Toggle */}
            <div className="mt-4">
              <button
                onClick={() => setUseCamera(!useCamera)}
                className="w-full px-4 py-2 bg-white/20 hover:bg-white/30 rounded-lg font-bold text-white transition"
              >
                {useCamera ? '📱 Kamera Modus' : '🎯 Klick Modus'} - Wechseln
              </button>
            </div>

            {/* Shots Counter and Controls */}
            <div className="mt-6 space-y-3">
              <div className="bg-white/10 backdrop-blur-md rounded-lg p-4 border border-white/20">
                <p className="text-sm text-gray-400 mb-2">Shots This Turn: {currentPlayer.shots}/3</p>
                <div className="w-full bg-white/20 rounded-full h-2">
                  <div
                    className="bg-accent h-2 rounded-full transition-all duration-300"
                    style={{ width: `${(currentPlayer.shots / 3) * 100}%` }}
                  />
                </div>
              </div>

              {currentPlayer.shots === 3 && (
                <button
                  onClick={() => endTurn()}
                  className="w-full px-4 py-3 bg-gradient-to-r from-primary to-accent hover:from-primary/80 hover:to-accent/80 rounded-lg font-bold text-white transition"
                >
                  End Turn
                </button>
              )}
            </div>
          </div>

          {/* Scoreboard */}
          <div>
            <ScoreBoard gameState={killerState} gameType="killer" onReset={resetGame} />
          </div>
        </div>
      </div>
    </div>
  );
}

export default KillerGame;
