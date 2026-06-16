import React, { useEffect, useState } from 'react';
import { useAppStore } from './store/appStore';
import PlayerSetup from './components/PlayerSetup';
import GameMenu from './components/GameMenu';
import KillerGame from './games/killer/KillerGame';
import KillerSetup from './games/killer/KillerSetup';
import Darts501Game from './games/darts501/Darts501Game';
import Darts501Setup from './games/darts501/Darts501Setup';
import CricketGame from './games/cricket/CricketGame';
import CricketSetup from './games/cricket/CricketSetup';
import LimboGame from './games/limbo/LimboGame';
import LimboSetup from './games/limbo/LimboSetup';
import PhoneCamera from './pages/PhoneCamera';
import DesktopReceiver from './pages/DesktopReceiver';
import './styles/global.css';

// Helper to get route from hash (Query-Parameter wie ?h=... abschneiden)
function getRouteFromHash(): string {
  const raw = window.location.hash.replace(/^#\/?/, '');
  return raw.split('?')[0].toLowerCase();
}

// Helper to navigate
export function navigateTo(route: string) {
  window.location.hash = `#/${route}`;
}

export function navigateToMenu() {
  window.location.hash = '';
}

function App() {
  const { currentGame, gameState, players, recordHit, initializeDarts501, initializeCricket, initializeLimbo, setCurrentGame, initializeGame, resetGame } = useAppStore();

  // Get route from hash (als State, damit hashchange ein Re-Render ausloest –
  // sonst erscheinen Routen wie 'connect'/'camera' nur bei hartem Reload)
  const [route, setRoute] = useState(getRouteFromHash);
  const isMobileCamera = route === 'camera';
  const isConnect = route === 'connect';

  // Sync hash with game state
  useEffect(() => {
    const handleHashChange = () => {
      const newRoute = getRouteFromHash();
      setRoute(newRoute);

      if (newRoute === 'killer' && currentGame !== 'killer') {
        setCurrentGame('killer');
      } else if (newRoute === 'darts501' && currentGame !== 'darts501') {
        setCurrentGame('darts501');
      } else if (newRoute === 'cricket' && currentGame !== 'cricket') {
        setCurrentGame('cricket');
      } else if (newRoute === 'limbo' && currentGame !== 'limbo') {
        setCurrentGame('limbo');
      } else if (newRoute === '' && currentGame !== null) {
        resetGame();
      }
    };

    window.addEventListener('hashchange', handleHashChange);
    
    // Check on mount
    handleHashChange();

    return () => window.removeEventListener('hashchange', handleHashChange);
  }, [currentGame, players, initializeGame, setCurrentGame, resetGame]);

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

  // Handy-Kamera-Seite (wird per QR-Code geoeffnet)
  if (isMobileCamera) {
    return <PhoneCamera />;
  }

  // Desktop-Empfaenger (zeigt QR, empfaengt Stream, fuehrt Detection aus)
  if (isConnect) {
    return <DesktopReceiver />;
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
    // Show setup screen if game not initialized yet
    if (!gameState) {
      return (
        <KillerSetup 
          onStart={() => initializeGame('killer', players)}
          onBack={() => navigateToMenu()}
        />
      );
    }
    return <KillerGame />;
  }

  if (currentGame === 'darts501') {
    // Show setup screen if game not initialized yet
    if (!gameState) {
      return (
        <Darts501Setup 
          onStart={(options) => initializeDarts501(players, options)}
          onBack={() => navigateToMenu()}
        />
      );
    }
    return <Darts501Game />;
  }

  if (currentGame === 'cricket') {
    // Show setup screen if game not initialized yet
    if (!gameState) {
      return (
        <CricketSetup 
          onStart={() => initializeCricket(players)}
          onBack={() => navigateToMenu()}
        />
      );
    }
    return <CricketGame />;
  }

  if (currentGame === 'limbo') {
    // Show setup screen if game not initialized yet
    if (!gameState) {
      return (
        <LimboSetup 
          onStart={(startLimit, lives) => initializeLimbo(players, startLimit, lives)}
          onBack={() => navigateToMenu()}
        />
      );
    }
    return <LimboGame />;
  }

  return <div>Game not found</div>;
}

export default App;
