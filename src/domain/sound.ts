/**
 * Web Audio UI synthesiser. Ported from the prototype with two changes:
 * the AudioContext is created lazily on first gesture (browsers refuse it
 * otherwise), and `setMuted` replaces reaching into a public field.
 */
type ToneSpec = {
  type: OscillatorType;
  from: number;
  to: number;
  duration: number;
  gain: number;
  ramp: 'exponential' | 'linear';
};

const TONES = {
  click: { type: 'sine', from: 880, to: 440, duration: 0.05, gain: 0.08, ramp: 'exponential' },
  warp: { type: 'sawtooth', from: 120, to: 600, duration: 0.4, gain: 0.12, ramp: 'exponential' },
  burn: { type: 'triangle', from: 65, to: 90, duration: 0.6, gain: 0.2, ramp: 'linear' },
} as const satisfies Record<string, ToneSpec>;

export type ToneName = keyof typeof TONES;

class SoundEngine {
  private ctx: AudioContext | null = null;
  private muted = false;

  setMuted(muted: boolean): void {
    this.muted = muted;
  }

  private ensureContext(): AudioContext | null {
    if (this.ctx) return this.ctx;
    if (typeof window === 'undefined') return null;
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    this.ctx = new Ctor();
    return this.ctx;
  }

  play(name: ToneName): void {
    if (this.muted) return;
    const ctx = this.ensureContext();
    if (!ctx) return;
    // Autoplay policy: the context starts suspended until a gesture resumes it.
    if (ctx.state === 'suspended') void ctx.resume();

    const spec = TONES[name];
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const now = ctx.currentTime;

    osc.type = spec.type;
    osc.frequency.setValueAtTime(spec.from, now);
    if (spec.ramp === 'exponential') {
      osc.frequency.exponentialRampToValueAtTime(spec.to, now + spec.duration);
    } else {
      osc.frequency.linearRampToValueAtTime(spec.to, now + spec.duration);
    }

    gain.gain.setValueAtTime(spec.gain, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + spec.duration);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + spec.duration);
  }
}

export const sfx = new SoundEngine();
