"""The listening model: small, causal, frequency-equivariant (weights shared across keys, plus a
per-key bias), streaming-friendly. js/audio/nn/model.js runs the same network frame by frame.

  features [B, 2, T, 296] (long + short window, log-frequency, 3 bins/semitone)
  -> normalise (fixed per-window mean/std)
  -> harmonic stack: for the 3 bins around every key (264 positions), the spectrum at the
     harmonics h in {1/3, 1/2, 1, 3/2, 2, 5/2, 3, 4, 5, 6, 7, 8} of that position
     (the 1/3, 1/2, 3/2 and 5/2 "sub-harmonics" show whether a lower note explains the energy:
     octaves and twelfths)                                          -> 24 channels x 264
  -> A: 1x1 conv 24->C1, BN, ReLU                                    (per position)
  -> B: depthwise conv, 3 frames x 3 bins, causal, residual, BN, ReLU
  -> keys: the 3 positions of each key x C1 -> 1x1 conv -> C2, BN, ReLU, + per-key bias
  -> blocks (at 88 keys, C2 channels, all residual):
       't',d : depthwise causal conv over time (kernel 3, dilation d) + 1x1 conv, BN, ReLU
       'x'   : depthwise conv across keys at offsets (octaves, twelfths, neighbours) + 1x1
               conv, plus a global context vector (mean / max over keys), BN, ReLU
  -> heads (1x1): onset (an attack within the last K frames), frame (sounding),
     age (which of the last K frames the attack was in)
Receptive field: 2 + 2 * (sum of dilations) frames; no look-ahead at all (the onset head's
"within the last K frames" target is how the model gets up to K-1 frames to decide).
"""
import torch
import torch.nn as nn
import torch.nn.functional as F

from frontend import NB, BPS

HARM = [1 / 3, 1 / 2, 1, 3 / 2, 2, 5 / 2, 3, 4, 5, 6, 7, 8]
# the bass is identified by its high partials (its fundamentals are weak and the 128 ms window
# cannot separate them): the extended stack adds partials 10, 12, 14 and 16
HARM_EXT = HARM + [10, 12, 14, 16]


def shifts_of(harm):
    return [int(round(12 * BPS * __import__('math').log2(h))) for h in harm]


SHIFTS = shifts_of(HARM)
NKEY = 88
POS0 = 2  # first position: bin of key 21 (3 * (21 - 20)) minus one
NPOS = NKEY * 3
XOFF = [-24, -19, -12, -2, -1, 1, 2, 12, 19, 24, 28]
K_ONSET = 4


