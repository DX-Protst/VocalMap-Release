$ErrorActionPreference = "Stop"
Set-Location -Path "$PSScriptRoot\.."
$pythonUrl = "https://www.python.org/ftp/python/3.10.11/python-3.10.11-embed-amd64.zip"
$pipUrl = "https://bootstrap.pypa.io/get-pip.py"
$runtimeDir = "python_runtime"
$zipPath = "python-embed.zip"
$getPipPath = "get-pip.py"

Write-Host "1. Downloading Python Embeddable..."
if (-not (Test-Path $zipPath)) {
    Invoke-WebRequest -Uri $pythonUrl -OutFile $zipPath
}

if (Test-Path $runtimeDir) {
    Write-Host "Removing old python_runtime..."
    Remove-Item -Path $runtimeDir -Recurse -Force
}

Write-Host "2. Extracting Python..."
Expand-Archive -Path $zipPath -DestinationPath $runtimeDir -Force

Write-Host "3. Enabling site-packages (_pth file)..."
$pthFile = Join-Path $runtimeDir "python310._pth"
$content = Get-Content $pthFile
$content = $content -replace "#import site", "import site"
Set-Content -Path $pthFile -Value $content

Write-Host "4. Downloading get-pip.py..."
if (-not (Test-Path $getPipPath)) {
    Invoke-WebRequest -Uri $pipUrl -OutFile $getPipPath
}

Write-Host "5. Installing pip..."
$pythonExe = Join-Path $runtimeDir "python.exe"
& $pythonExe $getPipPath

Write-Host "6. Installing backend dependencies..."
# Do not install torch here! It will be downloaded at runtime.
$deps = @(
    "numpy>=1.24", "scipy>=1.10", "librosa>=0.10", "soundfile>=0.12",
    "fastapi==0.104.1", "uvicorn==0.24.0", "websockets==12.0", "python-multipart>=0.0.5", "pyyaml>=6.0",
    "tqdm", "matplotlib", "omegaconf", "ml_collections", "loralib",
    "einops", "rotary_embedding_torch", "beartype", "hyper_connections"
)
& $pythonExe -m pip install $deps

Write-Host "7. Cleaning up heavy bloated dependencies..."
& $pythonExe -m pip uninstall -y torch sympy networkx mpmath filelock fsspec jinja2 markupsafe

Write-Host "Portable Python Setup Complete!"
