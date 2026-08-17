# Sao chep tep nay thanh config.local.ps1, sau do dien cac gia tri cua ban.
# Khong gui config.local.ps1 hoac service-account.json len GitHub.

# Firebase Web App (Project settings -> Your apps -> Web app)
$env:FIREBASE_API_KEY = ""
$env:FIREBASE_AUTH_DOMAIN = ""
$env:FIREBASE_PROJECT_ID = ""
$env:FIREBASE_STORAGE_BUCKET = ""
$env:FIREBASE_MESSAGING_SENDER_ID = ""
$env:FIREBASE_APP_ID = ""

# Firebase Admin SDK (Project settings -> Service accounts -> Generate new private key)
$env:FIREBASE_SERVICE_ACCOUNT_PATH = ""
# Thay cho PATH, co the dat ca JSON tren mot dong trong bien sau:
$env:FIREBASE_SERVICE_ACCOUNT_JSON = ""

# Telegram BotFather. Chi TELEGRAM_BOT_TOKEN la bat buoc cho nut lien ket tren web.
$env:TELEGRAM_BOT_TOKEN = ""
# Tuy chon tuong thich cach cu: gui them den mot chat ID co dinh.
$env:TELEGRAM_CHAT_ID = ""
# Backend poll Bot API trong LAN de nhan /start va ghi chat ID theo tung user.
$env:TELEGRAM_POLL_INTERVAL_MS = "3000"
$env:TELEGRAM_LINK_TTL_MS = "600000"

# OpenAI API: khoa chi nam o backend Node-RED, khong dua vao website.
$env:OPENAI_API_KEY = ""
$env:OPENAI_MODEL = "gpt-5.4-nano"
# Gioi han chi phi va tranh spam chatbot trong mang LAN.
$env:OPENAI_TIMEOUT_MS = "25000"
$env:OPENAI_MAX_OUTPUT_TOKENS = "500"
$env:CHAT_RATE_LIMIT_MAX = "12"
$env:CHAT_RATE_LIMIT_WINDOW_MS = "60000"

# 60 giay ghi mot ban ghi Cloud de tranh ton qua nhieu Firestore writes.
$env:CLOUD_SAVE_INTERVAL_MS = "60000"
$env:ALERT_COOLDOWN_MS = "600000"

# Cho phep vao che do local khi Firebase chua cau hinh.
# Doi thanh false khi trien khai that va Firebase da hoat dong.
$env:AQUA_ALLOW_DEMO_AUTH = "true"
