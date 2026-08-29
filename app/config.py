from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = BASE_DIR / "data"
DB_PATH = DATA_DIR / "nexus.db"
CERT_PATH = DATA_DIR / "cert.pem"
KEY_PATH = DATA_DIR / "key.pem"

APP_NAME = "Nexus"
HTTP_PORT = 8000
HTTPS_PORT = 8443
SESSION_DAYS = 30

AVATAR_COLORS = [
    "#ed4245",
    "#5865f2",
    "#57f287",
    "#fee75c",
    "#eb459e",
    "#f47b67",
    "#3ba55c",
    "#00b0f4",
    "#ff8c00",
    "#9b59b6",
    "#3dffd1",
    "#7b5cff",
    "#ff3d9a",
    "#38bdf8",
    "#f97316",
    "#14b8a6",
]
