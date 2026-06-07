from numba.pycc import CC
import numpy as np

cc = CC('compiled_numba')
cc.verbose = True

@cc.export('_numba_mpm_core', 'f8[:](f8[:], i8)')
def _numba_mpm_core(audio_data, W):
    nsdf = np.zeros(W, dtype=np.float64)
    for tau in range(W):
        acf = 0.0
        m = 0.0
        for i in range(W):
            acf += audio_data[i] * audio_data[i + tau]
            m += audio_data[i]**2 + audio_data[i + tau]**2
        if m == 0:
            nsdf[tau] = 0.0
        else:
            nsdf[tau] = 2.0 * acf / m
    return nsdf

if __name__ == "__main__":
    cc.compile()
