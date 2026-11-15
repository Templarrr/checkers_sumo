// Collisions and landings are synthesised with Web Audio, so there are no sound files to load.
export function createSound() {
  let context = null;
  let muted = false;
  let lastClack = 0;
  try {
    muted = localStorage.getItem('checkersSumo.muted') === '1';
  } catch {
    // Storage can be unavailable (private mode).
  }

  // Browsers (Safari above all) only allow audio to start from a user gesture.
  const unlock = () => {
    if (!context) {
      const AudioContext = window.AudioContext ?? window.webkitAudioContext;
      if (!AudioContext) return;
      context = new AudioContext();
    }
    if (context.state === 'suspended') context.resume();
  };
  window.addEventListener('pointerdown', unlock, { capture: true });

  function knock({ volume, frequency, decay }) {
    if (muted || !context || context.state !== 'running') return;
    const now = context.currentTime;
    const length = Math.ceil(context.sampleRate * decay);
    const buffer = context.createBuffer(1, length, context.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / length) ** 4;
    const source = context.createBufferSource();
    source.buffer = buffer;
    const filter = context.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = frequency;
    filter.Q.value = 3;
    const gain = context.createGain();
    gain.gain.setValueAtTime(volume, now);
    source.connect(filter).connect(gain).connect(context.destination);
    source.start(now);
  }

  return {
    get muted() {
      return muted;
    },
    setMuted(value) {
      muted = value;
      try {
        localStorage.setItem('checkersSumo.muted', value ? '1' : '0');
      } catch {
        // Not remembering the choice is fine.
      }
    },
    clack(strength) {
      // Several pieces touching at once would otherwise stack into one loud burst.
      const now = performance.now();
      if (now - lastClack < 25) return;
      lastClack = now;
      knock({ volume: Math.min(1, 0.15 + strength / 5) * 1.6, frequency: 2400, decay: 0.07 });
    },
    thud() {
      knock({ volume: 1.4, frequency: 500, decay: 0.15 });
    },
  };
}
