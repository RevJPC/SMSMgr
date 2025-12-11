# SMS Manager - Quick Deployment Script
# Run this script to deploy both backend and frontend to Cloudflare

Write-Host "🚀 SMS Manager Deployment Script" -ForegroundColor Cyan
Write-Host "=================================" -ForegroundColor Cyan
Write-Host ""

# Check if wrangler is installed
if (!(Get-Command npx -ErrorAction SilentlyContinue)) {
    Write-Host "❌ Error: Node.js/npm not found. Please install Node.js first." -ForegroundColor Red
    exit 1
}

Write-Host "📦 Step 1: Deploying Cloudflare Worker (Backend)..." -ForegroundColor Yellow
Write-Host ""

Set-Location cloudflare-backend

# Deploy worker
Write-Host "Deploying worker..." -ForegroundColor Gray
npx wrangler deploy

if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ Worker deployment failed!" -ForegroundColor Red
    exit 1
}

Write-Host "✅ Worker deployed successfully!" -ForegroundColor Green
Write-Host ""

Set-Location ..

Write-Host "🌐 Step 2: Deploying Frontend to Cloudflare Pages..." -ForegroundColor Yellow
Write-Host ""

Set-Location frontend-dist

# Deploy to Pages
Write-Host "Deploying to Cloudflare Pages..." -ForegroundColor Gray
Copy-Item "guide.html" -Destination "frontend-dist/guide.html" -Force
Copy-Item "twilio-sms-2.2.0.html" -Destination "frontend-dist/index.html" -Force
npx wrangler pages deploy . --project-name=sms-manager

if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ Pages deployment failed!" -ForegroundColor Red
    exit 1
}

Write-Host "✅ Frontend deployed successfully!" -ForegroundColor Green
Write-Host ""

Set-Location ..

Write-Host "🎉 Deployment Complete!" -ForegroundColor Green
Write-Host ""
Write-Host "Next steps:" -ForegroundColor Cyan
Write-Host "1. Go to Cloudflare Dashboard → Pages → sms-manager" -ForegroundColor White
Write-Host "2. Add custom domain: smsmgr.com" -ForegroundColor White
Write-Host "3. Add wildcard domain: *.smsmgr.com" -ForegroundColor White
Write-Host "4. Update nameservers in AWS Route 53 to point to Cloudflare" -ForegroundColor White
Write-Host ""
Write-Host "📖 See deployment-guide.md for detailed instructions" -ForegroundColor Gray
