import React, { useState } from 'react';
import { useAppStore } from '../../store/appStore';
import { CricketGameState, CRICKET_TARGETS, CricketTarget } from './types';
import CricketInput from './CricketInput';
import { Volume2, VolumeX, RotateCcw } from 'lucide-react';

// Progress bar component for marks
function MarkBar({ marks, isCurrentPlayer }: { marks: number; isCurrentPlayer: boolean }) {
  const percentage = Math.min((marks / 3) * 100, 100);
  const isClosed = marks >= 3;
  
  return (
    <div className="w-full">
      <div className={`h-3 rounded-full overflow-hidden ${
        isCurrentPlayer ? 'bg-blue-900/50' : 'bg-white/10'
      }`}>
        <div 
          className={`h-full rounded-full transition-all duration-300 ${
            isClosed 
              ? 'bg-gradient-to-r from-green-400 to-emerald-500' 
              : isCurrentPlayer 
                ? 'bg-gradient-to-r from-yellow-400 to-orange-500'
                : 'bg-gradient-to-r from-blue-400 to-purple-500'
          }`}
          style={{ width: `${percentage}%` }}
        />
      </div>
      {isClosed && (
        <div className="text-center text-green-400 text-xs mt-0.5 font-bold">✓</div>
      )}
    </div>
  );
}

