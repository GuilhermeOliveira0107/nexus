import sys
import threading
from pathlib import Path

import uvicorn

ROOT = Path(__file__).resolve().parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from app.certs import ensure_certs, lan_ips
from app.config import HTTP_PORT, HTTPS_PORT


def banner(http_port: int, https_port: int) -> None:
    ips = lan_ips()
    lan = [ip for ip in ips if ip != "127.0.0.1"]
    print()
    print("  NEXUS  -  Discord 2.0")
    print("  --------------------------------------------")
    print("  Voce neste PC:")
    print(f"    http://localhost:{http_port}")
    print(f"    https://localhost:{https_port}   <- use este se o microfone falhar")
    if lan:
        print("  Amigos na MESMA Wi-Fi (manda um destes):")
        for ip in lan:
            print(f"    https://{ip}:{https_port}")
            print(f"    http://{ip}:{http_port}     (chat ok; voz precisa do https)")
    print("  Amigos pela INTERNET:")
    print("    Libere a porta no roteador ou use um tunel (Cloudflare Tunnel / ngrok)")
    print("    apontando para este PC. Depois manda o link https publico.")
    print("  --------------------------------------------")
    print("  Cada amigo abre o link, cria a propria conta e entra no seu servidor.")
    print("  Dentro do app: botao Convidar amigos -> copia o link da sala.")
    print()


def main() -> None:
    cert, key = ensure_certs()
    banner(HTTP_PORT, HTTPS_PORT)

    https = threading.Thread(
        target=uvicorn.run,
        kwargs={
            "app": "app.main:app",
            "host": "0.0.0.0",
            "port": HTTPS_PORT,
            "ssl_certfile": str(cert),
            "ssl_keyfile": str(key),
            "log_level": "warning",
        },
        daemon=True,
    )
    https.start()
    uvicorn.run("app.main:app", host="0.0.0.0", port=HTTP_PORT, log_level="info")


if __name__ == "__main__":
    main()
