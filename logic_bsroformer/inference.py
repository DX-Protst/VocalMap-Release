# coding: utf-8
__author__ = 'Roman Solovyev (ZFTurbo): https://github.com/ZFTurbo/'

import time
import librosa
import sys
import os
import glob
import sys
import json

# Using the embedded version of Python can also correctly import the utils module.
current_dir = os.path.dirname(os.path.abspath(__file__))
sys.path.append(current_dir)

# Windows embedded Python ignores PYTHONPATH. We MUST manually inject it.
if "PYTHONPATH" in os.environ:
    for p in os.environ["PYTHONPATH"].split(os.pathsep):
        if p and p not in sys.path:
            sys.path.insert(0, p)

import torch
import soundfile as sf
import numpy as np
from tqdm.auto import tqdm
import torch.nn as nn

# Using the embedded version of Python can also correctly import the utils module.
current_dir = os.path.dirname(os.path.abspath(__file__))
sys.path.append(current_dir)

from utils.audio_utils import normalize_audio, denormalize_audio, draw_spectrogram
from utils.settings import get_model_from_config, parse_args_inference
from utils.model_utils import demix
from utils.model_utils import prefer_target_instrument, apply_tta, load_start_checkpoint

import warnings

warnings.filterwarnings("ignore")


def emit_progress(progress=None, message=None, stage=None):
    payload = {}
    if progress is not None:
        payload["progress"] = max(0, min(100, int(round(progress))))
    if message:
        payload["message"] = message
    if stage:
        payload["stage"] = stage
    print("VMAP_PROGRESS " + json.dumps(payload, ensure_ascii=False), flush=True)


def run_folder(model, args, config, device, verbose: bool = False):
    """
    Process a folder of audio files for source separation.

    Parameters:
    ----------
    model : torch.nn.Module
        Pre-trained model for source separation.
    args : Namespace
        Arguments containing input folder, output folder, and processing options.
    config : Dict
        Configuration object with audio and inference settings.
    device : torch.device
        Device for model inference (CPU or CUDA).
    verbose : bool, optional
        If True, prints detailed information during processing. Default is False.
    """

    start_time = time.time()
    model.eval()

    mixture_paths = sorted(glob.glob(os.path.join(args.input_folder, '*.*')))
    sample_rate = getattr(config.audio, 'sample_rate', 44100)

    print(f"Total files found: {len(mixture_paths)}. Using sample rate: {sample_rate}", flush=True)
    emit_progress(None, f"Found {len(mixture_paths)} audio file(s). Preparing source separation.", "scan")

    instruments = prefer_target_instrument(config)[:]
    os.makedirs(args.store_dir, exist_ok=True)

    if not verbose:
        mixture_paths = tqdm(mixture_paths, desc="Total progress", disable=False)

    if args.disable_detailed_pbar:
        detailed_pbar = False
    else:
        detailed_pbar = True

    for path in mixture_paths:
        print(f"Processing track: {path}", flush=True)
        emit_progress(None, "Loading and resampling audio...", "load_audio")
        try:
            mix, sr = librosa.load(path, sr=sample_rate, mono=False, res_type='soxr_qq')
        except Exception as e:
            print(f'Cannot read track: {format(path)}', flush=True)
            print(f'Error message: {str(e)}', flush=True)
            continue

        # If mono audio we must adjust it depending on model
        if len(mix.shape) == 1:
            mix = np.expand_dims(mix, axis=0)
            if 'num_channels' in config.audio:
                if config.audio['num_channels'] == 2:
                    print(f'Convert mono track to stereo...', flush=True)
                    mix = np.concatenate([mix, mix], axis=0)

        mix_orig = mix.copy()
        if 'normalize' in config.inference:
            if config.inference['normalize'] is True:
                mix, norm_params = normalize_audio(mix)

        emit_progress(None, "Running neural separation on audio chunks...", "demix")

        def on_demix_progress(done, total):
            if total:
                percent = 35 + (float(done) / float(total)) * 55
                emit_progress(percent, f"Processing audio chunks {min(done, total)}/{total}", "demix")

        waveforms_orig = demix(
            config,
            model,
            mix,
            device,
            model_type=args.model_type,
            pbar=detailed_pbar,
            progress_callback=on_demix_progress,
        )

        if args.use_tta:
            emit_progress(90, "Applying test-time augmentation...", "tta")
            waveforms_orig = apply_tta(config, model, mix, waveforms_orig, device, args.model_type)

        if args.extract_instrumental:
            instr = 'vocals' if 'vocals' in instruments else instruments[0]
            
            if instr.lower() == 'instrumental':
                waveforms_orig['Vocals'] = mix_orig - waveforms_orig[instr]
                if 'Vocals' not in instruments:
                    instruments.append('Vocals')
            else:
                waveforms_orig['instrumental'] = mix_orig - waveforms_orig[instr]
                if 'instrumental' not in instruments:
                    instruments.append('instrumental')

        file_name = os.path.splitext(os.path.basename(path))[0]

        output_dir = os.path.join(args.store_dir, file_name)
        os.makedirs(output_dir, exist_ok=True)

        for instr in instruments:
            emit_progress(92, f"Writing {instr} stem...", "write")
            estimates = waveforms_orig[instr]
            if 'normalize' in config.inference:
                if config.inference['normalize'] is True:
                    estimates = denormalize_audio(estimates, norm_params)

            codec = 'flac' if getattr(args, 'flac_file', False) else 'wav'
            subtype = 'PCM_16' if args.flac_file and args.pcm_type == 'PCM_16' else 'FLOAT'

            output_path = os.path.join(output_dir, f"{instr}.{codec}")
            sf.write(output_path, estimates.T, sr, subtype=subtype)
            if args.draw_spectro > 0:
                output_img_path = os.path.join(output_dir, f"{instr}.jpg")
                draw_spectrogram(estimates.T, sr, args.draw_spectro, output_img_path)

    emit_progress(100, "Separation finished.", "done")
    print(f"Elapsed time: {time.time() - start_time:.2f} seconds.", flush=True)


