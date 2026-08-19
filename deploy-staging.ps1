# Staging sofort aktualisieren ohne Netlify-Deploy
# Synct public/ direkt per rsync auf den Server
Set-Location $PSScriptRoot
rsync -avz --delete public/ root@78.47.144.205:/opt/cockpit/public/ -e "ssh -i $HOME\.ssh\hetzner_mh -o StrictHostKeyChecking=no"
Write-Host "Fertig — https://78.47.144.205 zeigt jetzt lokalen Stand." -ForegroundColor Cyan
