Set-Location -Path "$PSScriptRoot\.."

# Build
$env:PATH += ";C:\Users\10431\.cargo\bin"
if (Test-Path "tauri_updater.key") {
    Write-Host "Found tauri_updater.key, setting TAURI_SIGNING_PRIVATE_KEY environment variable for updater signing."
    $env:TAURI_SIGNING_PRIVATE_KEY = (Get-Content "tauri_updater.key" -Raw).Trim()
    $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = ""
} else {
    Write-Host "WARNING: tauri_updater.key not found. Updater .sig and .zip files will NOT be generated!" -ForegroundColor Yellow
}
Write-Host "Compiling Python backend extensions for protection..." -ForegroundColor Cyan
.\python_runtime\python.exe -m pip install Cython setuptools

Write-Host "Compiling Numba AOT..."
Set-Location "backend\acoustic_engine"
..\..\python_runtime\python.exe build_numba.py
Set-Location "..\.."

Write-Host "Compiling Cython extensions..."
Set-Location "backend"
..\python_runtime\python.exe setup_cython.py build_ext --inplace
Set-Location ".."

Write-Host "Hiding .py files from packager..."
Rename-Item "backend\acoustic_engine\analyzer.py" "analyzer.py.bak" -ErrorAction SilentlyContinue
Rename-Item "backend\separation.py" "separation.py.bak" -ErrorAction SilentlyContinue

try {
    Write-Host "Running npx tauri build..."
    npx tauri build
}
finally {
    Write-Host "Restoring .py files and cleaning up dev environment..."
    Rename-Item "backend\acoustic_engine\analyzer.py.bak" "analyzer.py" -ErrorAction SilentlyContinue
    Rename-Item "backend\separation.py.bak" "separation.py" -ErrorAction SilentlyContinue

    Remove-Item "backend\acoustic_engine\*.c" -ErrorAction SilentlyContinue
    Remove-Item "backend\*.c" -ErrorAction SilentlyContinue
    Remove-Item "backend\build" -Recurse -Force -ErrorAction SilentlyContinue
    Remove-Item "backend\acoustic_engine\analyzer.*.pyd" -ErrorAction SilentlyContinue
    Remove-Item "backend\separation.*.pyd" -ErrorAction SilentlyContinue
}

Write-Host "Build finished!"