function CricketGame() {
  const { gameState, recordHit, resetGame, undo, history } = useAppStore();
  const [soundEnabled, setSoundEnabled] = useState(true);

  if (!gameState || (gameState as CricketGameState).gamePhase !== 'playing' && (gameState as CricketGameState).gamePhase !== 'ended') {
    return null;
  }

  const cricketState = gameState as CricketGameState;
  const currentPlayer = cricketState.players[cricketState.currentPlayerIndex];

  const handleHit = (hitData: any) => {
    if (soundEnabled) {
      const audio = new Audio('data:audio/wav;base64,UklGRiYAAABXQVZFZm10IBAAAAABAAEAQB8AAAB9AAACABAAZGF0YQIAAAAAAA==');
      audio.play().catch(() => {});
    }
    recordHit(hitData);
  };

  const getTargetLabel = (target: CricketTarget) => {
    if (target === 25) return 'BULL';
    return target.toString();
  };

  const isNumberClosed = (target: CricketTarget) => {
    return cricketState.players.every(p => p.marks[target] >= 3);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-dark via-green-900 to-dark p-4">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex justify-between items-center mb-4">
          <div>
            <h1 className="text-2xl font-bold text-green-400">🎯 Cricket</h1>
            <div className="flex gap-2 mt-1">
              <span className="text-xs px-2 py-0.5 bg-red-600/50 text-red-200 rounded">
                Lowest points wins!
              </span>
              <span className="text-xs px-2 py-0.5 bg-blue-600/50 text-blue-200 rounded">
                Round {cricketState.round}/{cricketState.maxRounds}
              </span>
            </div>
          </div>
          <button
            onClick={() => setSoundEnabled(!soundEnabled)}
            className="p-2 bg-white/10 hover:bg-white/20 rounded-lg text-white transition"
          >
            {soundEnabled ? <Volume2 size={24} /> : <VolumeX size={24} />}
          </button>
        </div>

        {/* Current Player & Shots */}
        <div className="bg-gradient-to-r from-blue-600 to-purple-600 rounded-xl p-4 mb-4">
          <div className="flex justify-between items-center">
            <div>
              <p className="text-blue-200 text-sm">Current Turn:</p>
              <p className="text-white font-black text-2xl">{currentPlayer.name}</p>
            </div>
            <div className="flex items-center gap-2">
              {[0, 1, 2].map((i) => (
                <div
                  key={i}
                  className={`w-5 h-5 rounded-full transition-all ${
                    i < currentPlayer.shots
                      ? 'bg-yellow-400 shadow-lg shadow-yellow-400/50'
                      : 'bg-white/20 border border-white/40'
                  }`}
                />
              ))}
            </div>
          </div>
        </div>

        {/* Cricket Scoreboard */}
        <div className="bg-white/10 backdrop-blur-md rounded-xl p-4 mb-6 border border-white/20">
          {/* Header Row */}
          <div className="grid gap-2 mb-3" style={{ gridTemplateColumns: `60px repeat(${cricketState.players.length}, 1fr)` }}>
            <div className="text-center text-gray-400 text-xs font-bold"></div>
            {cricketState.players.map((player, idx) => (
              <div 
                key={player.id}
                className={`text-center font-bold truncate px-1 text-sm ${
                  idx === cricketState.currentPlayerIndex 
                    ? 'text-yellow-400' 
                    : 'text-white'
                }`}
              >
                {player.name}
                {idx === cricketState.currentPlayerIndex && ' 🎯'}
              </div>
            ))}
          </div>

          {/* Target Rows */}
          {CRICKET_TARGETS.map((target, index) => {
            const closed = isNumberClosed(target);
            return (
              <div 
                key={target}
                className={`grid gap-2 py-3 items-center ${
                  closed ? 'opacity-40' : ''
                } ${index % 2 === 0 ? 'bg-white/5' : ''}`}
                style={{ gridTemplateColumns: `60px repeat(${cricketState.players.length}, 1fr)` }}
              >
                {/* Target Number */}
                <div className={`text-center font-black text-xl ${
                  closed ? 'text-gray-500 line-through' : 'text-white'
                }`}>
                  {getTargetLabel(target)}
                </div>

                {/* Player Progress Bars */}
                {cricketState.players.map((player, idx) => (
                  <div 
                    key={player.id}
                    className={`px-2 py-1 rounded-lg ${
                      idx === cricketState.currentPlayerIndex
                        ? 'bg-blue-600/20'
                        : ''
                    }`}
                  >
                    <MarkBar 
                      marks={player.marks[target]} 
                      isCurrentPlayer={idx === cricketState.currentPlayerIndex}
                    />
                  </div>
                ))}
              </div>
            );
          })}

          {/* Points Row */}
          <div 
            className="grid gap-2 py-4 border-t-2 border-white/30 mt-2 items-center"
            style={{ gridTemplateColumns: `60px repeat(${cricketState.players.length}, 1fr)` }}
          >
            <div className="text-center text-gray-400 font-bold text-xs">Points</div>
            {cricketState.players.map((player, idx) => (
              <div 
                key={player.id}
                className={`text-center font-black text-2xl ${
                  idx === cricketState.currentPlayerIndex 
                    ? 'text-yellow-400' 
                    : 'text-red-400'
                }`}
              >
                {player.points}
              </div>
            ))}
          </div>
        </div>

        {/* Leaderboard Modal */}
        {cricketState.gamePhase === 'ended' && (() => {
          const sortedPlayers = [...cricketState.players].sort((a, b) => a.points - b.points);
          return (
          <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
            <div className="bg-gradient-to-br from-gray-800 to-gray-900 rounded-2xl p-6 w-full max-w-lg shadow-2xl border border-white/20">
              <div className="text-center mb-6">
                <div className="text-5xl mb-2">🏆</div>
                <h2 className="text-2xl font-black text-white">Game Over!</h2>
                <p className="text-gray-400 text-sm">After {cricketState.maxRounds} rounds</p>
              </div>
              
              {/* Leaderboard */}
              <div className="space-y-2 mb-6">
                {sortedPlayers.map((player, idx) => (
                  <div 
                    key={player.id}
                    className={`flex items-center justify-between p-3 rounded-xl ${
                      idx === 0 
                        ? 'bg-gradient-to-r from-yellow-600/50 to-amber-600/50 border border-yellow-500/50' 
                        : idx === 1
                          ? 'bg-gradient-to-r from-gray-400/30 to-gray-500/30 border border-gray-400/30'
                          : idx === 2
                            ? 'bg-gradient-to-r from-orange-700/30 to-orange-800/30 border border-orange-600/30'
                            : 'bg-white/5 border border-white/10'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <span className={`text-2xl font-black ${
                        idx === 0 ? 'text-yellow-400' : idx === 1 ? 'text-gray-300' : idx === 2 ? 'text-orange-400' : 'text-gray-500'
                      }`}>
                        #{idx + 1}
                      </span>
                      <div>
                        <p className="font-bold text-white">{player.name}</p>
                        <p className="text-xs text-gray-400">
                          {CRICKET_TARGETS.filter(t => player.marks[t] >= 3).length}/7 closed
                        </p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className={`font-black text-xl ${
                        idx === 0 ? 'text-green-400' : 'text-red-400'
                      }`}>
                        {player.points} pts
                      </p>
                    </div>
                  </div>
                ))}
              </div>

              <button
                onClick={resetGame}
                className="w-full px-6 py-3 bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-500 hover:to-emerald-500 rounded-xl font-bold text-white transition flex items-center justify-center gap-2"
              >
                <RotateCcw size={20} /> New Game
              </button>
            </div>
          </div>
          );
        })()}

        <div className="grid lg:grid-cols-3 gap-6">
          {/* Cricket Input */}
          <div className="lg:col-span-2">
            <CricketInput 
              onHit={handleHit} 
              onUndo={undo} 
              undoAvailable={history.length > 0} 
              disabled={cricketState.gamePhase === 'ended'} 
            />
          </div>

          {/* Side Panel */}
          <div className="space-y-4">
            <div className="bg-white/10 backdrop-blur-md rounded-lg p-4 border border-white/20">
              <h3 className="text-white font-bold mb-2">Game Rules</h3>
              <ul className="text-gray-300 text-sm space-y-1">
                <li>• 3 hits = close number</li>
                <li>• Hit closed number = points to opponents!</li>
                <li>• Close all 7 + lowest points = win</li>
              </ul>
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

export default CricketGame;
