"""The model's input features (must match js/audio/nn/frontend.js exactly).

16 kHz mono, one frame every 10 ms (160 samples). Frame t sees the audio up to sample
160 * (t + 1) (causal: the window ENDS there). Two periodic-Hann STFTs:
  long  2048 samples (128 ms): resolves low notes;
  short  512 samples  (32 ms): sharp attacks.
Each magnitude spectrum (scaled so a sinusoid of amplitude A peaks at ~A) is mapped to 296
log-frequency bins, 3 per semitone, centred on MIDI 20, 20 1/3, ... 118 1/3 (26 Hz .. 7.5 kHz):
triangular weights 1/3 semitone wide where the FFT is fine enough, linear interpolation of the
magnitude where it is not. Compression: ln(1 + mag / 3e-5).
"""
import numpy as np

SR = 16000
HOP = 160
WINS = (2048, 512)
NB = 296
MIDI0 = 20.0
BPS = 3
EPS = 3e-5


def bin_midi(k):
    return MIDI0 + k / BPS


def filterbank(W):
    """Dense [W/2+1, NB] matrix (float32)."""
    nf = W // 2 + 1
    fj = np.arange(nf) * SR / W
    M = np.zeros((nf, NB), dtype=np.float64)
    for k in range(NB):
        fk = 440.0 * 2 ** ((bin_midi(k) - 69) / 12)
        with np.errstate(divide='ignore'):
            d = np.abs(12 * np.log2(np.maximum(fj, 1e-9) / fk)) * BPS
        w = np.maximum(0.0, 1.0 - d)
        w[0] = 0.0
        if w.sum() >= 1.0:
            M[:, k] = w / w.sum()
        else:
            p = fk / (SR / W)
            j0 = int(np.floor(p))
            M[j0, k] += 1 - (p - j0)
            if j0 + 1 < nf:
                M[j0 + 1, k] += p - j0
    return M.astype(np.float32)


def hann(W):
    return (0.5 - 0.5 * np.cos(2 * np.pi * np.arange(W) / W)).astype(np.float32)


def features_np(x):
    """Reference implementation, frame by frame: [T, 2, NB] float32."""
    x = np.asarray(x, dtype=np.float32)
    T = len(x) // HOP
    out = np.zeros((T, len(WINS), NB), dtype=np.float32)
    for wi, W in enumerate(WINS):
        M = filterbank(W)
        w = hann(W)
        xp = np.concatenate([np.zeros(W - HOP, dtype=np.float32), x])
        for t in range(T):
            fr = xp[t * HOP: t * HOP + W] * w
            mag = np.abs(np.fft.rfft(fr)) * (4.0 / W)
            out[t, wi] = np.log1p((mag @ M) / EPS)
    return out


class TorchFrontend:
    """Batch version for training: audio [B, N] -> features [B, 2, T, NB]."""

    def __init__(self, device='cpu'):
        import torch
        self.torch = torch
        self.M = [torch.from_numpy(filterbank(W)) for W in WINS]
        self.w = [torch.from_numpy(hann(W)) for W in WINS]

    def __call__(self, x):
        torch = self.torch
        B, N = x.shape
        T = N // HOP
        outs = []
        for W, M, w in zip(WINS, self.M, self.w):
            xp = torch.nn.functional.pad(x[:, : T * HOP], (W - HOP, 0))
            S = torch.stft(xp, n_fft=W, hop_length=HOP, win_length=W, window=w, center=False, return_complex=True)
            mag = S.abs().transpose(1, 2)[:, :T] * (4.0 / W)  # [B, T, F]
            outs.append(torch.log1p((mag @ M) / EPS))
        return torch.stack(outs, dim=1)
