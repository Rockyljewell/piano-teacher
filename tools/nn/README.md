# Training the listening model

A small causal neural network that transcribes piano audio in real time. It runs in the browser
as `js/audio/nn/nn-transcriber.js` (a drop-in replacement for the DSP `js/audio/transcriber.js`);
this folder trains it. Design, data, licences and results: [docs/listening-model.md](../../docs/listening-model.md).

Everything large lives in `tools/nn/.data/` and `tools/nn/.venv/` (both git-ignored). No audio or
dataset is ever committed; only the weights (`assets/models/piano-nn.bin`, ~25 KB) and the parity
fixture (`tools/nn/fixtures/parity.json`) are.

## Reproduce

Commands run from the repository root. Times are for this 4-core machine limited to 2 threads,
while another job used the other cores.

```sh
# 0. Python environment (CPU torch, ~195 MB)                                          ~2 min
python3 -m venv tools/nn/.venv
tools/nn/.venv/bin/pip install -r tools/nn/requirements.txt
export OMP_NUM_THREADS=2

# 1. Instruments and background recordings (licences checked, see the doc)   ~2.2 GB, ~15 min
#    -> .data/inst/<name>/{bank.npz,regions.json} (16 kHz), .data/noise/*.f32
tools/nn/.venv/bin/python tools/nn/fetch_data.py

# 2. The app's own music (40 levels, warm-ups, rhythm drills, 76 song arrangements) and the
#    room-noise simulations of tests/noise-sim.js                                        ~20 s
node tools/nn/dump_content.mjs

# 3. Render the clips (piano content -> sampler -> room): 30 h train, 1.7 h validation  ~25 min
cd tools/nn
../../tools/nn/.venv/bin/python make_data.py --hours 1.5 --split val --seed 999 --workers 2
../../tools/nn/.venv/bin/python make_data.py --hours 30 --split train --seed 1 --workers 2

# 4. Train (noise, microphone EQ, level and clipping are mixed in on the fly)          ~4-5 h
../../tools/nn/.venv/bin/python train.py --steps 2000 --batch 16 --frames 400 --out .data/runs/main

# 5. Export, then tune the decoder (thresholds, confidence calibration) on validation
#    mixtures of the TRAINING pianos, and export again with the decoder settings        ~10 min
../../tools/nn/.venv/bin/python export.py .data/runs/main/best.pt .data/main.bin
../../tools/nn/.venv/bin/python dump_val.py
node calibrate.mjs .data/main.bin --write .data/decoder.json
../../tools/nn/.venv/bin/python export.py .data/runs/main/best.pt ../../assets/models/piano-nn.bin .data/decoder.json
cd ../..

# 6. Check: JS inference = PyTorch (parity fixture), then the benchmark (the judge)
node --test tests/nn-*.test.js
TRANSCRIBER=js/audio/nn/nn-transcriber.js node tests/bench-listen.js
```

`NN_WEIGHTS=/path/to/file.bin` makes `nn-transcriber.js` load another weights file (Node only), so
a checkpoint can be benchmarked without replacing the shipped one:
`NN_WEIGHTS=tools/nn/.data/main.bin TRANSCRIBER=js/audio/nn/nn-transcriber.js QUICK=1 node tests/bench-listen.js`.

## Files

| file | what |
| --- | --- |
| `fetch_data.py` | downloads the instruments / noise, SoundFont 2 parser, builds 16 kHz sample banks |
| `dump_content.mjs` | the app's generator + song library as note lists; noise-sim clips |
| `content.py` | what is played: app pieces plus chords, octaves, both-hands chords, clusters, scales, arpeggios, trills, repeated notes, runs, pedal textures, note soup |
| `synth.py` | the sampler (velocity layers, pitch shift, loops, SF2 envelopes, dampers, pedal, sympathetic resonance) and the additive synth |
| `room.py` | synthetic room impulse responses, iPad-mic EQ curves |
| `make_data.py` | renders the clips into shards |
| `frontend.py` | the features (mirrored exactly by `js/audio/nn/frontend.js`) |
| `model.py` | the network (mirrored by `js/audio/nn/model.js`) |
| `train.py` | on-the-fly mixing (noise, EQ, level, clipping, metronome ticks), targets, loss, validation |
| `export.py` | batch-norm folding, float16 weights file, parity fixture |
| `dump_val.py`, `calibrate.mjs` | decoder thresholds and confidence calibration on validation mixtures |

The held-out benchmark pianos (Upright KW, YDP grand) are never read by anything here.
