// Coach voice: text-to-speech with the browser's built-in Web Speech API (speechSynthesis).
//
// Why this and not a neural TTS in the page: it is free, needs no keys or servers (this is a
// public static site), downloads nothing, works offline, starts instantly, and costs no CPU on
// the main thread (the transcriber needs it). On iPad it uses Apple's on-device voices; if the
// user has downloaded an "Enhanced" or "Premium" voice (Settings > Accessibility > Spoken
// Content > Voices > English) it is picked automatically. In-browser neural options (Kokoro-82M
// via kokoro-js: ~86 MB q8 model + transformers.js/onnxruntime WASM + an eSpeak-NG phonemizer;
// Piper/VITS: 20-60 MB per voice, eSpeak-NG phonemes, mixed voice licenses) are too heavy and
// slow for an iPad that is also transcribing audio in real time.
//
// iOS quirks handled: the first speak() must come from a tap (unlock()), voices load
// asynchronously (voiceschanged + polling), onend sometimes never fires (every utterance has a
// length-based timeout), speak() right after cancel() can be dropped (short gap), long texts are
// split into sentences (Chrome also cuts utterances off after ~15 s).
//
//   import { voice } from './voice.js';
//   button.onclick = () => voice.unlock();          // inside a user gesture, once
//   await voice.speak('Nice! Now try it with both hands.');
//   audio.attachVoice(voice);                        // mic ignores the coach while it talks

const STORE_KEY = 'maestro.voice';

// Novelty / robotic voices never chosen automatically (macOS/iOS "fun" voices, MacinTalk and
// Eloquence voices).
const NOVELTY = new Set(
  'albert,bad news,bahh,bells,boing,bubbles,cellos,good news,jester,organ,pipe organ,superstar,trinoids,whisper,wobble,zarvox,deranged,hysterical,princess,fred,junior,kathy,ralph,eddy,flo,grandma,grandpa,reed,rocko,sandy,shelley'.split(
    ',',
  ),
);
const GOOD_NAMES = { ava: 6, zoe: 6, evan: 5, nathan: 5, alex: 6, samantha: 4, allison: 4, susan: 3, tom: 3, joelle: 4, noelle: 4, serena: 4, daniel: 4, kate: 3, oliver: 3, karen: 3, moira: 3, tessa: 2, aaron: 3, nicky: 3, siri: 6 };

const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

function baseName(name) {
  return String(name || '')
    .replace(/\(.*?\)/g, '')
    .replace(/^(microsoft|google|apple)\s+/i, '')
    .replace(/\s+(online|desktop)\b.*$/i, '')
    .replace(/\s*-\s*english.*$/i, '')
    .trim()
    .toLowerCase();
}

// Classify and score a SpeechSynthesisVoice (higher = better for an English coach).
export function rateVoice(v) {
  const name = String(v.name || '');
  const uri = String(v.voiceURI || '');
  const all = (name + ' ' + uri).toLowerCase();
  const lang = String(v.lang || '')
    .replace('_', '-')
    .toLowerCase();
  const english = lang.startsWith('en');
  const bn = baseName(name);
  const novelty = NOVELTY.has(bn) || /eloquence|speech\.synthesis\.voice\.(albert|bad|bahh|bells|boing|bubbles|cellos|deranged|good|hysterical|organ|pipe|princess|trinoids|whisper|zarvox|fred|junior|kathy|ralph)/.test(all);
  let quality = 'standard';
  if (/premium/.test(all)) quality = 'premium';
  else if (/enhanced/.test(all)) quality = 'enhanced';
  else if (/natural|neural|wavenet|studio|journey|siri/.test(all)) quality = 'neural';
  if (novelty) quality = 'novelty';
  let score = english ? 10 : -50;
  score += { premium: 30, enhanced: 22, neural: 25, standard: 0, novelty: -100 }[quality];
  if (/^en-us/.test(lang)) score += 8;
  else if (/^en-gb/.test(lang)) score += 7;
  else if (/^en-(au|ie|ca|nz)/.test(lang)) score += 5;
  else if (/^en-(za|in)/.test(lang)) score += 3;
  score += GOOD_NAMES[bn] || 0;
  if (/^google/i.test(name)) score += 10; // Chrome's "Google US English" beats eSpeak-style voices
  if (/compact/.test(all)) score -= 4;
  if (/espeak/.test(all)) score -= 15;
  if (v.localService) score += 2;
  if (v.default) score += 1;
  return { score, quality, english, novelty };
}

