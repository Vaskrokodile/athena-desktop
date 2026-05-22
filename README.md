# Athena Desktop 🕊️

Athena Desktop is a premium, automated desktop wrapper for [Nous Research's Hermes Agent](https://github.com/NousResearch/hermes-agent). 

This is my custom version of a **"better"** Hermes Agent desktop app, engineered to make the setup and runtime experience seamless, beautiful, and robust.

## Why it's a "Better" Hermes Desktop App
* **Automated Python Environment**: Zero manual python environment configuration needed. The app automatically checks for Python, creates a virtual environment (`.venv`), and resolves all package dependencies (via `uv` if installed, or falling back to `pip`) on first run.
* **Premium Glassmorphic Splash Screen**: Instead of starting a backend in a black CLI terminal, Athena launches a gorgeous dark-themed loader window that reports virtual environment creation and package installation progress in real-time.
* **Smart Storage Redirection (C: Drive Workaround)**: Specifically designed to run on systems with full C: drives, the app automatically redirects all local setup caches (`.uv_cache`, `.pip_cache`) and persistent SQLite databases/config directories (`.hermes`) to the workspace's drive (e.g. E: drive) where space is abundant.
* **System Tray Integration**: Athena minimizes to the system tray rather than closing, keeping the agent active in the background. Right-clicking the tray icon gives quick access to open your configurations, restart the backend server, or quit.
* **Clean Process Lifecycle**: When you exit the app, it cleanly terminates all background Python backend subprocesses, ensuring no ports are left bound.

## Getting Started

### Prerequisites
* **Python** (version 3.11 or newer) must be installed on your system.
* **Node.js & npm** (to run the Electron wrapper).

### Installation & Launch
1. Clone this repository to your system:
   ```bash
   git clone https://github.com/Vaskrokodile/athena-desktop.git
   cd athena-desktop
   ```
2. Install the Electron dependencies:
   ```bash
   npm install
   ```
3. Launch Athena Desktop:
   ```bash
   npm start
   ```

Athena will handle the rest—setting up the python environment, installing Hermes dependencies, spawning the local FastAPI server, and launching the main interface.

---

*Based on [NousResearch/hermes-agent](https://github.com/NousResearch/hermes-agent).*
