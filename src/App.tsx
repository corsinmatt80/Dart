import React, { useEffect } from 'react';
import { useAppStore } from './store/appStore';
import PlayerSetup from './components/PlayerSetup';
import GameMenu from './components/GameMenu';
import KillerGame from './games/killer/KillerGame';
import Darts501Game from './games/darts501/Darts501Game';
import Darts501Setup from './games/darts501/Darts501Setup';
import MobileCamera from './pages/MobileCameraV3';
import './styles/global.css';

function App() {
  const { currentGame, gameState, players, recordHit, initializeDarts501, setCurrentGame } = useAppStore();

  // Check if Mobile Camera page is requested (hash-based for GitHub Pages)
  const hash = window.location.hash.toLowerCase();
  const isMobileCamera = hash.includes('#camera') || hash === '#/camera';

  useEffect(() => {
    // Listen for hits from smartphone (if desktop is open)
    const handleDartHit = (event: Event) => {
      const customEvent = event as CustomEvent;
      if (customEvent.detail) {
        recordHit(customEvent.detail);
      }
    };

    window.addEventListener('dartHit', handleDartHit);

    // Also sync with localStorage (Polling)
    const syncInterval = setInterval(() => {
      try {
        const hits = JSON.parse(localStorage.getItem('mobile_hits') || '[]');
        if (hits.length > 0) {
          // Take last hit
          const lastHit = hits[hits.length - 1];
          // Check if we already processed it (deduplication)
          const lastProcessedTimestamp = localStorage.getItem('last_hit_timestamp');
          if (!lastProcessedTimestamp || lastHit.timestamp > parseInt(lastProcessedTimestamp)) {
            recordHit(lastHit);
            localStorage.setItem('last_hit_timestamp', lastHit.timestamp.toString());
          }
        }
      } catch (err) {
        console.error('Sync error:', err);
      }
    }, 500);

    return () => {
      window.removeEventListener('dartHit', handleDartHit);
      clearInterval(syncInterval);
    };
  }, [recordHit]);

  // Show mobile camera if requested
  if (isMobileCamera) {
    return <MobileCamera />;
  }

  // Show player setup if no players
  if (players.length === 0) {
    return <PlayerSetup />;
  }

  // Show game menu if no game selected
  if (!currentGame) {
    return <GameMenu />;
  }

  // Render selected game
  if (currentGame === 'killer') {
    return <KillerGame />;
  }

  if (currentGame === 'darts501') {
    // Show setup screen if game not initialized yet
    if (!gameState) {
      return (
        <Darts501Setup 
          onStart={(options) => initializeDarts501(players, options)}
          onBack={() => setCurrentGame(null as any)}
        />
      );
    }
    return <Darts501Game />;
  }

  return <div>Game not found</div>;
}

export default App;
