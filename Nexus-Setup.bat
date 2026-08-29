@echo off
title Nexus — Instalador
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0installer\instalar.ps1"
if errorlevel 1 pause
