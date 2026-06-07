"""
BS-RoFormer architecture matching the reference MSS-Training implementation.
Supports two model types:
  - BSRoformer: fixed freqs_per_bands tuple (used when config has freqs_per_bands)
  - MelBandRoformer: mel filter-bank based bands (used otherwise)

Key architectural details matching the reference:
  - RMSNorm: F.normalize(x, dim=-1) * sqrt(dim) * gamma  (no epsilon)
  - Gate activation: sigmoid (not softmax)
  - Mask format: simple complex mask (freq_count * 2 per band), not 2×2 matrix
  - MaskEstimator: MLP → GLU pattern
  - Transformer residual: at block level (x = attn(x) + x, x = ff(x) + x)
"""

import torch
import torch.nn as nn
import torch.nn.functional as F
from functools import partial
from typing import Tuple, Optional, Callable

import yaml
import math


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def exists(val):
    return val is not None


def default(v, d):
    return v if exists(v) else d


# ---------------------------------------------------------------------------
# Norm
# ---------------------------------------------------------------------------

class RMSNorm(nn.Module):
    """RMSNorm matching reference: F.normalize * sqrt(dim) * gamma (no eps)."""
    def __init__(self, dim):
        super().__init__()
        self.scale = dim ** 0.5
        self.gamma = nn.Parameter(torch.ones(dim))

    def forward(self, x):
        return F.normalize(x, dim=-1) * self.scale * self.gamma


# ---------------------------------------------------------------------------
# Rotary Embedding (simple implementation, matches rotary_embedding_torch API)
# ---------------------------------------------------------------------------

