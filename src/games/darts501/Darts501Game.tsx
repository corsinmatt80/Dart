import React from 'react';
import { useAppStore } from '../../store/appStore';
import { navigateToMenu } from '../../App';
import { Darts501GameState } from './types';
import DartInput from '../../components/DartInput';
import ScoreBoard from '../../components/ScoreBoard';
import { Volume2, VolumeX } from 'lucide-react';

function Darts501Game() {
  const { gameState, recordHit, endTurn, startNewLeg, undo, history, restartGame } = useAppStore();
  const [soundEnabled, setSoundEnabled] = React.useState(true);
  const [inputMode, setInputMode] = React.useState<'camera' | 'manual'>('manual');

  // For Camera-Remote Mode: Listen for hits from /camera window
  React.useEffect(() => {
    if (inputMode !== 'camera') return;

    const handleDartHit = (event: any) => {
      const dartHit = event.detail;
      if (dartHit && dartHit.value) {
        handleHit(dartHit);
      }
    };

    window.addEventListener('dartHit', handleDartHit);

    // Also check localStorage for buffered hits
    const checkStoragedHits = setInterval(() => {
      try {
        const hits = JSON.parse(localStorage.getItem('mobile_hits') || '[]');
        if (hits.length > 0) {
          hits.forEach((hit: any) => {
            if (hit && hit.value) {
              handleHit(hit);
            }
          });
          // Delete processed hits
          localStorage.setItem('mobile_hits', '[]');
        }
      } catch (err) {
        console.error('Error reading hits:', err);
      }
    }, 200);

    return () => {
      window.removeEventListener('dartHit', handleDartHit);
      clearInterval(checkStoragedHits);
    };
  }, [inputMode]);

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

  return (
    <div className="min-h-screen bg-gradient-to-br from-dark via-blue-900 to-dark p-4">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex justify-between items-center mb-4">
          <div>
            <h1 className="text-2xl font-bold text-accent">🎯 {dartsState.options.startScore} Darts</h1>
            <div className="flex gap-2 mt-1">
              <span className="text-xs px-2 py-0.5 bg-green-600/50 text-green-200 rounded">
                {dartsState.options.inMode === 'straight' ? 'Straight In' : 'Double In'}
              </span>
              <span className="text-xs px-2 py-0.5 bg-red-600/50 text-red-200 rounded">
                {dartsState.options.outMode === 'straight' ? 'Straight Out' : 
                 dartsState.options.outMode === 'double' ? 'Double Out' : 'Master Out'}
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

        {/* Big Score Display */}
        <div className="grid grid-cols-2 gap-4 mb-6">
          {dartsState.players.map((player, index) => (
            <div
              key={player.id}
              className={`rounded-xl p-4 text-center transition-all ${
                index === dartsState.currentPlayerIndex
                  ? 'bg-gradient-to-r from-blue-600 to-purple-600 ring-2 ring-yellow-400 scale-105'
                  : 'bg-white/10'
              }`}
            >
              <div className="flex justify-between items-start mb-2">
                <p className={`text-sm font-medium ${
                  index === dartsState.currentPlayerIndex ? 'text-yellow-200' : 'text-gray-400'
                }`}>
                  {player.name}
                  {index === dartsState.currentPlayerIndex && ' 🎯'}
                </p>
                <div className="bg-gradient-to-r from-amber-500 to-orange-500 px-4 py-2 rounded-full shadow-lg">
                  <span className="text-white font-black text-2xl">{player.legsWon}</span>
                  <span className="text-white/80 text-sm ml-1 font-bold">LEGS</span>
                </div>
              </div>
              <p className={`font-black ${
                index === dartsState.currentPlayerIndex 
                  ? 'text-5xl text-white' 
                  : 'text-4xl text-gray-300'
              }`}>
                {player.score}
              </p>
              {index === dartsState.currentPlayerIndex && (
                <div className="mt-2">
                  <div className="flex items-center justify-center gap-2">
                    {[0, 1, 2].map((i) => (
                      <div
                        key={i}
                        className={`w-4 h-4 rounded-full transition-all ${
                          i < player.shots
                            ? 'bg-yellow-400 shadow-lg shadow-yellow-400/50'
                            : 'bg-white/20 border border-white/40'
                        }`}
                      />
                    ))}
                  </div>
                  {player.turnBusted && (
                    <p className="text-red-300 text-xs mt-1 font-bold">❌ BUST!</p>
                  )}
                  {dartsState.options.inMode === 'double' && !player.hasStarted && !player.turnBusted && (
                    <p className="text-yellow-300 text-xs mt-1 font-bold animate-pulse">⚡ Double zum Starten!</p>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>

        <div className="grid lg:grid-cols-3 gap-6">
          {/* Dartboard or Manual Input */}
          <div className="lg:col-span-2">
            {inputMode === 'manual' ? (
              <DartInput onHit={handleHit} onUndo={undo} undoAvailable={history.length > 0} disabled={dartsState.gamePhase === 'ended' || currentPlayer.turnBusted} />
            ) : (
              <div className="bg-white/10 backdrop-blur-md rounded-lg p-8 border border-white/20 text-center">
                <div className="text-4xl mb-4">📱</div>
                <h2 className="text-2xl font-bold text-white mb-2">Camera Mode Active</h2>
                <p className="text-gray-300 mb-4">Open on another device:</p>
                <p className="bg-blue-900/50 p-4 rounded text-blue-200 font-mono break-all mb-4">
                  {window.location.origin}/#/camera
                </p>
                <p className="text-gray-400 text-sm">Detected hits will be registered automatically.</p>
              </div>
            )}

            {/* Input Mode Toggle */}
            <div className="mt-4 grid grid-cols-2 gap-2">
              {(['manual', 'camera'] as const).map((mode) => (
                <button
                  key={mode}
                  onClick={() => setInputMode(mode)}
                  className={`px-3 py-2 rounded-lg font-bold text-sm transition ${
                    inputMode === mode
                      ? 'bg-gradient-to-r from-blue-600 to-purple-600 text-white'
                      : 'bg-white/20 hover:bg-white/30 text-white'
                  }`}
                >
                  {mode === 'manual' && '👆 Manual'}
                  {mode === 'camera' && '📱 Camera'}
                </button>
              ))}
            </div>

            {/* Controls */}
            <div className="mt-4">
              {currentPlayer.shots === 3 && (
                <button
                  onClick={() => endTurn()}
                  className="w-full px-3 py-2 bg-gradient-to-r from-primary to-accent hover:from-primary/80 hover:to-accent/80 rounded-lg font-bold text-white transition text-sm"
                >
                  End Turn
                </button>
              )}
            </div>
          </div>

          {/* Scoreboard */}
          <div>
            <ScoreBoard gameState={dartsState} gameType="darts501" onReset={navigateToMenu} onNewLeg={startNewLeg} onRestart={restartGame} />
          </div>
        </div>
      </div>
    </div>
  );
}

export default Darts501Game;
