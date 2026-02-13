import React, { useEffect } from 'react';
import { useAppStore } from './store/appStore';
import PlayerSetup from './components/PlayerSetup';
import GameMenu from './components/GameMenu';
import KillerGame from './games/killer/KillerGame';
import Darts501Game from './games/darts501/Darts501Game';
import MobileCamera from './pages/MobileCamera';
import './styles/global.css';

function App() {
  const { currentGame, players, recordHit } = useAppStore();

  // Prüfe ob Mobile Camera Seite angefordert wird
  const pathname = window.location.pathname;
  const isMobileCamera = 
    pathname.includes('/camera') || 
    pathname.endsWith('/camera/') ||
    pathname.includes('/Dart/camera');

  useEffect(() => {
    // Höre auf Treffer vom Handy (wenn Desktop offen)
    const handleDartHit = (event: Event) => {
      const customEvent = event as CustomEvent;
      if (customEvent.detail) {
        recordHit(customEvent.detail);
      }
    };

    window.addEventListener('dartHit', handleDartHit);

    // Syncronisiere auch mit localStorage (Polling)
    const syncInterval = setInterval(() => {
      try {
        const hits = JSON.parse(localStorage.getItem('mobile_hits') || '[]');
        if (hits.length > 0) {
          // Nimm den letzten Treffer
          const lastHit = hits[hits.length - 1];
          // Prüfe ob wir ihn schon verarbeitet haben (Deduplizierung)
          const lastProcessedTimestamp = localStorage.getItem('last_hit_timestamp');
          if (!lastProcessedTimestamp || lastHit.timestamp > parseInt(lastProcessedTimestamp)) {
            recordHit(lastHit);
            localStorage.setItem('last_hit_timestamp', lastHit.timestamp.toString());
          }
        }
      } catch (err) {
        console.error('Sync-Fehler:', err);
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
    return <Darts501Game />;
  }

  return <div>Game not found</div>;
}

export default App;