class Model(nn.Module):
    def __init__(self, c1=16, c2=24, blocks=('t1', 'x', 't2', 't4', 'x', 't8'), k_onset=K_ONSET, diff=3, wins=(2048, 512), k_bass=None, harm=None):
        super().__init__()
        # wins: the STFT windows, longest first; the short-window rise uses the last one.
        # k_bass: onset window (frames) for keys below C3, which need longer to resolve
        harm = list(harm or HARM)
        self.harm = harm
        self.shifts = shifts_of(harm)
        self.cfg = dict(c1=c1, c2=c2, blocks=list(blocks), k_onset=k_onset, diff=diff, wins=list(wins), k_bass=k_bass, harm=harm)
        self.diff = diff
        self.nspec = len(wins)
        self.register_buffer('mu', torch.zeros(self.nspec))
        self.register_buffer('sd', torch.ones(self.nspec))
        idx = torch.tensor([[POS0 + p + s for p in range(NPOS)] for s in self.shifts])  # [H, P]
        self.register_buffer('hidx', idx)
        cin = (self.nspec + (1 if diff else 0)) * len(harm)
        self.a = nn.Conv2d(cin, c1, 1)
        self.a_bn = nn.BatchNorm2d(c1)
        self.b = nn.Conv2d(c1, c1, (3, 3), groups=c1, bias=False)
        self.b_bn = nn.BatchNorm2d(c1)
        self.k = nn.Conv2d(c1 * 3, c2, 1)
        self.k_bn = nn.BatchNorm2d(c2)
        self.kemb = nn.Parameter(torch.zeros(1, c2, 1, NKEY))
        self.blocks = nn.ModuleList()
        for b in blocks:
            m = nn.Module()
            if b[0] == 't':
                m.kind, m.d = 't', int(b[1:])
                m.dw = nn.Conv2d(c2, c2, (3, 1), dilation=(m.d, 1), groups=c2, bias=False)
            else:
                m.kind, m.d = 'x', 0
                m.dw = nn.Parameter(torch.zeros(c2, len(XOFF) + 1).normal_(0, 0.3))
                m.g = nn.Linear(2 * c2, c2)
            m.pw = nn.Conv2d(c2, c2, 1)
            m.bn = nn.BatchNorm2d(c2)
            self.blocks.append(m)
        self.head = nn.Conv2d(c2, 2 + max(k_onset, k_bass or 0), 1)
        with torch.no_grad():  # start at the priors: ~0.3 % onset frames, ~7 % sounding frames
            self.head.bias[0] = -5.0
            self.head.bias[1] = -2.5
        # shift matrices for the cross-key blocks: (x @ shift[j])[k] = x[k + offset_j]
        sh = torch.zeros(len(XOFF) + 1, NKEY, NKEY)
        for j, o in enumerate([0] + XOFF):
            for k in range(NKEY):
                if 0 <= k + o < NKEY:
                    sh[j, k + o, k] = 1
        self.register_buffer('xshift', sh)

    def rf(self):
        return 2 + sum(2 * m.d for m in self.blocks if m.kind == 't')

    def stack(self, x):
        """[B, 2, T, NB] normalised -> [B, 2*H, T, NPOS]"""
        B, C, T, _ = x.shape
        pad = 60  # C: spectra (, short rise)
        xp = F.pad(x, (pad, 300))
        g = xp[:, :, :, (self.hidx + pad).reshape(-1)]  # [B, 2, T, H*P]
        # zero where the harmonic falls outside the spectrum
        valid = ((self.hidx >= 0) & (self.hidx < NB)).reshape(-1).to(x.dtype)
        g = g * valid
        H = len(self.shifts)
        return g.reshape(B, C, T, H, NPOS).permute(0, 1, 3, 2, 4).reshape(B, C * H, T, NPOS)

    def forward(self, feats):
        x = (feats - self.mu.view(1, -1, 1, 1)) / self.sd.view(1, -1, 1, 1)
        if self.diff:
            # short-window rise over the last `diff` frames: attacks, directly at every partial
            s = x[:, -1:]
            d = s - F.pad(s, (0, 0, self.diff, 0))[:, :, : s.shape[2]]
            x = torch.cat([x, d], dim=1)
        x = self.stack(x)
        x = F.relu(self.a_bn(self.a(x)))
        y = self.b(F.pad(x, (1, 1, 2, 0)))
        x = F.relu(self.b_bn(x + y))
        B, C1, T, P = x.shape
        x = x.reshape(B, C1, T, NKEY, 3).permute(0, 1, 4, 2, 3).reshape(B, C1 * 3, T, NKEY)
        x = F.relu(self.k_bn(self.k(x)) + self.kemb)
        for m in self.blocks:
            if m.kind == 't':
                y = m.dw(F.pad(x, (0, 0, 2 * m.d, 0)))
            else:
                # depthwise across keys at the offsets 0, XOFF: one banded key x key matrix per
                # channel (a batched matmul is much faster to train than a sparse conv)
                B_, C_, T_, K_ = x.shape
                M = torch.einsum('cj,jik->cik', m.dw, self.xshift)
                y = torch.bmm(x.permute(1, 0, 2, 3).reshape(C_, B_ * T_, K_), M).reshape(C_, B_, T_, K_).permute(1, 0, 2, 3)
            y = m.pw(y)
            if m.kind == 'x':
                gctx = torch.cat([x.mean(dim=3), x.amax(dim=3)], dim=1).transpose(1, 2)  # [B, T, 2C]
                y = y + m.g(gctx).transpose(1, 2).unsqueeze(-1)
            x = F.relu(m.bn(x + y))
        return self.head(x)  # [B, 2+K, T, 88]


def macs(model):
    c = model.cfg
    c1, c2 = c['c1'], c['c2']
    n = (len(c.get('wins', (2048, 512))) + (1 if c.get('diff') else 0)) * len(c.get('harm') or HARM) * c1 * NPOS + 9 * c1 * NPOS + 3 * c1 * c2 * NKEY
    for m in model.blocks:
        n += (3 * c2 if m.kind == 't' else (len(XOFF) + 1) * c2 + 2 * c2 * c2 / NKEY) * NKEY + c2 * c2 * NKEY
    n += c2 * (2 + max(c['k_onset'], c.get('k_bass') or 0)) * NKEY
    return int(n)
