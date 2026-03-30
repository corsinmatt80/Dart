// useSpeak.ts: React hook for speech synthesis
import { useCallback } from 'react';

export function useSpeak() {
  // Speaks a given text string
  const speak = useCallback((text: string) => {
    if (!('speechSynthesis' in window)) return;
    // Cancel any ongoing speech
    window.speechSynthesis.cancel();
    const utter = new window.SpeechSynthesisUtterance(text);
    utter.lang = 'de-DE'; // Use German for numbers
    utter.rate = 1.05;
    utter.pitch = 1.1;
    utter.volume = 1;
    window.speechSynthesis.speak(utter);
  }, []);

  return { speak };
}