function readStore(storage) {
  const def = { enabled: true, uri: null, rate: 1, pitch: 1 };
  try {
    const raw = storage && storage.getItem(STORE_KEY);
    if (raw == null) return def;
    if (raw === '0' || raw === 'false') return { ...def, enabled: false };
    if (raw === '1' || raw === 'true') return def;
    const o = JSON.parse(raw);
    return { ...def, ...(o && typeof o === 'object' ? o : {}) };
  } catch {
    return def;
  }
}

// Split into sentence-sized chunks (<= ~180 chars) so each utterance is short.
export function splitText(text, max = 180) {
  const parts = String(text).match(/[^.!?;:]+[.!?;:]*["')\]]*\s*/g) || [String(text)];
  const out = [];
  let cur = '';
  for (const p of parts) {
    if ((cur + p).length > max && cur) {
      out.push(cur.trim());
      cur = '';
    }
    if (p.length > max) {
      // very long sentence: break at commas / spaces
      let rest = p;
      while (rest.length > max) {
        let cut = rest.lastIndexOf(',', max);
        if (cut < max * 0.4) cut = rest.lastIndexOf(' ', max);
        if (cut < max * 0.4) cut = max;
        out.push(rest.slice(0, cut + 1).trim());
        rest = rest.slice(cut + 1);
      }
      cur = rest;
    } else cur += p;
  }
  if (cur.trim()) out.push(cur.trim());
  return out.filter(Boolean);
}

// Rough speaking time (ms) for a text at a given rate: ~14 characters/s at rate 1.
export function estimateMs(text, rate = 1) {
  return (String(text).length * 72) / clamp(rate || 1, 0.3, 3) + 400;
}

export class Voice {
  // env (for tests): { synth: speechSynthesis-like, Utterance: constructor, storage }
  constructor(env = {}) {
    const g = typeof globalThis !== 'undefined' ? globalThis : {};
    this._synth = env.synth !== undefined ? env.synth : g.speechSynthesis || null;
    this._Utt = env.Utterance || g.SpeechSynthesisUtterance || null;
    this._storage = env.storage !== undefined ? env.storage : safeLocalStorage();
    this.supported = !!(this._synth && this._Utt && typeof this._synth.speak === 'function');
    this._ts = env.timeScale ?? 1; // tests: scale the internal timeouts
    const st = readStore(this._storage);
    this._enabled = !!st.enabled;
    this._uri = st.uri || null;
    this.rate = clamp(Number(st.rate) || 1, 0.5, 1.6);
    this.pitch = clamp(Number(st.pitch) || 1, 0.5, 1.5);
    this._voices = [];
    this._voice = null;
    this._listeners = new Set();
    this._voiceListeners = new Set();
    this._active = 0; // speak() calls not yet settled
    this._gen = 0; // bumped by cancel()
    this._chain = Promise.resolve();
    this._current = null;
    this._needsGap = false;
    this._unlocked = false;
    this.ready = this.supported ? this._loadVoices() : Promise.resolve(false);
  }

  get enabled() {
    return this._enabled;
  }

  set enabled(v) {
    this.setEnabled(v);
  }

  setEnabled(on) {
    this._enabled = !!on;
    if (!this._enabled) this.cancel();
    this._save();
  }

  get speaking() {
    return this._active > 0;
  }

  // The selected voice: {name, lang, uri, quality} or null (browser default).
  get current() {
    return this._voice ? this._info(this._voice) : null;
  }

  // Subscribe to speaking started (true) / stopped (false). Returns an unsubscribe function.
  onChange(cb) {
    this._listeners.add(cb);
    return () => this._listeners.delete(cb);
  }

  // Subscribe to voice list changes (voices load asynchronously).
  onVoicesChanged(cb) {
    this._voiceListeners.add(cb);
    return () => this._voiceListeners.delete(cb);
  }

  // Available voices, best first: [{name, lang, uri, quality, local, novelty, selected, score}].
  // English only unless { all: true }.
  list({ all = false } = {}) {
    const sel = this._voice;
    return this._voices
      .map((v) => ({ v, r: rateVoice(v) }))
      .filter(({ r }) => all || r.english)
      .sort((a, b) => b.r.score - a.r.score || String(a.v.name).localeCompare(String(b.v.name)))
      .map(({ v, r }) => ({ ...this._info(v), novelty: r.novelty, score: r.score, selected: v === sel }));
  }

  // Choose a voice by voiceURI (or name); null = automatic best voice. Persisted.
  setVoice(uri) {
    this._uri = uri || null;
    this._pick();
    this._save();
  }

  setRate(r) {
    this.rate = clamp(Number(r) || 1, 0.5, 1.6);
    this._save();
  }

  setPitch(p) {
    this.pitch = clamp(Number(p) || 1, 0.5, 1.5);
    this._save();
  }

  // Call inside a user gesture (tap) once: iOS only allows speech that started from a gesture.
  unlock() {
    if (!this.supported) return false;
    this._refresh();
    if (this._unlocked) return true;
    try {
      const u = new this._Utt(' ');
      u.volume = 0;
      u.rate = 2;
      if (this._voice) u.voice = this._voice;
      this._keep = u;
      this._synth.speak(u);
      this._unlocked = true;
    } catch {
      /* ignore */
    }
    return this._unlocked;
  }

  // Speak `text`. Resolves (never rejects, never hangs) with {ok, reason?} when finished.
  // opts: { interrupt = true (stop whatever is being said), rate, pitch, volume }
  speak(text, opts = {}) {
    opts = opts || {};
    const t = String(text ?? '').trim();
    if (!t) return Promise.resolve({ ok: false, reason: 'empty' });
    if (!this.supported) return Promise.resolve({ ok: false, reason: 'unsupported' });
    if (!this._enabled) return Promise.resolve({ ok: false, reason: 'disabled' });
    const interrupt = opts.interrupt ?? true;
    this._begin(); // speaking = true now (before cancel settles): the mic hold stays continuous
    if (interrupt) this.cancel();
    const gen = this._gen;
    const run = async () => {
      if (gen !== this._gen) return { ok: false, reason: 'cancelled' };
      await Promise.race([this.ready, new Promise((r) => setTimeout(r, 1200 * this._ts))]);
      let reason = null;
      for (const chunk of splitText(t)) {
        if (gen !== this._gen) return { ok: false, reason: 'cancelled' };
        const r = await this._say(chunk, opts);
        if (!r.ok) return r;
        if (r.reason) reason = r.reason; // e.g. 'timeout': spoke, but onend never came
      }
      return reason ? { ok: true, reason } : { ok: true };
    };
    const p = this._chain.then(run, run).catch(() => ({ ok: false, reason: 'error' }));
    this._chain = p;
    return p.then((r) => {
      this._end();
      return r;
    });
  }

  // Stop speaking now and drop anything queued.
  cancel() {
    this._gen++;
    const cur = this._current;
    if (this.supported) {
      try {
        if (cur || this._synth.speaking || this._synth.pending) this._needsGap = true;
        this._synth.cancel();
      } catch {
        /* ignore */
      }
    }
    if (cur) cur.finish(false, 'cancelled');
  }

  // ---- internals ---------------------------------------------------------------------------

  _begin() {
    if (this._active++ === 0) this._notify(true);
  }

  _end() {
    if (--this._active === 0) this._notify(false);
    if (this._active < 0) this._active = 0;
  }

  _notify(speaking) {
    for (const cb of [...this._listeners]) {
      try {
        cb(speaking);
      } catch {
        /* listener errors must not break speech */
      }
    }
  }

  async _say(text, opts) {
    if (this._needsGap) {
      this._needsGap = false;
      await new Promise((r) => setTimeout(r, 80 * this._ts));
    }
    return new Promise((resolve) => {
      const u = new this._Utt(text);
      if (this._voice) {
        u.voice = this._voice;
        u.lang = this._voice.lang;
      } else u.lang = 'en-US';
      u.rate = clamp(opts.rate ?? this.rate, 0.5, 2);
      u.pitch = clamp(opts.pitch ?? this.pitch, 0, 2);
      u.volume = clamp(opts.volume ?? 1, 0, 1);
      const est = estimateMs(text, u.rate);
      let settled = false;
      let timer = null;
      let started = false;
      const finish = (ok, reason) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (this._current && this._current.u === u) this._current = null;
        resolve(reason ? { ok, reason } : { ok });
      };
      const giveUp = () => {
        // iOS sometimes never fires onend: give up and unstick the engine's queue
        try {
          this._synth.cancel();
        } catch {
          /* ignore */
        }
        finish(started, started ? 'timeout' : 'no-start');
      };
      const arm = (ms, fn = giveUp) => {
        clearTimeout(timer);
        timer = setTimeout(fn, ms * this._ts);
      };
      const onStarted = () => {
        if (started) return;
        started = true;
        arm(est * 1.6 + 1500);
      };
      u.onstart = onStarted;
      u.onend = () => finish(true);
      u.onerror = (e) => {
        const err = e && e.error;
        finish(false, err === 'interrupted' || err === 'canceled' ? 'cancelled' : err || 'error');
      };
      this._current = { u, finish };
      this._keep = u; // keep a reference: Chrome drops events of garbage-collected utterances
      // Not started after 3 s: blocked (no user-gesture unlock) or no voice. If the engine says it
      // is speaking anyway (onstart not delivered), fall back to the length-based timeout.
      arm(3000, () => {
        let busy = false;
        try {
          busy = !!this._synth.speaking;
        } catch {
          /* ignore */
        }
        if (busy) onStarted();
        else giveUp();
      });
      try {
        if (this._synth.paused && this._synth.resume) this._synth.resume();
        this._synth.speak(u);
      } catch {
        finish(false, 'error');
      }
    });
  }

  _loadVoices() {
    const handler = () => this._refresh();
    try {
      if (this._synth.addEventListener) this._synth.addEventListener('voiceschanged', handler);
      else this._synth.onvoiceschanged = handler;
    } catch {
      /* ignore */
    }
    if (this._refresh()) return Promise.resolve(true);
    return new Promise((resolve) => {
      let n = 0;
      const poll = setInterval(() => {
        if (this._refresh() || ++n > 12) {
          clearInterval(poll);
          resolve(this._voices.length > 0);
        }
      }, 250 * this._ts);
    });
  }

  _refresh() {
    let vs = [];
    try {
      vs = this._synth.getVoices() || [];
    } catch {
      vs = [];
    }
    const changed = vs.length !== this._voices.length || vs.some((v, i) => v !== this._voices[i]);
    if (changed) {
      this._voices = [...vs];
      this._pick();
      for (const cb of [...this._voiceListeners]) {
        try {
          cb(this.list());
        } catch {
          /* ignore */
        }
      }
    }
    return this._voices.length > 0;
  }

  _pick() {
    const vs = this._voices;
    let v = null;
    if (this._uri) v = vs.find((x) => x.voiceURI === this._uri) || vs.find((x) => x.name === this._uri) || null;
    if (!v) {
      let best = -Infinity;
      for (const x of vs) {
        const r = rateVoice(x);
        if (r.english && !r.novelty && r.score > best) {
          best = r.score;
          v = x;
        }
      }
    }
    this._voice = v;
  }

  _info(v) {
    const r = rateVoice(v);
    return { name: v.name, lang: v.lang, uri: v.voiceURI, quality: r.quality, local: !!v.localService };
  }

  _save() {
    try {
      if (this._storage) this._storage.setItem(STORE_KEY, JSON.stringify({ enabled: this._enabled, uri: this._uri, rate: this.rate, pitch: this.pitch }));
    } catch {
      /* private mode / quota: ignore */
    }
  }
}

function safeLocalStorage() {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}

// The app-wide coach voice.
export const voice = new Voice();
