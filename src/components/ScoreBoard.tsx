import React from 'react';
import { KillerGameState } from '../games/killer/types';
import { RotateCcw, RefreshCw } from 'lucide-react';

interface ScoreBoardProps {
  gameState: KillerGameState | any;
  gameType: 'killer' | 'darts501';
  onReset: () => void;
  onNewLeg?: () => void;
  onRestart?: () => void;
}

function ScoreBoard({ gameState, gameType, onReset, onNewLeg, onRestart }: ScoreBoardProps) {
  const currentPlayer = gameState?.players?.[gameState?.currentPlayerIndex];

  return (
    <div className="space-y-4">
      {/* Current Player Info */}
      <div className={`rounded-lg p-6 text-white transition ${
        currentPlayer?.killer
          ? 'bg-gradient-to-r from-red-600 to-orange-600 ring-2 ring-yellow-400 shadow-lg shadow-red-500'
          : 'bg-gradient-to-r from-primary to-accent'
      }`}>
        <p className="text-sm text-gray-200 mb-1">Current Player</p>
        <h2 className="text-3xl font-bold mb-4">{currentPlayer?.name}</h2>
        
        {gameType === 'killer' && (
          <div className="space-y-4">
            {/* Target Number - Large and Prominent */}
            <div className="bg-white/20 backdrop-blur-sm rounded-lg p-4 border-2 border-white/50">
              <p className="text-xs text-gray-200 mb-1 font-bold">TARGET NUMBER</p>
              <p className="text-6xl font-black text-center">{currentPlayer?.randomNumber}</p>
            </div>

            {/* Status */}
            {currentPlayer?.killer ? (
              <div className="bg-yellow-400/30 border-2 border-yellow-400 rounded-lg p-4 text-center shadow-lg shadow-yellow-500/50 animate-pulse">
                <p className="text-xs text-yellow-200 font-bold uppercase mb-1">Status</p>
                <p className="text-3xl font-black text-yellow-300">💀 KILLER 💀</p>
                <p className="text-xs text-yellow-200 mt-2">Hunting other players...</p>
              </div>
            ) : (
              <div>
                <p className="text-xs text-gray-200 font-bold mb-2">Progress to Killer</p>
                <div className="w-full bg-white/20 rounded-full h-3 border border-white/40">
                  <div
                    className="bg-gradient-to-r from-blue-400 to-purple-500 h-3 rounded-full transition-all duration-300"
                    style={{ width: `${(currentPlayer?.hits / 3) * 100}%` }}
                  />
                </div>
                <p className="text-center text-sm font-bold mt-2">{currentPlayer?.hits} / 3 hits</p>
              </div>
            )}
          </div>
        )}

        {gameType === 'darts501' && (
          <div className="flex gap-4">
            <div>
              <p className="text-xs text-gray-300">Score</p>
              <p className="text-3xl font-bold">{currentPlayer?.score}</p>
            </div>
            <div>
              <p className="text-xs text-gray-300">Shots</p>
              <p className="text-2xl font-bold">{currentPlayer?.shots}/3</p>
            </div>
          </div>
        )}
      </div>

      {/* Players List */}
      <div className="bg-white/10 backdrop-blur-md rounded-lg p-4 border border-white/20">
        <h3 className="text-white font-bold mb-3 text-sm">PLAYERS</h3>
        <div className="space-y-2">
          {gameState?.players?.map((player: any, idx: number) => (
            <div
              key={player.id}
              className={`p-3 rounded-lg transition border-l-4 ${
                idx === gameState.currentPlayerIndex
                  ? 'bg-accent/30 border-accent'
                  : player.killer
                  ? 'bg-yellow-900/30 border-yellow-400 shadow-md shadow-yellow-500/30'
                  : 'bg-white/5 border-transparent'
              } ${player.eliminated ? 'opacity-40 line-through' : ''}`}
            >
              <div className="flex justify-between items-center mb-2">
                <span className={`font-bold ${
                  player.killer ? 'text-yellow-400' : 'text-white'
                }`}>
                  {player.name}
                  {player.killer && ' 💀'}
                  {player.eliminated && ' ❌'}
                </span>
                <span className="text-lg font-black bg-white/20 px-3 py-1 rounded">
                  #{player.randomNumber}
                </span>
              </div>
              
              {gameType === 'killer' && (
                <div className="w-full bg-white/20 rounded-full h-2 border border-white/30">
                  <div
                    className={`h-2 rounded-full transition-all duration-300 ${
                      player.killer
                        ? 'bg-gradient-to-r from-yellow-400 to-amber-500'
                        : 'bg-gradient-to-r from-blue-400 to-purple-500'
                    }`}
                    style={{ width: `${(player.hits / 3) * 100}%` }}
                  />
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Winner */}
      {gameState?.winner && (
        <div className="bg-success/20 border-2 border-success rounded-lg p-4 text-center">
          <p className="text-success font-bold text-2xl">🎉 {gameState.winner.name} Wins!</p>
          {gameType === 'darts501' && onNewLeg && (
            <button
              onClick={onNewLeg}
              className="mt-4 w-full px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg font-bold transition"
            >
              🎯 Neues Leg starten
            </button>
          )}
          {onRestart && (
            <button
              onClick={onRestart}
              className="mt-2 w-full px-4 py-2 bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-500 hover:to-purple-500 text-white rounded-lg font-bold transition flex items-center justify-center gap-2"
            >
              <RefreshCw size={18} /> Play Again
            </button>
          )}
          <button
            onClick={onReset}
            className="mt-2 w-full px-4 py-2 bg-success hover:bg-success/80 text-white rounded-lg font-bold transition"
          >
            Back to Menu
          </button>
        </div>
      )}

      <button
        onClick={onReset}
        className="w-full px-4 py-2 bg-white/10 hover:bg-white/20 rounded-lg font-bold text-white transition flex items-center justify-center gap-2 border border-white/30"
      >
        <RotateCcw size={18} /> Back to Menu
      </button>
    </div>
  );
}

export default ScoreBoard;
