import React from 'react';
import { useAppStore } from '../../store/appStore';
import { Darts501GameState } from './types';
import DartInput from '../../components/DartInput';
import ScoreBoard from '../../components/ScoreBoard';
import { Volume2, VolumeX, Undo2 } from 'lucide-react';

function Darts501Game() {
  const { gameState, recordHit, endTurn, resetGame, undo, history } = useAppStore();
  const [soundEnabled, setSoundEnabled] = React.useState(true);
  const [inputMode, setInputMode] = React.useState<'camera' | 'manual'>('manual');

  // Für Camera-Remote-Modus: Höre auf Treffer vom /camera Fenster
  React.useEffect(() => {
    if (inputMode !== 'camera') return;

    const handleDartHit = (event: any) => {
      const dartHit = event.detail;
      if (dartHit && dartHit.value) {
        handleHit(dartHit);
      }
    };

    window.addEventListener('dartHit', handleDartHit);

    // Prüfe auch localStorage auf gepufferte Treffer
    const checkStoragedHits = setInterval(() => {
      try {
        const hits = JSON.parse(localStorage.getItem('mobile_hits') || '[]');
        if (hits.length > 0) {
          hits.forEach((hit: any) => {
            if (hit && hit.value) {
              handleHit(hit);
            }
          });
          // Lösche verarbeitete Treffer
          localStorage.setItem('mobile_hits', '[]');
        }
      } catch (err) {
        console.error('Fehler beim Lesen der Treffer:', err);
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
          {/* Dartboard or Manual Input */}
          <div className="lg:col-span-2">
            {inputMode === 'manual' ? (
              <DartInput onHit={handleHit} onUndo={undo} undoAvailable={history.length > 0} disabled={dartsState.gamePhase === 'ended'} />
            ) : (
              <div className="bg-white/10 backdrop-blur-md rounded-lg p-8 border border-white/20 text-center">
                <div className="text-4xl mb-4">📱</div>
                <h2 className="text-2xl font-bold text-white mb-2">Camera Mode Aktiv</h2>
                <p className="text-gray-300 mb-4">Öffne auf einem anderen Gerät:</p>
                <p className="bg-blue-900/50 p-4 rounded text-blue-200 font-mono break-all mb-4">
                  {window.location.origin}/#/camera
                </p>
                <p className="text-gray-400 text-sm">Die erkannten Treffer werden automatisch registriert.</p>
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
                  {mode === 'manual' && '👆 Buttons'}
                  {mode === 'camera' && '📱 Kamera'}
                </button>
              ))}
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
