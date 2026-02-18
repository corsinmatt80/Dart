import React from 'react';
import { useAppStore } from '../../store/appStore';
import { KillerGameState } from './types';
import DartInput from '../../components/DartInput';
import ScoreBoard from '../../components/ScoreBoard';
import { Volume2, VolumeX } from 'lucide-react';

function KillerGame() {
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
          {/* Dartboard or Manual Input */}
          <div className="lg:col-span-2">
            {inputMode === 'manual' ? (
              <DartInput 
                onHit={handleHit} 
                onUndo={undo} 
                undoAvailable={history.length > 0} 
                disabled={killerState.gamePhase === 'ended' || currentPlayer.shots >= 3} 
              />
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

            {/* Game Instructions */}
            <div className={`mt-6 border rounded-lg p-4 ${
              currentPlayer.shots >= 3
                ? 'bg-red-900/30 border-red-500/50'
                : 'bg-blue-900/30 border-blue-500/50'
            }`}>
              <p className={`text-sm ${
                currentPlayer.shots >= 3
                  ? 'text-red-200 font-bold'
                  : 'text-blue-200'
              }`}>
                {currentPlayer.shots >= 3
                  ? `⚠️ Turn is complete! (3/3 shots used) - End your turn or undo.`
                  : currentPlayer.killer
                  ? `🎯 You are the KILLER! Hunt the other players. Hit their numbers to reduce their hits. Hit them at 0 hits to eliminate them.`
                  : `🎯 Hit your number (#${currentPlayer.randomNumber}) ${3 - currentPlayer.hits} more times to become the KILLER!`}
              </p>
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

              {currentPlayer.shots >= 3 && (
                <button
                  onClick={() => endTurn()}
                  className="w-full px-4 py-4 bg-gradient-to-r from-red-600 to-orange-600 hover:from-red-700 hover:to-orange-700 rounded-lg font-bold text-white transition text-lg"
                >
                  🔄 Next Player
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
