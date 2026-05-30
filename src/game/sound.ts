/**
 * sound.ts — Web Audio API sound effects synthesizer.
 *
 * All sounds are synthesized via the Web Audio oscillator / noise API —
 * no .wav files required. This avoids asset licensing issues and loads instantly.
 *
 * Audio mixing model (from CLAUDE.md):
 *   - One-shot sounds: fresh OscillatorNode per trigger (self-disposing).
 *   - UFO loop: single long-lived OscillatorNode, manually start/stopped.
 *
 * Lifecycle: AudioContext is created lazily on the first call to `resume()`,
 * which MUST be called from a user-gesture handler. The browser suspends any
 * AudioContext created outside a gesture, so we defer creation until then to
 * avoid an "AudioContext was not allowed to start" warning on page load.
 *
 * Calling any sound method before `resume()` is a safe no-op.
 *
 * Background music: a single looping track (intergalactic-odyssey.ogg) decoded
 * once into an AudioBuffer on resume(). Playback is driven by `setMusicPlaying`,
 * which fades a dedicated gain node up/down — the looping source stays alive so
 * pause/resume picks up exactly where it left off.
 */

import musicUrl from '../assets/intergalactic-odyssey.ogg';

export interface AudioManager {
  /** Unlock the AudioContext. Must be called from a user-gesture handler. */
  resume(): void;
  /**
   * Drive looping background music. `true` fades the track in (starting the
   * loop on first call once decoded); `false` fades it out. Idempotent.
   */
  setMusicPlaying(on: boolean): void;
  /** Player fired a bullet. */
  shoot(): void;
  /** An invader was destroyed. */
  invaderHit(): void;
  /** The player was hit. */
  playerHit(): void;
  /**
   * Invader grid step — plays one note of the 4-note descending loop.
   * Caller is responsible for advancing the note index each grid step.
   */
  invaderStep(note: 0 | 1 | 2 | 3): void;
  /** Start the continuous UFO flyby sound. No-op if already playing. */
  ufoStart(): void;
  /** Stop the UFO flyby sound. No-op if not playing. */
  ufoStop(): void;
  /** UFO destroyed — plays a hit sound and stops the loop. */
  ufoHit(): void;
}

/** Frequencies (Hz) for the 4-note descending invader-step loop. */
const STEP_FREQS: [number, number, number, number] = [160, 120, 90, 70];