def proc_folder(dict_args):
    print("[DEBUG] proc_folder started. Parsing args...", flush=True)
    emit_progress(None, "Parsing inference arguments...", "startup")
    args = parse_args_inference(dict_args)
    device = "cpu"
    print("[DEBUG] Checking CUDA availability...", flush=True)
    emit_progress(None, "Checking compute device...", "device")
    if args.force_cpu:
        device = "cpu"
    elif torch.cuda.is_available():
        print("[DEBUG] CUDA is available, use --force_cpu to disable it.", flush=True)
        device = f'cuda:{args.device_ids[0]}' if isinstance(args.device_ids, list) else f'cuda:{args.device_ids}'
    elif torch.backends.mps.is_available():
        device = "mps"

    print("Using device: ", device, flush=True)
    emit_progress(None, f"Using device: {device}", "device")

    model_load_start_time = time.time()
    torch.backends.cudnn.benchmark = True

    print("[DEBUG] Loading model from config...", flush=True)
    emit_progress(None, "Loading model architecture...", "model_config")
    model, config = get_model_from_config(args.model_type, args.config_path)

    if args.start_check_point != '':
        print(f"[DEBUG] Loading checkpoint from {args.start_check_point}...", flush=True)
        emit_progress(None, "Loading model checkpoint. This can take a while on large models...", "checkpoint")
        load_start_checkpoint(args, model, type_='inference')

    print("Instruments: {}".format(config.training.instruments), flush=True)

    # in case multiple CUDA GPUs are used and --device_ids arg is passed
    if isinstance(args.device_ids, list) and len(args.device_ids) > 1 and not args.force_cpu:
        print("[DEBUG] Applying DataParallel...", flush=True)
        emit_progress(None, "Configuring multi-GPU inference...", "device")
        model = nn.DataParallel(model, device_ids=args.device_ids)

    print("[DEBUG] Moving model to device...", flush=True)
    emit_progress(None, "Moving model to compute device...", "device")
    model = model.to(device)

    print("Model load time: {:.2f} sec".format(time.time() - model_load_start_time), flush=True)
    emit_progress(None, "Model is ready. Starting audio processing...", "ready")

    run_folder(model, args, config, device, verbose=True)


if __name__ == "__main__":
    proc_folder(None)
