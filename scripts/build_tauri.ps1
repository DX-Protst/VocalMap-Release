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

try {
    Write-Host "Running npx tauri build..."
    npx tauri build
}
finally {
    Write-Host "Cleaning up dev environment..."
}

Write-Host "Build finished!"
