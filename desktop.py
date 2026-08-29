import os
import sys
import threading
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import webview

def cloud_url() -> str:
    env = os.environ.get("NEXUS_URL", "").strip()
    if env:
        return env
    marker = ROOT / "nuvem.url"
    if marker.exists():
        return marker.read_text(encoding="utf-8").strip().splitlines()[0].strip()
    return ""


CLOUD_URL = cloud_url()
LOCAL_URL = "http://127.0.0.1:8000"


def server_up(url: str) -> bool:
    try:
        urllib.request.urlopen(url + "/health", timeout=1)
        return True
    except Exception:
        return False


def start_local_server() -> None:
    import uvicorn

    uvicorn.run("app.main:app", host="127.0.0.1", port=8000, log_level="warning")


def main() -> None:
    url = CLOUD_URL or LOCAL_URL
    if not CLOUD_URL:
        if not server_up(LOCAL_URL):
            threading.Thread(target=start_local_server, daemon=True).start()
            for _ in range(40):
                if server_up(LOCAL_URL):
                    break
                time.sleep(0.15)
    webview.create_window(
        "Nexus",
        url,
        width=1280,
        height=800,
        min_size=(900, 600),
        background_color="#07080d",
    )
    webview.start()


if __name__ == "__main__":
    main()