class RotaryEmbedding(nn.Module):
    def __init__(self, dim, theta=10000.0):
        super().__init__()
        inv_freq = 1.0 / (theta ** (torch.arange(0, dim, 2).float() / dim))
        self.register_buffer("inv_freq", inv_freq, persistent=False)

    def forward(self, max_seq_len, offset=0):
        seq = torch.arange(max_seq_len, device=self.inv_freq.device, dtype=self.inv_freq.dtype)
        seq = seq + offset
        freqs = torch.outer(seq, self.inv_freq)
        return torch.cat((freqs, freqs), dim=-1)

    def rotate_queries_or_keys(self, x):
        """Apply rotary embeddings to queries or keys. x: [B, H, N, D]"""
        seq_len = x.shape[-2]
        freqs = self.forward(seq_len, offset=0).to(x.device)
        # freqs: [seq_len, dim_head]
        # We need: cos, sin for [seq_len, dim_head/2]
        cos = freqs[:seq_len, :x.shape[-1] // 2].cos()
        sin = freqs[:seq_len, :x.shape[-1] // 2].sin()
        # Expand to [1, 1, seq_len, dim_head/2]
        cos = cos[None, None, :, :]
        sin = sin[None, None, :, :]
        x1, x2 = x[..., :x.shape[-1] // 2], x[..., x.shape[-1] // 2:]
        r1 = x1 * cos - x2 * sin
        r2 = x1 * sin + x2 * cos
        return torch.cat([r1, r2], dim=-1)


# ---------------------------------------------------------------------------
# FeedForward
# ---------------------------------------------------------------------------

class FeedForward(nn.Module):
    def __init__(self, dim, mult=4, dropout=0.0):
        super().__init__()
        dim_inner = int(dim * mult)
        self.net = nn.Sequential(
            RMSNorm(dim),
            nn.Linear(dim, dim_inner, bias=True),
            nn.GELU(),
            nn.Dropout(dropout),
            nn.Linear(dim_inner, dim, bias=True),
            nn.Dropout(dropout),
        )

    def forward(self, x):
        return self.net(x)


# ---------------------------------------------------------------------------
# Attention (sigmoid gate, flash-attn via SDPA)
# ---------------------------------------------------------------------------

class Attention(nn.Module):
    def __init__(
        self,
        dim,
        heads=8,
        dim_head=64,
        dropout=0.0,
        rotary_embed=None,
        flash=True,
        shared_qkv_bias=None,
        shared_out_bias=None,
    ):
        super().__init__()
        self.heads = heads
        self.scale = dim_head ** -0.5
        dim_inner = heads * dim_head

        self.rotary_embed = rotary_embed
        self.norm = RMSNorm(dim)

        # QKV: use shared bias when provided (matches reference use_shared_bias)
        self.to_qkv = nn.Linear(dim, dim_inner * 3, bias=(shared_qkv_bias is not None))
        if shared_qkv_bias is not None:
            self.to_qkv.bias = shared_qkv_bias
        self.to_gates = nn.Linear(dim, heads)
        self.to_out = nn.Sequential(
            nn.Linear(dim_inner, dim, bias=(shared_out_bias is not None)),
            nn.Dropout(dropout),
        )
        if shared_out_bias is not None:
            self.to_out[0].bias = shared_out_bias

        self.dropout_p = dropout
        self.flash = flash

    def forward(self, x):
        # x: [B, N, D]
        x_norm = self.norm(x)

        qkv = self.to_qkv(x_norm)  # [B, N, inner*3]
        q, k, v = qkv.chunk(3, dim=-1)
        # Reshape: [B, N, H, D_h] → [B, H, N, D_h]
        B, N, _ = x.shape
        q = q.view(B, N, self.heads, -1).permute(0, 2, 1, 3)
        k = k.view(B, N, self.heads, -1).permute(0, 2, 1, 3)
        v = v.view(B, N, self.heads, -1).permute(0, 2, 1, 3)

        if exists(self.rotary_embed):
            q = self.rotary_embed.rotate_queries_or_keys(q)
            k = self.rotary_embed.rotate_queries_or_keys(k)

        # SDPA (flash attention when available AND enabled)
        if self.flash:
            out = F.scaled_dot_product_attention(
                q, k, v,
                dropout_p=self.dropout_p if self.training else 0.0,
                is_causal=False,
            )
        else:
            attn = (q @ k.transpose(-2, -1)) * self.scale
            attn = attn.softmax(dim=-1)
            if self.training and self.dropout_p > 0:
                attn = F.dropout(attn, p=self.dropout_p)
            out = attn @ v

        # Gate: sigmoid (reference uses sigmoid, not softmax)
        gates = self.to_gates(x_norm).sigmoid()  # [B, N, H]
        # Reshape gates to [B, H, N, 1] for broadcasting with out [B, H, N, Dh]
        out = out * gates.transpose(1, 2).unsqueeze(-1)

        out = out.permute(0, 2, 1, 3).reshape(B, N, -1)
        return self.to_out(out)


# ---------------------------------------------------------------------------
# Transformer Block (depth Attention+FF pairs, residual at block level)
# ---------------------------------------------------------------------------

class Transformer(nn.Module):
    def __init__(
        self,
        *,
        dim,
        depth,
        dim_head=64,
        heads=8,
        attn_dropout=0.0,
        ff_dropout=0.0,
        ff_mult=4,
        norm_output=True,
        rotary_embed=None,
        flash_attn=True,
        shared_qkv_bias=None,
        shared_out_bias=None,
    ):
        super().__init__()
        self.layers = nn.ModuleList()
        for _ in range(depth):
            self.layers.append(nn.ModuleList([
                Attention(
                    dim=dim, heads=heads, dim_head=dim_head,
                    dropout=attn_dropout, rotary_embed=rotary_embed,
                    flash=flash_attn,
                    shared_qkv_bias=shared_qkv_bias,
                    shared_out_bias=shared_out_bias,
                ),
                FeedForward(dim=dim, mult=ff_mult, dropout=ff_dropout),
            ]))

        self.norm = RMSNorm(dim) if norm_output else nn.Identity()

    def forward(self, x):
        for attn, ff in self.layers:
            x = attn(x) + x
            x = ff(x) + x
        return self.norm(x)


# ---------------------------------------------------------------------------
# BandSplit
# ---------------------------------------------------------------------------

class BandSplit(nn.Module):
    """Split flat frequency vector into bands by predetermined sizes."""
    def __init__(self, dim, dim_inputs: Tuple[int, ...]):
        super().__init__()
        self.dim_inputs = dim_inputs
        self.to_features = nn.ModuleList()
        for dim_in in dim_inputs:
            self.to_features.append(nn.Sequential(
                RMSNorm(dim_in),
                nn.Linear(dim_in, dim, bias=True),
            ))

    def forward(self, x):
        # x: [B, T, F_total]
        splits = x.split(list(self.dim_inputs), dim=-1)
        outs = []
        for split_input, to_feature in zip(splits, self.to_features):
            outs.append(to_feature(split_input))
        return torch.stack(outs, dim=-2)  # [B, T, num_bands, dim]


# ---------------------------------------------------------------------------
# MLP helper for MaskEstimator
# ---------------------------------------------------------------------------

# MLP helper for MaskEstimator
# ---------------------------------------------------------------------------

def MLP(dim_in, dim_out, dim_hidden=None, depth=1, activation=nn.Tanh):
    dim_hidden = default(dim_hidden, dim_in)
    net = []
    dims = (dim_in, *((dim_hidden,) * (depth - 1)), dim_out)
    for ind, (layer_dim_in, layer_dim_out) in enumerate(zip(dims[:-1], dims[1:])):
        is_last = ind == (len(dims) - 2)
        net.append(nn.Linear(layer_dim_in, layer_dim_out))
        if is_last:
            continue
        net.append(activation())
    return nn.Sequential(*net)




# ---------------------------------------------------------------------------
# MaskEstimator: MLP → GLU per band, outputs complex mask (dim_in * 2)
# ---------------------------------------------------------------------------

class MaskEstimator(nn.Module):
    def __init__(self, dim, dim_inputs: Tuple[int, ...], depth, mlp_expansion_factor=4):
        super().__init__()
        self.dim_inputs = dim_inputs
        self.to_freqs = nn.ModuleList()
        dim_hidden = dim * mlp_expansion_factor
        for dim_in in dim_inputs:
            mlp = nn.Sequential(
                MLP(dim, dim_in * 2, dim_hidden=dim_hidden, depth=depth),
                nn.GLU(dim=-1),
            )
            self.to_freqs.append(mlp)

    def forward(self, x):
        # x: [B, T, num_bands, dim]
        x = x.unbind(dim=-2)  # list of [B, T, dim]
        outs = []
        for band_features, mlp in zip(x, self.to_freqs):
            freq_out = mlp(band_features)
            outs.append(freq_out)
        return torch.cat(outs, dim=-1)  # [B, T, F_total * 2]

# ---------------------------------------------------------------------------
# BSRoformer: fixed freqs_per_bands
# ---------------------------------------------------------------------------

DEFAULT_FREQS_PER_BANDS = (
    2, 2, 2, 2, 2, 2, 2, 2, 2, 2,
    2, 2, 2, 2, 2, 2, 2, 2, 2, 2,
    2, 2, 2, 2,
    4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4,
    12, 12, 12, 12, 12, 12, 12, 12,
    24, 24, 24, 24, 24, 24, 24, 24,
    48, 48, 48, 48, 48, 48, 48, 48,
    128, 129,
)


class BSRoformer(nn.Module):
    """BS-RoFormer with fixed frequency band split."""

    def __init__(
        self,
        dim,
        *,
        depth,
        stereo=False,
        num_stems=1,
        time_transformer_depth=2,
        freq_transformer_depth=2,
        linear_transformer_depth=0,
        freqs_per_bands: Tuple[int, ...] = DEFAULT_FREQS_PER_BANDS,
        dim_head=64,
        heads=8,
        attn_dropout=0.0,
        ff_dropout=0.0,
        flash_attn=True,
        dim_freqs_in=1025,
        stft_n_fft=2048,
        stft_hop_length=512,
        stft_win_length=2048,
        stft_normalized=False,
        stft_window_fn: Optional[Callable] = None,
        mask_estimator_depth=2,
        mlp_expansion_factor=4,
        sample_rate=44100,
        use_shared_bias=False,
        **kwargs,
    ):
        super().__init__()
        self.stereo = stereo
        self.audio_channels = 2 if stereo else 1
        self.num_stems = num_stems
        self.sample_rate = sample_rate
        self.n_fft = stft_n_fft
        self.hop_length = stft_hop_length
        self.win_length = stft_win_length
        self.normalized = stft_normalized

        self.stft_window_fn = partial(default(stft_window_fn, torch.hann_window), stft_win_length)

        self.layers = nn.ModuleList()

        # Shared bias (matches reference: use_shared_bias)
        if use_shared_bias:
            dim_inner = heads * dim_head
            self.linear_62_bias_0 = nn.Parameter(torch.ones(dim_inner * 3))
            self.linear_64_bias_0 = nn.Parameter(torch.ones(dim))
            _shared_qkv = self.linear_62_bias_0
            _shared_out = self.linear_64_bias_0
        else:
            _shared_qkv = None
            _shared_out = None

        transformer_kwargs = dict(
            dim=dim,
            heads=heads,
            dim_head=dim_head,
            attn_dropout=attn_dropout,
            ff_dropout=ff_dropout,
            flash_attn=flash_attn,
            norm_output=False,
            shared_qkv_bias=_shared_qkv,
            shared_out_bias=_shared_out,
        )

        time_rotary_embed = RotaryEmbedding(dim=dim_head)
        freq_rotary_embed = RotaryEmbedding(dim=dim_head)

        for _ in range(depth):
            tran_modules = []
            if linear_transformer_depth > 0:
                # Linear attention not implemented here (rarely used)
                raise NotImplementedError("linear_transformer_depth > 0 not supported")
            tran_modules.append(
                Transformer(depth=time_transformer_depth, rotary_embed=time_rotary_embed, **transformer_kwargs)
            )
            tran_modules.append(
                Transformer(depth=freq_transformer_depth, rotary_embed=freq_rotary_embed, **transformer_kwargs)
            )
            self.layers.append(nn.ModuleList(tran_modules))

        self.final_norm = RMSNorm(dim)

        # Band split: input size = 2 * freq_count * audio_channels (complex × stereo)
        freqs_per_bands_with_complex = tuple(2 * f * self.audio_channels for f in freqs_per_bands)
        self.band_split = BandSplit(dim=dim, dim_inputs=freqs_per_bands_with_complex)

        # Mask estimators: one per stem, output = dim_in * 2 → GLU halves → dim_in (complex)
        self.mask_estimators = nn.ModuleList()
        for _ in range(num_stems):
            self.mask_estimators.append(MaskEstimator(
                dim=dim,
                dim_inputs=freqs_per_bands_with_complex,
                depth=mask_estimator_depth,
                mlp_expansion_factor=mlp_expansion_factor,
            ))

    def forward(self, raw_audio):
        """
        Args:
            raw_audio: [B, C, T] stereo audio (C=2)
        Returns:
            If num_stems > 1: [B, num_stems, C, T]
            If num_stems == 1: [B, C, T]
        """
        device = raw_audio.device

        if raw_audio.ndim == 2:
            raw_audio = raw_audio.unsqueeze(1)  # [B, T] → [B, 1, T]

        B, channels, audio_len = raw_audio.shape
        assert channels == self.audio_channels, \
            f"Expected {self.audio_channels} channels, got {channels}"

        # --- STFT ---
        # Flatten batch+channel for STFT: [B*C, T]
        x_flat = raw_audio.reshape(B * channels, audio_len)
        stft_window = self.stft_window_fn(device=device)

        stft_repr = torch.stft(
            x_flat,
            n_fft=self.n_fft,
            hop_length=self.hop_length,
            win_length=self.win_length,
            window=stft_window,
            normalized=self.normalized,
            return_complex=True,
        )
        stft_repr = torch.view_as_real(stft_repr)  # [B*C, F, T_s, 2]
        _, F, T_s, _ = stft_repr.shape
        stft_repr = stft_repr.view(B, channels, F, T_s, 2)  # [B, C, F, T, 2]

        # Merge stereo into frequency dimension: [B, F*C, T, 2] → [B, T, F*C*2]
        stft_repr = stft_repr.permute(0, 2, 1, 3, 4).reshape(B, F * channels, T_s, 2)
        stft_for_mask = stft_repr.clone()  # save for mask multiplication
        x = stft_repr.permute(0, 2, 1, 3).reshape(B, T_s, F * channels * 2)

        # --- BandSplit → [B, T, num_bands, dim] ---
        x = self.band_split(x)

        # --- Axial transformers ---
        num_bands = x.shape[2]  # number of frequency bands
        dim = x.shape[-1]       # feature dimension (256)
        for block in self.layers:
            time_transformer, freq_transformer = block

            # Time transformer: [B, T, num_bands, dim] → [B*num_bands, T, dim]
            x = x.permute(0, 2, 1, 3).reshape(B * num_bands, T_s, dim)
            x = time_transformer(x)
            x = x.view(B, num_bands, T_s, dim).permute(0, 2, 1, 3)  # [B, T, num_bands, dim]

            # Freq transformer: [B, T, num_bands, dim] → [B*T, num_bands, dim]
            x = x.reshape(B * T_s, num_bands, dim)
            x = freq_transformer(x)
            x = x.view(B, T_s, num_bands, dim)  # [B, T, num_bands, dim]

        # --- Final norm ---
        x = x.reshape(B * T_s * num_bands, dim)
        x = self.final_norm(x)
        x = x.view(B, T_s, num_bands, dim)  # [B, T, num_bands, dim]

        # --- Mask estimation per stem ---
        masks = torch.stack([me(x) for me in self.mask_estimators], dim=1)  # [B, N, T, F_total*2]
        masks = masks.reshape(B, self.num_stems, T_s, F * channels, 2)  # [B, N, T, F*C, 2]
        masks = masks.permute(0, 1, 3, 2, 4)  # [B, N, F*C, T, 2]

        # --- Apply mask to STFT ---
        # stft_for_mask: [B, F*C, T, 2]
        stft_repr = stft_for_mask.unsqueeze(1)  # [B, 1, F*C, T, 2]
        stft_repr = torch.view_as_complex(stft_repr)
        masks = torch.view_as_complex(masks)

        stft_repr = stft_repr * masks  # [B, N, F*C, T] complex

        # --- ISTFT ---
        # Reshape to [B*N*C, F, T] for batch ISTFT
        stft_repr = stft_repr.reshape(B * self.num_stems, F * channels, T_s)
        stft_repr = stft_repr.reshape(B * self.num_stems * channels, F, T_s)

        recon_audio = torch.istft(
            stft_repr,
            n_fft=self.n_fft,
            hop_length=self.hop_length,
            win_length=self.win_length,
            window=stft_window,
            normalized=self.normalized,
            length=audio_len,
            return_complex=False,
        )

        recon_audio = recon_audio.view(B, self.num_stems, channels, -1)

        if self.num_stems == 1:
            recon_audio = recon_audio.squeeze(1)  # [B, C, T]

        return recon_audio


# ---------------------------------------------------------------------------
# Model building from YAML config
# ---------------------------------------------------------------------------

def build_model_from_yaml(yaml_path: str) -> BSRoformer:
    """Build a BSRoformer model from a YAML config file."""
    with open(yaml_path, 'r') as f:
        cfg = yaml.full_load(f)

    model_cfg = cfg.get('model', {})
    audio_cfg = cfg.get('audio', {})

    freqs_per_bands = model_cfg.get('freqs_per_bands')
    if freqs_per_bands is not None:
        freqs_per_bands = tuple(freqs_per_bands)

    return BSRoformer(
        dim=model_cfg.get('dim', 256),
        depth=model_cfg.get('depth', 12),
        num_stems=model_cfg.get('num_stems', 6),
        heads=model_cfg.get('heads', 8),
        dim_head=model_cfg.get('dim_head', 64),
        attn_dropout=model_cfg.get('attn_dropout', 0.0),
        ff_dropout=model_cfg.get('ff_dropout', 0.0),
        ff_mult=model_cfg.get('mlp_expansion_factor', 4),
        flash_attn=model_cfg.get('flash_attn', False),
        freqs_per_bands=freqs_per_bands,
        stereo=model_cfg.get('stereo', True),
        stft_n_fft=model_cfg.get('stft_n_fft', 2048),
        stft_hop_length=model_cfg.get('stft_hop_length', 512),
        stft_win_length=model_cfg.get('stft_win_length', 2048),
        stft_normalized=model_cfg.get('stft_normalized', False),
        mask_estimator_depth=model_cfg.get('mask_estimator_depth', 2),
        mlp_expansion_factor=model_cfg.get('mlp_expansion_factor', 4),
        sample_rate=audio_cfg.get('sample_rate', 44100),
        time_transformer_depth=model_cfg.get('time_transformer_depth', 1),
        freq_transformer_depth=model_cfg.get('freq_transformer_depth', 1),
        linear_transformer_depth=model_cfg.get('linear_transformer_depth', 0),
        use_shared_bias=model_cfg.get('use_shared_bias', False),
    )


def load_bs_roformer_model(ckpt_path: str, yaml_path: str,
                           device: torch.device = None) -> BSRoformer:
    """
    Load a BS-RoFormer model from FP32 checkpoint and YAML config.
    Uses strict=False — some checkpoints omit bias terms or include
    shared-bias params not present in all configs.
    """
    state_dict = torch.load(ckpt_path, map_location='cpu', weights_only=False)

    # Handle PyTorch Lightning wrapper
    if isinstance(state_dict, dict) and 'state_dict' in state_dict:
        state_dict = state_dict['state_dict']

    model = build_model_from_yaml(yaml_path)

    missing, unexpected = model.load_state_dict(state_dict, strict=False)

    # Zero out missing bias params
    for name in missing:
        if name.endswith('.bias'):
            param = dict(model.named_parameters())[name]
            param.data.zero_()

    if missing:
        bias_missing = [k for k in missing if k.endswith('.bias')]
        other_missing = [k for k in missing if not k.endswith('.bias')]
        if other_missing:
            print(f"[Model] Non-bias missing keys ({len(other_missing)}): {other_missing[:5]}...")
        if bias_missing:
            print(f"[Model] Bias keys zeroed ({len(bias_missing)}) — not present in checkpoint")
    if unexpected:
        real_unexpected = [k for k in unexpected if 'rotary_embed' not in k.lower()]
        if real_unexpected:
            print(f"[Model] Unexpected keys ({len(real_unexpected)}): {real_unexpected[:5]}...")

    if device is not None:
        model = model.to(device)
    model.eval()
    return model