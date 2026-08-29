@echo off
cd /d "%~dp0"
if not exist ".venv\Scripts\python.exe" (
  echo Instalando o Nexus na primeira vez...
  python -m venv .venv
  .venv\Scripts\python -m pip install -r requirements.txt
)
echo.
echo TESTE LOCAL. Para os amigos usarem de casa, publique na nuvem:
echo leia COMO-PUBLICAR.txt  (Render + Neon, de graca)
echo.
.venv\Scripts\python run.py
pause
