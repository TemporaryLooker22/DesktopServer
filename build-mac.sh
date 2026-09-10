#!/bin/bash
# DesktopServer - Compilation macOS DMG
# Ce script installe les dependances requises et compile le paquet DMG pour macOS.

set -e

echo "[1/3] Verification de l'environnement Node.js..."
if ! command -v node &> /dev/null; then
    echo "Erreur : Node.js n'est pas installe sur cette machine."
    echo "Veuillez installer Node.js depuis https://nodejs.org/"
    exit 1
fi

echo "Version Node.js detectee : $(node -v)"
echo "Version npm detectee : $(npm -v)"

echo "[2/3] Installation des dependances du projet (moteur Electron 26 compatible macOS 10.13+)..."
npm install
npm install --save-dev electron@26.6.9

echo "[3/3] Compilation du DMG macOS (Intel x64 compatible High Sierra et Apple Silicon arm64)..."
npm run build:mac

echo "--------------------------------------------------------"
echo "Compilation terminee avec succes !"
echo "Le fichier d'installation se trouve dans le dossier dist :"
echo "dist/DesktopServer.dmg"
echo "--------------------------------------------------------"
