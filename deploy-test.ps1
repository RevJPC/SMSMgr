# SMS Manager - Test Environment Deployment Script

Write-Host "🚀 Test Deployment Starting..." -ForegroundColor Cyan

# Check dependencies
if (!(Get-Command npx -ErrorAction SilentlyContinue)) {
    Write-Host "❌ Error: Node.js/npm not found." -ForegroundColor Red
    exit 1
}

# Prepare dist
if (!(Test-Path "frontend-dist")) {
    New-Item -ItemType Directory -Force -Path "frontend-dist" | Out-Null
}

# Copy index
Copy-Item "twilio-sms-2.2.0.html" -Destination "frontend-dist/index.html" -Force
Write-Host "✅ Copied HTML." -ForegroundColor Gray

# Deploy
Set-Location frontend-dist
Write-Host "🌐 Deploying to Cloudflare Pages (Test Branch)..."
npx wrangler pages deploy . --project-name=sms-manager --branch=test

if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ Deployment failed!" -ForegroundColor Red
    exit 1
}

Set-Location ..
Write-Host "✅ Deployment Complete." -ForegroundColor Green
