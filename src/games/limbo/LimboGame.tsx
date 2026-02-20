import React, { useState } from 'react';
import { useAppStore } from '../../store/appStore';
import { LimboGameState } from './types';
import DartInput from '../../components/DartInput';
import { Volume2, VolumeX, RotateCcw, Heart, Skull, Target, TrendingDown } from 'lucide-react';

function LimboGame() {
  const { gameState, recordHit, resetGame, undo, history } = useAppStore();
  const [soundEnabled, setSoundEnabled] = useState(true);

  const limboState = gameState as LimboGameState;

  if (!gameState || (gameState as LimboGameState).gamePhase !== 'playing' && (gameState as LimboGameState).gamePhase !== 'ended') {
    return null;
  }

  const currentPlayer = limboState.players[limboState.currentPlayerIndex];
  const alivePlayers = limboState.players.filter(p => p.lives > 0);

  const handleHit = (hitData: any) => {
    if (soundEnabled) {
      const audio = new Audio('data:audio/wav;base64,UklGRiYAAABXQVZFZm10IBAAAAABAAEAQB8AAAB9AAACABAAZGF0YQIAAAAAAA==');
      audio.play().catch(() => {});
    }
    recordHit(hitData);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-dark via-purple-900 to-dark p-4">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="flex justify-between items-center mb-4">
          <div>
            <h1 className="text-2xl font-bold text-purple-400">🎯 Limbo</h1>
            <span className="text-xs px-2 py-0.5 bg-purple-600/50 text-purple-200 rounded">
              How low can you go?
            </span>
          </div>
          <button
            onClick={() => setSoundEnabled(!soundEnabled)}
            className="p-2 bg-white/10 hover:bg-white/20 rounded-lg text-white transition"
          >
            {soundEnabled ? <Volume2 size={24} /> : <VolumeX size={24} />}
          </button>
        </div>

        {/* Current Limit Display */}
        <div className="bg-gradient-to-r from-red-600 to-orange-600 rounded-2xl p-6 mb-4 text-center relative overflow-hidden">
          <div className="absolute inset-0 bg-black/20" />
          <div className="relative">
            <div className="flex items-center justify-center gap-2 text-red-200 text-sm mb-1">
              <TrendingDown size={16} />
              <span>THROW UNDER</span>
            </div>
            <div className="text-7xl font-black text-white drop-shadow-lg">
              {limboState.currentLimit}
            </div>
            {limboState.lastPlayerWhoSet && (
              <p className="text-red-200 text-sm mt-2">
                Set by {limboState.players.find(p => p.id === limboState.lastPlayerWhoSet)?.name}
              </p>
            )}
          </div>
        </div>

        {/* Current Player */}
        <div className="bg-gradient-to-r from-blue-600 to-purple-600 rounded-xl p-4 mb-4">
          <div className="flex justify-between items-center mb-3">
            <div>
              <p className="text-blue-200 text-sm">Current Turn:</p>
              <p className="text-white font-black text-2xl">{currentPlayer.name}</p>
            </div>
            <div className="flex items-center gap-1">
              {Array.from({ length: limboState.maxLives }).map((_, i) => (
                <Heart
                  key={i}
                  size={24}
                  className={i < currentPlayer.lives ? 'text-red-500 fill-red-500' : 'text-gray-600'}
                />
              ))}
            </div>
          </div>
          
          {/* Current Throws & Shots */}
          <div className="flex items-center justify-between bg-black/20 rounded-lg p-3">
            <div className="flex items-center gap-2">
              {[0, 1, 2].map((i) => (
                <div
                  key={i}
                  className={`w-12 h-12 rounded-lg flex items-center justify-center font-bold text-lg transition-all ${
                    i < currentPlayer.shots
                      ? 'bg-yellow-400 text-yellow-900 shadow-lg'
                      : 'bg-white/20 text-white/40 border border-white/30'
                  }`}
                >
                  {currentPlayer.currentThrows[i] ?? '-'}
                </div>
              ))}
            </div>
            <div className="text-right">
              <p className="text-blue-200 text-xs">Total</p>
              <p className={`font-black text-2xl ${
                currentPlayer.currentThrows.reduce((a, b) => a + b, 0) >= limboState.currentLimit
                  ? 'text-red-400'
                  : 'text-green-400'
              }`}>
                {currentPlayer.currentThrows.reduce((a, b) => a + b, 0)}
              </p>
            </div>
          </div>
        </div>

        {/* Players Grid */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2 mb-6">
          {limboState.players.map((player, idx) => (
            <div
              key={player.id}
              className={`p-3 rounded-xl border transition ${
                player.lives <= 0
                  ? 'bg-gray-800/50 border-gray-700 opacity-50'
                  : idx === limboState.currentPlayerIndex
                    ? 'bg-blue-600/30 border-blue-500 ring-2 ring-yellow-400'
                    : 'bg-white/10 border-white/20'
              }`}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  {player.lives <= 0 ? (
                    <Skull size={16} className="text-gray-500" />
                  ) : (
                    <Target size={16} className="text-purple-400" />
                  )}
                  <span className={`font-bold truncate ${
                    player.lives <= 0 ? 'text-gray-500 line-through' : 'text-white'
                  }`}>
                    {player.name}
                  </span>
                </div>
              </div>
              <div className="flex gap-0.5 mt-2">
                {Array.from({ length: limboState.maxLives }).map((_, i) => (
                  <Heart
                    key={i}
                    size={14}
                    className={i < player.lives ? 'text-red-500 fill-red-500' : 'text-gray-700'}
                  />
                ))}
              </div>
              {player.lastThrow !== null && (
                <p className="text-xs text-gray-400 mt-1">
                  Last: {player.lastThrow}
                </p>
              )}
            </div>
          ))}
        </div>

        {/* Winner Modal */}
        {limboState.gamePhase === 'ended' && limboState.winner && (
          <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
            <div className="bg-gradient-to-br from-purple-600 to-pink-600 rounded-2xl p-8 text-center max-w-md mx-4 shadow-2xl">
              <div className="text-6xl mb-4">👑</div>
              <h2 className="text-3xl font-black text-white mb-2">
                {limboState.winner.name} Wins!
              </h2>
              <p className="text-purple-200 mb-6">
                Limbo Master - Last one standing!
              </p>
              <button
                onClick={resetGame}
                className="w-full px-6 py-3 bg-white text-purple-700 rounded-xl font-bold hover:bg-purple-100 transition flex items-center justify-center gap-2"
              >
                <RotateCcw size={20} /> New Game
              </button>
            </div>
          </div>
        )}

        <div className="grid lg:grid-cols-3 gap-6">
          {/* Dart Input */}
          <div className="lg:col-span-2">
            <DartInput 
              onHit={handleHit} 
              onUndo={undo} 
              undoAvailable={history.length > 0} 
              disabled={limboState.gamePhase === 'ended'} 
            />
          </div>

          {/* Side Panel */}
          <div className="space-y-4">
            <div className="bg-white/10 backdrop-blur-md rounded-lg p-4 border border-white/20">
              <h3 className="text-white font-bold mb-2">Game Rules</h3>
              <ul className="text-gray-300 text-sm space-y-1">
                <li>• Throw 3 darts per turn</li>
                <li>• Total must be UNDER the limit</li>
                <li>• Your total sets the new limit</li>
                <li>• <span className="text-red-400">Miss = 25 points!</span></li>
                <li>• At/over limit = lose a life</li>
                <li>• Last player standing wins!</li>
              </ul>
            </div>

            <div className="bg-white/10 backdrop-blur-md rounded-lg p-4 border border-white/20">
              <h3 className="text-white font-bold mb-2">Players Alive</h3>
              <p className="text-3xl font-black text-green-400">
                {alivePlayers.length} / {limboState.players.length}
              </p>
            </div>

            <button
              onClick={resetGame}
              className="w-full px-4 py-2 bg-white/10 hover:bg-white/20 rounded-lg font-bold text-white transition flex items-center justify-center gap-2 border border-white/30"
            >
              <RotateCcw size={18} /> Back to Menu
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default LimboGame;
