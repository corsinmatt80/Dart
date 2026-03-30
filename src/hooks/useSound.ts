import { useCallback, useRef } from 'react';
import { useAppStore } from '../store/appStore';

// Sound types for different hit events
type SoundType = 
  | 'hit'        // Normal single hit
  | 'double'     // Double hit
  | 'triple'     // Triple hit  
  | 'bull'       // Single bull (25)
  | 'bullseye'   // Double bull (50)
  | 'miss'       // Miss
  | 'bust'       // Bust in 501
  | 'win'        // Game won
  | 'kill'       // Player eliminated in Killer
  | 'turn'       // Turn ended
  | 'undo';      // Undo action

export function useSound() {
  const { soundEnabled } = useAppStore();
  const audioContextRef = useRef<AudioContext | null>(null);

  const getAudioContext = useCallback(async () => {
    if (!audioContextRef.current) {
      audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
    // Resume audio context if suspended (browser autoplay policy)
    if (audioContextRef.current.state === 'suspended') {
      await audioContextRef.current.resume();
    }
    return audioContextRef.current;
  }, []);

  const playTone = useCallback(async (
    frequency: number, 
    duration: number, 
    type: OscillatorType = 'sine',
    gainValue: number = 0.5,
    delay: number = 0
  ) => {
    const ctx = await getAudioContext();
    const oscillator = ctx.createOscillator();
    const gainNode = ctx.createGain();
    
    oscillator.connect(gainNode);
    gainNode.connect(ctx.destination);
    
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, ctx.currentTime + delay);
    
    gainNode.gain.setValueAtTime(gainValue, ctx.currentTime + delay);
    gainNode.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + delay + duration);
    
    oscillator.start(ctx.currentTime + delay);
    oscillator.stop(ctx.currentTime + delay + duration);
  }, [getAudioContext]);

  const playSound = useCallback((soundType: SoundType) => {
    if (!soundEnabled) return;

    try {
      switch (soundType) {
        case 'hit':
          // Simple pleasant ping
          playTone(880, 0.15, 'sine', 0.2);
          break;

        case 'double':
          // Two-tone ascending
          playTone(660, 0.12, 'sine', 0.25);
          playTone(880, 0.15, 'sine', 0.25, 0.08);
          break;

        case 'triple':
          // Three-tone fanfare
          playTone(523, 0.1, 'sine', 0.3);  // C5
          playTone(659, 0.1, 'sine', 0.3, 0.08);  // E5
          playTone(784, 0.2, 'sine', 0.35, 0.16); // G5
          break;

        case 'bull':
          // Deep satisfying thud + ring
          playTone(220, 0.1, 'triangle', 0.4);
          playTone(440, 0.2, 'sine', 0.25, 0.05);
          break;

        case 'bullseye':
          // Epic ascending chord
          playTone(261, 0.15, 'sine', 0.3);  // C4
          playTone(329, 0.15, 'sine', 0.3, 0.05);  // E4
          playTone(392, 0.15, 'sine', 0.3, 0.1);   // G4
          playTone(523, 0.25, 'sine', 0.35, 0.15); // C5
          playTone(784, 0.3, 'sine', 0.3, 0.2);    // G5
          break;

        case 'miss':
          // Sad descending tone
          playTone(300, 0.2, 'sawtooth', 0.15);
          playTone(200, 0.25, 'sawtooth', 0.1, 0.15);
          break;

        case 'bust':
          // Error/wrong sound
          playTone(200, 0.15, 'square', 0.2);
          playTone(150, 0.2, 'square', 0.15, 0.1);
          playTone(100, 0.3, 'square', 0.1, 0.2);
          break;

        case 'win':
          // Victory fanfare
          playTone(523, 0.15, 'sine', 0.3);  // C5
          playTone(659, 0.15, 'sine', 0.3, 0.12);  // E5
          playTone(784, 0.15, 'sine', 0.3, 0.24);  // G5
          playTone(1047, 0.4, 'sine', 0.35, 0.36); // C6
          // Add shimmer
          playTone(1318, 0.3, 'sine', 0.2, 0.4);
          playTone(1568, 0.25, 'sine', 0.15, 0.45);
          break;

        case 'kill':
          // Dramatic elimination sound
          playTone(400, 0.1, 'sawtooth', 0.3);
          playTone(300, 0.15, 'sawtooth', 0.25, 0.08);
          playTone(200, 0.2, 'sawtooth', 0.2, 0.18);
          playTone(100, 0.3, 'sawtooth', 0.15, 0.3);
          break;

        case 'turn':
          // Soft click/transition
          playTone(600, 0.08, 'sine', 0.15);
          break;

        case 'undo':
          // Rewind/swoosh sound
          playTone(600, 0.1, 'sine', 0.2);
          playTone(400, 0.15, 'sine', 0.15, 0.05);
          break;
      }
    } catch (err) {
      console.error('Sound playback error:', err);
    }
  }, [soundEnabled, playTone]);

  // Helper to determine sound type from hit data
  const playSoundForHit = useCallback((hitData: { value: number; multiplier: number }) => {
    if (!soundEnabled) return;

    const { value, multiplier } = hitData;

    if (value === 0) {
      playSound('miss');
    } else if (value === 25 && multiplier === 2) {
      playSound('bullseye');
    } else if (value === 25) {
      playSound('bull');
    } else if (multiplier === 3) {
      playSound('triple');
    } else if (multiplier === 2) {
      playSound('double');
    } else {
      playSound('hit');
    }
  }, [soundEnabled, playSound]);

  return { playSound, playSoundForHit };
}