export function makeAudioManager(): AudioManager {
  // Lazily created on resume() to avoid browser autoplay policy warnings.
  let ctx: AudioContext | null = null;

  // ── UFO sustained sound state ─────────────────────────────────────────────
  let ufoOsc: OscillatorNode | null = null;
  let ufoGain: GainNode | null = null;
  let ufoLfo: OscillatorNode | null = null;

  // ── Background music state ────────────────────────────────────────────────
  const MUSIC_VOLUME = 0.35; // sits under the SFX so blips/explosions stay audible
  let musicBuffer: AudioBuffer | null = null;
  let musicSource: AudioBufferSourceNode | null = null;
  let musicGain: GainNode | null = null;
  let musicWanted = false; // desired play state, applied once the buffer decodes

  /** Fetch + decode the music file once. Safe to call repeatedly. */
  function loadMusic(): void {
    if (ctx === null || musicBuffer !== null) return;
    const audioCtx = ctx;
    fetch(musicUrl)
      .then((r) => r.arrayBuffer())
      .then((data) => audioCtx.decodeAudioData(data))
      .then((buf) => {
        musicBuffer = buf;
        if (musicWanted) startMusicSource();
      })
      .catch(() => {
        // Silent: missing/undecodable music shouldn't break the game.
      });
  }

  /** Create the looping source + gain and begin playback (faded in). */
  function startMusicSource(): void {
    if (ctx === null || musicBuffer === null || musicSource !== null) return;

    musicGain = ctx.createGain();
    musicGain.gain.setValueAtTime(0, ctx.currentTime);
    musicGain.connect(ctx.destination);

    musicSource = ctx.createBufferSource();
    musicSource.buffer = musicBuffer;
    musicSource.loop = true;
    musicSource.connect(musicGain);
    musicSource.start();

    musicGain.gain.linearRampToValueAtTime(MUSIC_VOLUME, ctx.currentTime + 0.8);
  }

  // ── One-shot tone helper ──────────────────────────────────────────────────
  /**
   * Create and immediately start a decaying oscillator.
   * `freq` → `freqEnd` over `duration` seconds, then it self-disposes.
   * Silent if the AudioContext isn't running yet.
   */
  function playTone(
    type: OscillatorType,
    freq: number,
    freqEnd: number,
    duration: number,
    gainPeak: number,
  ): void {
    if (ctx === null || ctx.state !== 'running') return;

    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.connect(g);
    g.connect(ctx.destination);

    osc.type = type;
    osc.frequency.setValueAtTime(freq, ctx.currentTime);
    if (freqEnd !== freq) {
      osc.frequency.exponentialRampToValueAtTime(
        Math.max(freqEnd, 5), // exponentialRamp cannot target 0 or negative
        ctx.currentTime + duration,
      );
    }
    g.gain.setValueAtTime(gainPeak, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);

    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + duration); // node self-disposes after stopping
  }

  // ── Public API ────────────────────────────────────────────────────────────
  return {
    resume(): void {
      if (ctx === null) {
        ctx = new AudioContext();
      }
      if (ctx.state === 'suspended') {
        ctx.resume().catch(() => {
          // Silent: if resume fails (e.g. user has audio blocked), continue without sound.
        });
      }
      loadMusic(); // kick off decode now that we have a context (lazy, idempotent)
    },

    setMusicPlaying(on: boolean): void {
      musicWanted = on;
      if (ctx === null || ctx.state !== 'running') return;

      if (on) {
        if (musicSource === null) {
          startMusicSource(); // no-op until the buffer has decoded
        } else if (musicGain !== null) {
          musicGain.gain.cancelScheduledValues(ctx.currentTime);
          musicGain.gain.linearRampToValueAtTime(MUSIC_VOLUME, ctx.currentTime + 0.5);
        }
      } else if (musicGain !== null) {
        musicGain.gain.cancelScheduledValues(ctx.currentTime);
        musicGain.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.4);
      }
    },

    shoot(): void {
      // Short high-pitched square blip descending in frequency — laser feel.
      playTone('square', 880, 220, 0.08, 0.2);
    },

    invaderHit(): void {
      // Sawtooth burst descending to low rumble — classic arcade "zap".
      playTone('sawtooth', 240, 40, 0.18, 0.3);
    },

    playerHit(): void {
      // Two-layer explosion: low sawtooth + higher square for texture.
      playTone('sawtooth', 80, 20, 0.6, 0.5);
      playTone('square', 150, 30, 0.4, 0.2);
    },

    invaderStep(note: 0 | 1 | 2 | 3): void {
      // Short square pulse at the note frequency — the classic 4-note march.
      playTone('square', STEP_FREQS[note], STEP_FREQS[note], 0.04, 0.12);
    },

    ufoStart(): void {
      if (ctx === null || ctx.state !== 'running' || ufoOsc !== null) return;

      // UFO: sawtooth oscillator modulated by a slow LFO for the alternating tone effect.
      ufoOsc = ctx.createOscillator();
      ufoGain = ctx.createGain();
      ufoLfo = ctx.createOscillator();
      const lfoGain = ctx.createGain();

      ufoOsc.type = 'sawtooth';
      ufoOsc.frequency.value = 480;

      ufoLfo.type = 'sine';
      ufoLfo.frequency.value = 7; // 7 Hz — alternates ~7× per second
      lfoGain.gain.value = 180;   // ± 180 Hz variation

      ufoLfo.connect(lfoGain);
      lfoGain.connect(ufoOsc.frequency);
      ufoOsc.connect(ufoGain);
      ufoGain.connect(ctx.destination);
      ufoGain.gain.value = 0.12;

      ufoLfo.start();
      ufoOsc.start();
    },

    ufoStop(): void {
      if (ufoOsc !== null) {
        try { ufoOsc.stop(); } catch { /* already stopped */ }
        ufoOsc.disconnect();
        ufoOsc = null;
      }
      if (ufoGain !== null) {
        ufoGain.disconnect();
        ufoGain = null;
      }
      if (ufoLfo !== null) {
        try { ufoLfo.stop(); } catch { /* already stopped */ }
        ufoLfo.disconnect();
        ufoLfo = null;
      }
    },

    ufoHit(): void {
      // Stop the loop first, then play a descending sweep hit sound.
      this.ufoStop();
      playTone('sawtooth', 400, 30, 0.4, 0.4);
    },
  };
}
