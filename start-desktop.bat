@echo off
cd /d "%~dp0"
if not exist ".venv\Scripts\python.exe" (
  echo Instalando o Nexus...
  python -m venv .venv
  .venv\Scripts\python -m pip install -r requirements.txt
)
echo Abrindo o Nexus no computador...
.venv\Scripts\python desktop.py
