/**
 * WebRTC-Verbindung Handy <-> Desktop via PeerJS (kostenloser oeffentlicher
 * Broker; nur Signaling laeuft darueber, Video direkt P2P).
 *
 * Rollen:
 *  - Host  = Desktop: empfaengt den Kamera-Stream des Handys.
 *  - Guest = Handy: sendet seinen Kamera-Stream an den Host.
 */
import Peer, { type MediaConnection } from 'peerjs';

export type ConnState = 'connecting' | 'waiting' | 'connected' | 'error' | 'closed';

export interface HostHandle {
  hostId: string;
  destroy: () => void;
}

/** Kurze, gut teilbare Peer-ID (Broker verlangt Eindeutigkeit). */
function makeHostId(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let s = 'dart-';
  for (let i = 0; i < 6; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

/**
 * Startet den Desktop-Host. `onStream` feuert, sobald das Handy seinen
 * Kamera-Stream sendet. Liefert die Host-ID (fuer den QR-Code) zurueck.
 */
export function createHost(
  onStream: (stream: MediaStream) => void,
  onState: (state: ConnState, info?: string) => void,
): HostHandle {
  const hostId = makeHostId();
  const peer = new Peer(hostId);
  let activeCall: MediaConnection | null = null;

  peer.on('open', () => onState('waiting'));
  peer.on('error', (err) => onState('error', String(err)));
  peer.on('disconnected', () => onState('closed'));

  peer.on('call', (call) => {
    activeCall?.close();
    activeCall = call;
    call.answer(); // Host sendet kein Medium, empfaengt nur.
    onState('connecting');
    call.on('stream', (stream) => {
      onState('connected');
      onStream(stream);
    });
    call.on('close', () => onState('waiting'));
    call.on('error', (err) => onState('error', String(err)));
  });

  return {
    hostId,
    destroy: () => {
      activeCall?.close();
      peer.destroy();
    },
  };
}

export interface GuestHandle {
  destroy: () => void;
}

/**
 * Verbindet das Handy mit dem Host und sendet `stream`. Wiederholt den Call,
 * bis der Host erreichbar ist.
 */
export function createGuest(
  hostId: string,
  stream: MediaStream,
  onState: (state: ConnState, info?: string) => void,
): GuestHandle {
  const peer = new Peer();
  let call: MediaConnection | null = null;
  let retry: ReturnType<typeof setTimeout> | null = null;
  let destroyed = false;

  const tryCall = () => {
    if (destroyed) return;
    onState('connecting');
    call = peer.call(hostId, stream);
    if (!call) {
      retry = setTimeout(tryCall, 1500);
      return;
    }
    call.on('stream', () => onState('connected'));
    call.on('close', () => onState('closed'));
    call.on('error', (err) => onState('error', String(err)));
    // Wenn der Host noch nicht da ist, scheitert der Call still -> erneut versuchen.
    retry = setTimeout(() => {
      if (!destroyed) onState('connected'); // Stream laeuft; Host meldet sich nicht zwingend zurueck.
    }, 1200);
  };

  peer.on('open', tryCall);
  peer.on('error', (err) => {
    onState('error', String(err));
    if (!destroyed) retry = setTimeout(tryCall, 2000);
  });

  return {
    destroy: () => {
      destroyed = true;
      if (retry) clearTimeout(retry);
      call?.close();
      peer.destroy();
    },
  };
}
