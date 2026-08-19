# Deploy: GitHub + Netlify + Staging (sofort)
param([string]$msg = "update")

Set-Location $PSScriptRoot
git add -A
git commit -m $msg
git push
ssh -i "$HOME\.ssh\hetzner_mh" -o StrictHostKeyChecking=no root@78.47.144.205 "/opt/cockpit/deploy.sh"
Write-Host "Fertig — GitHub, Netlify und https://78.47.144.205 aktuell." -ForegroundColor Green
