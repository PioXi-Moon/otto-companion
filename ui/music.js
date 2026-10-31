/**
 * 六首环境音乐的本地合成器。
 *
 * 这里不加载音频文件：每首曲目只保留很小的结构数据，播放时用
 * Oscillator + Gain + Delay 生成可持续的循环。隐藏的面板窗口也能继续出声。
 */
export class AmbientMusicEngine {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.delay = null;
    this.feedback = null;
    this.trackGain = null;
    this.noise = null;
    this.noiseGain = null;
    this.timer = null;
    this.track = null;
    this.volume = 0.72;
    this.paused = false;
    this.startedAt = 0;
    this.pausedAt = 0;
    this.nextBeat = 0;
    this.beat = 0;
    this.beatSeconds = 1;
    this.onState = null;
  }

  ensureContext() {
    if (this.ctx) return this.ctx;
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) throw new Error("当前环境不支持 Web Audio");
    this.ctx = new AudioCtx();
    const compressor = this.ctx.createDynamicsCompressor();
    compressor.threshold.value = -12;
    compressor.knee.value = 12;
    compressor.ratio.value = 3;
    compressor.attack.value = 0.01;
    compressor.release.value = 0.18;

    this.master = this.ctx.createGain();
    this.master.gain.value = this.volume;
    // 音色本身留了较大动态余量；在压缩器前补一段总线增益，
    // 让 46% 这种普通音量也真的能听清，而不是只能贴着扬声器听。
    const outputBoost = this.ctx.createGain();
    outputBoost.gain.value = 2.4;
    this.master.connect(outputBoost);
    outputBoost.connect(compressor);
    compressor.connect(this.ctx.destination);

    this.delay = this.ctx.createDelay(2.5);
    this.delay.delayTime.value = 0.47;
    this.feedback = this.ctx.createGain();
    this.feedback.gain.value = 0.24;
    const tone = this.ctx.createBiquadFilter();
    tone.type = "lowpass";
    tone.frequency.value = 2200;
    this.delay.connect(tone);
    tone.connect(this.feedback);
    this.feedback.connect(this.delay);
    tone.connect(this.master);
    return this.ctx;
  }

  async unlock() {
    const ctx = this.ensureContext();
    if (ctx.state === "suspended") await ctx.resume();
    return ctx.state === "running";
  }

  setVolume(value) {
    this.volume = Math.max(0, Math.min(1, Number(value) || 0));
    if (this.master && this.ctx) {
      this.master.gain.cancelScheduledValues(this.ctx.currentTime);
      this.master.gain.setTargetAtTime(this.volume, this.ctx.currentTime, 0.08);
    }
  }

  async play(track) {
    if (!track) return false;
    const ctx = this.ensureContext();
    await this.unlock();
    this.stopScheduling();
    this.teardownTrack();
    this.track = track;
    this.paused = false;
    this.startedAt = performance.now();
    this.pausedAt = 0;
    this.beatSeconds = 60 / track.bpm;
    this.beat = 0;
    this.nextBeat = ctx.currentTime + 0.08;

    this.trackGain = ctx.createGain();
    this.trackGain.gain.setValueAtTime(0.0001, ctx.currentTime);
    this.trackGain.gain.exponentialRampToValueAtTime(0.9, ctx.currentTime + 1.4);
    this.trackGain.connect(this.master);
    this.trackGain.connect(this.delay);

    if (track.noise > 0) this.startNoise(track);
    this.schedule();
    this.timer = setInterval(() => this.schedule(), 120);
    this.onState?.({ status: "playing", track });
    return true;
  }

  pause() {
    if (!this.ctx || !this.track) return false;
    this.paused = true;
    this.pausedAt = performance.now();
    this.stopScheduling();
    this.ctx.suspend().catch(() => {});
    this.onState?.({ status: "paused", track: this.track });
    return true;
  }

  async resume() {
    if (!this.ctx || !this.track) return false;
    await this.unlock();
    if (this.pausedAt) this.startedAt += performance.now() - this.pausedAt;
    this.pausedAt = 0;
    this.paused = false;
    this.nextBeat = this.ctx.currentTime + 0.06;
    this.stopScheduling();
    this.schedule();
    this.timer = setInterval(() => this.schedule(), 120);
    this.onState?.({ status: "playing", track: this.track });
    return true;
  }

  stop() {
    this.stopScheduling();
    this.teardownTrack();
    this.track = null;
    this.paused = false;
    this.onState?.({ status: "stopped", track: null });
  }

  isPlaying(trk = null) {
    return !!this.track && !this.paused && (!trk || this.track.id === trk.id);
  }

  elapsedSeconds() {
    if (!this.track) return 0;
    const base = this.startedAt || performance.now();
    return Math.max(0, Math.floor((performance.now() - base) / 1000));
  }

  schedule() {
    if (!this.ctx || !this.track || this.paused) return;
    const horizon = this.ctx.currentTime + 0.35;
    let guard = 0;
    while (this.nextBeat < horizon && guard++ < 24) {
      this.scheduleBeat(this.beat, this.nextBeat);
      this.nextBeat += this.beatSeconds;
      this.beat += 1;
    }
  }

  scheduleBeat(beat, when) {
    const track = this.track;
    if (!track) return;
    const bar = Math.floor(beat / 4) % track.progression.length;
    const inBar = beat % 4;
    const chord = track.progression[bar] ?? track.progression[0] ?? [0, 2, 4];
    if (inBar === 0) {
      for (let i = 0; i < chord.length; i += 1) {
        this.note(this.freq(track, chord[i]), when + i * 0.035, this.beatSeconds * 4.8, 0.07, "pad", i);
      }
    }

    const pattern = (beat * 3 + bar * 5) % 11;
    if (pattern <= 3 || inBar === 2) {
      const degree = track.scale[(beat * 7 + bar) % track.scale.length];
      const octave = pattern === 0 ? 2 : 1;
      this.note(this.freq(track, degree, octave), when + 0.01, this.beatSeconds * 1.8, 0.14, "lead", 0);
    }
    if (inBar === 0 && track.timbre !== "deep") {
      this.note(this.freq(track, chord[0], 0.5), when, this.beatSeconds * 2.3, 0.08, "bass", 0);
    }
  }

  freq(track, semitone, octave = 1) {
    return track.root * Math.pow(2, semitone / 12) * (octave === 2 ? 2 : octave === 0.5 ? 0.5 : 1);
  }

  note(freq, when, duration, amount, role, index = 0) {
    if (!this.ctx || !this.trackGain) return;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    const filter = this.ctx.createBiquadFilter();
    const timbre = this.track?.timbre ?? "soft";
    osc.type =
      role === "bass" ? "sine" :
      timbre === "glass" ? "sine" :
      timbre === "bright" || timbre === "pluck" ? (role === "lead" ? "triangle" : "sine") :
      "sine";
    osc.frequency.setValueAtTime(Math.max(55, freq), when);
    if (timbre === "pluck" && role === "lead") {
      osc.frequency.exponentialRampToValueAtTime(Math.max(55, freq * 0.997), when + duration);
    }

    filter.type = "lowpass";
    filter.frequency.setValueAtTime(
      timbre === "deep" ? 900 : timbre === "bright" ? 3600 : timbre === "glass" ? 4800 : 2500,
      when
    );
    filter.Q.value = timbre === "glass" ? 1.6 : 0.35;

    const attack = role === "pad" ? 0.9 : timbre === "pluck" ? 0.015 : 0.08;
    const release = role === "pad" ? duration * 0.75 : Math.min(duration * 0.8, 2.4);
    const peak = amount * (1 - index * 0.12);
    gain.gain.setValueAtTime(0.0001, when);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), when + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, when + Math.max(attack + 0.08, release));

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(this.trackGain);
    if (role === "lead") gain.connect(this.delay);
    osc.start(when);
    osc.stop(when + duration + 0.12);
    osc.addEventListener("ended", () => {
      try {
        osc.disconnect();
        filter.disconnect();
        gain.disconnect();
      } catch {
        /* already disconnected */
      }
    }, { once: true });
  }

  startNoise(track) {
    const ctx = this.ctx;
    const length = Math.max(1, Math.floor(ctx.sampleRate * 2));
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    let last = 0;
    for (let i = 0; i < length; i += 1) {
      const white = Math.random() * 2 - 1;
      last = last * 0.985 + white * 0.015;
      data[i] = last;
    }
    this.noise = ctx.createBufferSource();
    this.noise.buffer = buffer;
    this.noise.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = track.id === "rain-desk" ? 1700 : 850;
    this.noiseGain = ctx.createGain();
    this.noiseGain.gain.value = track.noise;
    this.noise.connect(filter);
    filter.connect(this.noiseGain);
    this.noiseGain.connect(this.master);
    this.noise.start();
    this.noiseFilter = filter;
  }

  teardownTrack() {
    if (this.trackGain && this.ctx) {
      const at = this.ctx.currentTime;
      this.trackGain.gain.cancelScheduledValues(at);
      this.trackGain.gain.setTargetAtTime(0.0001, at, 0.08);
    }
    if (this.noise) {
      try {
        this.noise.stop();
        this.noise.disconnect();
        this.noiseFilter?.disconnect();
        this.noiseGain?.disconnect();
      } catch {
        /* already stopped */
      }
    }
    this.noise = null;
    this.noiseGain = null;
    this.noiseFilter = null;
    this.trackGain = null;
  }

  stopScheduling() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}

export function speakEnglish(text, rate = 0.78) {
  if (!("speechSynthesis" in window)) return false;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(String(text ?? ""));
  utterance.lang = "en-US";
  utterance.rate = rate;
  utterance.pitch = 1;
  const voices = window.speechSynthesis.getVoices();
  const voice = voices.find((v) => /^en[-_]/i.test(v.lang) && /natural|samantha|aria|jenny/i.test(v.name))
    ?? voices.find((v) => /^en[-_]/i.test(v.lang));
  if (voice) utterance.voice = voice;
  window.speechSynthesis.speak(utterance);
  return true;
}
