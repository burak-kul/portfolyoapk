#!/usr/bin/env bash
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DOMAIN="${1:-_}"

echo "=== [1/5] Sistem paketleri ve Node.js 22 kontrol ediliyor ==="
if ! command -v node >/dev/null 2>&1 || [ "$(node -v | cut -d. -f1 | tr -d 'v')" -lt 20 ]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
  sudo apt-get install -y nodejs
fi
sudo apt-get update
sudo apt-get install -y nginx git curl

echo "=== [2/5] Proje bağımlılıkları kuruluyor ve derleniyor ==="
cd "$APP_DIR"
npm install
npm run build

echo "=== [3/5] 7/24 Arka Plan Servisi (systemd) oluşturuluyor ==="
NODE_BIN="$(command -v node)"
sudo tee /etc/systemd/system/burak-portfolio.service >/dev/null <<EOF
[Unit]
Description=Burak Kul Portfolio & CMS Server
After=network.target

[Service]
Type=simple
User=$USER
WorkingDirectory=$APP_DIR
Environment=NODE_ENV=production
Environment=PORT=3001
Environment=HOST=0.0.0.0
ExecStart=$NODE_BIN $APP_DIR/server/index.mjs
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable --now burak-portfolio.service
sudo systemctl restart burak-portfolio.service

echo "=== [4/5] Nginx Ters Vekil (Reverse Proxy - Port 80) ayarlanıyor ==="
sudo tee /etc/nginx/sites-available/burak-portfolio >/dev/null <<EOF
server {
    listen 80 default_server;
    listen [::]:80 default_server;
    server_name $DOMAIN;

    client_max_body_size 25M;

    location / {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
}
EOF

sudo rm -f /etc/nginx/sites-enabled/default
sudo ln -sf /etc/nginx/sites-available/burak-portfolio /etc/nginx/sites-enabled/burak-portfolio
sudo nginx -t
sudo systemctl enable --now nginx
sudo systemctl reload nginx

echo "=== [5/5] Güvenlik Duvarı (UFW) izinleri kontrol ediliyor ==="
if command -v ufw >/dev/null 2>&1; then
  sudo ufw allow 22/tcp || true
  sudo ufw allow 80/tcp || true
  sudo ufw allow 443/tcp || true
  sudo ufw allow 3001/tcp || true
fi

PUBLIC_IP="$(curl -4 -fsSL ifconfig.me || hostname -I | awk '{print $1}')"
echo ""
echo "=========================================================="
echo " KURULUM TAMAMLANDI!"
echo " Web Siten:          http://$PUBLIC_IP"
echo " Web Admin Paneli:   http://$PUBLIC_IP/admin"
echo " Mobil APK URL'si:   http://$PUBLIC_IP"
if [ -f "$APP_DIR/server/data/admin-password.txt" ]; then
  echo " İlk Admin Şifren:   $(cat "$APP_DIR/server/data/admin-password.txt")"
fi
echo "=========================================================="

