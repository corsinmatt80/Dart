import React from 'react';
import { useAppStore } from '../../store/appStore';
import { Darts501GameState } from './types';
import Dartboard from '../../components/Dartboard';
import ScoreBoard from '../../components/ScoreBoard';
import { Volume2, VolumeX, Undo2 } from 'lucide-react';

function Darts501Game() {
  const { gameState, recordHit, endTurn, resetGame, undo } = useAppStore();
  const [soundEnabled, setSoundEnabled] = React.useState(true);

  if (!gameState || (gameState as Darts501GameState).gamePhase !== 'playing' && (gameState as Darts501GameState).gamePhase !== 'ended') {
    return null;
  }

  const dartsState = gameState as Darts501GameState;
  const currentPlayer = dartsState.players[dartsState.currentPlayerIndex];

  const handleHit = (hitData: any) => {
    if (soundEnabled) {
      const audio = new Audio('data:audio/wav;base64,UklGRiYAAABXQVZFZm10IBAAAAABAAEAQB8AAAB9AAACABAAZGF0YQIAAAAAAA==');
      audio.play().catch(() => {});
    }
    recordHit(hitData);
  };

  const getScoreStatus = () => {
    if (currentPlayer.score === 0) return '✅ WIN!';
    if (currentPlayer.score < 0) return '❌ BUST';
    return `📍 ${currentPlayer.score}`;
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-dark via-blue-900 to-dark p-4">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex justify-between items-center mb-8">
          <h1 className="text-3xl font-bold text-accent">🎯 501 Darts</h1>
          <button
            onClick={() => setSoundEnabled(!soundEnabled)}
            className="p-2 bg-white/10 hover:bg-white/20 rounded-lg text-white transition"
          >
            {soundEnabled ? <Volume2 size={24} /> : <VolumeX size={24} />}
          </button>
        </div>

        <div className="grid lg:grid-cols-3 gap-6">
          {/* Dartboard */}
          <div className="lg:col-span-2">
            <Dartboard onHit={handleHit} disabled={dartsState.gamePhase === 'ended'} />

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

              <div className="grid grid-cols-2 gap-3">
                {currentPlayer.shots === 3 && (
                  <button
                    onClick={() => endTurn()}
                    className="w-full px-3 py-2 bg-gradient-to-r from-primary to-accent hover:from-primary/80 hover:to-accent/80 rounded-lg font-bold text-white transition text-sm"
                  >
                    End Turn
                  </button>
                )}
                <button
                  onClick={() => undo()}
                  className="w-full px-3 py-2 bg-white/10 hover:bg-white/20 rounded-lg font-bold text-white transition text-sm flex items-center justify-center gap-1"
                >
                  <Undo2 size={16} /> Undo
                </button>
              </div>
            </div>
          </div>

          {/* Scoreboard */}
          <div>
            <ScoreBoard gameState={dartsState} gameType="darts501" onReset={resetGame} />
          </div>
        </div>
      </div>
    </div>
  );
}

export default Darts501Game;
