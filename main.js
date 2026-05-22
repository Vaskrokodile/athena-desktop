const { app, BrowserWindow, Menu, Tray, ipcMain, shell } = require("electron");
const path = require("path");
const { spawn, exec } = require("child_process");
const http = require("http");
const fs = require("fs");

// Redirect cache and data directories to E: drive workspace because C: drive is full
process.env.UV_CACHE_DIR = path.join(__dirname, ".uv_cache");
process.env.PIP_CACHE_DIR = path.join(__dirname, ".pip_cache");
process.env.HERMES_HOME = path.join(__dirname, ".hermes");

let mainWindow = null;
let splashWindow = null;
let tray = null;
let backendProcess = null;
let isQuitting = false;

const PORT = 9119;
const BACKEND_URL = `http://127.0.0.1:${PORT}`;
const AGENT_DIR = path.join(__dirname, "hermes-agent");

// Path to virtual environment
const VENV_DIR = path.join(AGENT_DIR, ".venv");
const PYTHON_EXE = process.platform === "win32" 
  ? path.join(VENV_DIR, "Scripts", "python.exe") 
  : path.join(VENV_DIR, "bin", "python");
const PIP_EXE = process.platform === "win32"
  ? path.join(VENV_DIR, "Scripts", "pip.exe")
  : path.join(VENV_DIR, "bin", "pip");

function logToSplash(message, status = "info", pct = 0) {
  console.log(`[Setup Status] ${status} (${pct}%): ${message}`);
  if (splashWindow && !splashWindow.destroyed) {
    splashWindow.webContents.send("setup-status", { status, message, pct });
  }
}

function logProgressToSplash(data) {
  if (splashWindow && !splashWindow.destroyed) {
    splashWindow.webContents.send("setup-progress", data);
  }
}

function createSplashWindow() {
  splashWindow = new BrowserWindow({
    width: 550,
    height: 480,
    frame: false,
    transparent: true,
    resizable: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  splashWindow.loadFile("splash.html");

  splashWindow.on("closed", () => {
    splashWindow = null;
  });
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    show: false,
    backgroundColor: "#0a0b10",
    title: "Hermes Agent",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.loadURL(BACKEND_URL);

  mainWindow.once("ready-to-show", () => {
    if (splashWindow) {
      splashWindow.close();
    }
    mainWindow.show();
  });

  mainWindow.on("close", (event) => {
    if (!isQuitting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

function createTray() {
  // Use a generic dot/orb style or look for an icon file. For now, we will create a text/icon fallback.
  // We can write a tiny script to fetch/generate an icon, but we can also use a blank tray icon or a default system icon.
  // On Windows, we can use a small 16x16 ICO. Let's create a placeholder or use a transparent/simple icon if not found.
  const iconPath = path.join(__dirname, "icon.png");
  
  // If icon doesn't exist, we can use a default native image or write a simple one.
  tray = new Tray(fs.existsSync(iconPath) ? iconPath : path.join(__dirname, "hermes-agent", "assets", "logo.png"));
  
  const contextMenu = Menu.buildFromTemplate([
    {
      label: "Show Hermes Agent",
      click: () => {
        if (mainWindow) {
          mainWindow.show();
        } else {
          createMainWindow();
        }
      }
    },
    {
      label: "Open Config Folder",
      click: () => {
        const homeDir = process.env.USERPROFILE || process.env.HOME;
        const hermesHome = path.join(homeDir, ".hermes");
        if (fs.existsSync(hermesHome)) {
          shell.openPath(hermesHome);
        } else {
          shell.openPath(homeDir);
        }
      }
    },
    {
      label: "Restart Server",
      click: () => {
        restartBackend();
      }
    },
    { type: "separator" },
    {
      label: "Quit",
      click: () => {
        isQuitting = true;
        app.quit();
      }
    }
  ]);

  tray.setToolTip("Hermes Agent Desktop");
  tray.setContextMenu(contextMenu);

  tray.on("click", () => {
    if (mainWindow) {
      if (mainWindow.isVisible()) {
        mainWindow.hide();
      } else {
        mainWindow.show();
      }
    }
  });
}

// Function to check if a port is in use
function checkPort(port, callback) {
  const client = new http.ClientRequest({
    host: "127.0.0.1",
    port: port,
    path: "/",
    method: "GET"
  });
  
  client.on("response", (res) => {
    client.destroy();
    callback(true); // Port in use (server is up)
  });
  
  client.on("error", (err) => {
    client.destroy();
    callback(false); // Port free
  });
  
  client.end();
}

// Function to check for python installation
function checkPython(callback) {
  exec("python --version", (error, stdout, stderr) => {
    if (error) {
      callback(false);
    } else {
      callback(true);
    }
  });
}

// Function to check for uv installation
function checkUv(callback) {
  exec("uv --version", (error, stdout, stderr) => {
    if (error) {
      callback(false);
    } else {
      callback(true);
    }
  });
}

function runSetup() {
  logToSplash("Checking system dependencies...", "checking", 5);
  
  checkPython((hasPython) => {
    if (!hasPython) {
      logToSplash("Python not found! Please install Python 3.11 or newer.", "error", 100);
      if (splashWindow) splashWindow.webContents.send("setup-error", "Python is required but was not found.");
      return;
    }

    checkUv((hasUv) => {
      const useUv = hasUv;
      logToSplash(useUv ? "Found uv package manager. Setup will be fast!" : "uv not found. Using standard pip...", "checking", 15);
      
      ensureVenv(useUv);
    });
  });
}

function ensureVenv(useUv) {
  if (fs.existsSync(PYTHON_EXE)) {
    logToSplash("Virtual environment detected.", "checking", 30);
    installDeps(useUv);
  } else {
    logToSplash("Creating virtual environment...", "creating_venv", 20);
    
    let cmd, args;
    if (useUv) {
      cmd = "uv";
      args = ["venv"];
    } else {
      cmd = "python";
      args = ["-m", "venv", ".venv"];
    }

    const venvProc = spawn(cmd, args, { cwd: AGENT_DIR, shell: true });
    
    venvProc.stdout.on("data", (data) => {
      console.log(`[Venv stdout] ${data}`);
      logProgressToSplash(data.toString());
    });
    venvProc.stderr.on("data", (data) => {
      console.error(`[Venv stderr] ${data}`);
      logProgressToSplash(data.toString());
    });

    venvProc.on("close", (code) => {
      if (code === 0) {
        logToSplash("Virtual environment created successfully.", "checking", 40);
        installDeps(useUv);
      } else {
        logToSplash("Failed to create virtual environment.", "error", 100);
        if (splashWindow) splashWindow.webContents.send("setup-error", "Venv creation failed.");
      }
    });
  }
}

function installDeps(useUv) {
  logToSplash("Installing dependencies...", "installing_deps", 50);
  
  let cmd, args;
  if (useUv) {
    cmd = "uv";
    args = ["pip", "install", "-e", "\".[all]\""];
  } else {
    cmd = PIP_EXE;
    args = ["install", "-e", "\".[all]\""];
  }

  const instProc = spawn(cmd, args, { cwd: AGENT_DIR, shell: true });
  
  instProc.stdout.on("data", (data) => {
    console.log(`[Install stdout] ${data}`);
    logProgressToSplash(data.toString());
  });
  instProc.stderr.on("data", (data) => {
    console.error(`[Install stderr] ${data}`);
    logProgressToSplash(data.toString());
  });

  instProc.on("close", (code) => {
    if (code === 0) {
      logToSplash("Dependencies ready.", "checking", 80);
      startBackend();
    } else {
      logToSplash("Failed to install dependencies.", "error", 100);
      if (splashWindow) splashWindow.webContents.send("setup-error", "Dependency installation failed.");
    }
  });
}

function startBackend() {
  logToSplash("Starting local server...", "starting_backend", 85);
  
  // We run python -m hermes_cli.main dashboard --no-open --port 9119 --host 127.0.0.1 --skip-build
  const args = [
    "-m", "hermes_cli.main", 
    "dashboard", 
    "--no-open", 
    "--port", PORT.toString(), 
    "--host", "127.0.0.1", 
    "--skip-build"
  ];
  
  backendProcess = spawn(PYTHON_EXE, args, {
    cwd: AGENT_DIR,
    env: {
      ...process.env,
      // Ensure the dashboard knows it's serving inside Electron
      HERMES_DASHBOARD_TUI: "1" 
    }
  });

  backendProcess.stdout.on("data", (data) => {
    console.log(`[Backend stdout] ${data}`);
    logProgressToSplash(data.toString());
  });

  backendProcess.stderr.on("data", (data) => {
    console.error(`[Backend stderr] ${data}`);
    logProgressToSplash(data.toString());
  });

  backendProcess.on("close", (code) => {
    console.log(`Backend process exited with code ${code}`);
    if (!isQuitting) {
      logToSplash(`Server stopped unexpectedly (code ${code}).`, "error", 100);
      if (splashWindow) splashWindow.webContents.send("setup-error", `Server exited with code ${code}.`);
    }
  });

  // Poll server health
  pollServer(30); // Try 30 times (30 seconds max)
}

function pollServer(retriesLeft) {
  if (retriesLeft <= 0) {
    logToSplash("Server failed to respond in time.", "error", 100);
    if (splashWindow) splashWindow.webContents.send("setup-error", "Server timeout.");
    return;
  }

  logToSplash(`Verifying connection (attempts left: ${retriesLeft})...`, "starting_backend", 90);
  
  checkPort(PORT, (isUp) => {
    if (isUp) {
      logToSplash("Connection established. Launching dashboard...", "ready", 100);
      setTimeout(() => {
        createMainWindow();
      }, 800);
    } else {
      setTimeout(() => {
        pollServer(retriesLeft - 1);
      }, 1000);
    }
  });
}

function killBackend() {
  if (backendProcess) {
    const pid = backendProcess.pid;
    console.log(`Terminating backend process PID ${pid}...`);
    if (process.platform === "win32") {
      exec(`taskkill /F /T /PID ${pid}`);
    } else {
      backendProcess.kill("SIGTERM");
    }
    backendProcess = null;
  }
}

function restartBackend() {
  killBackend();
  logToSplash("Restarting backend...", "starting_backend", 85);
  setTimeout(() => {
    startBackend();
  }, 1000);
}

app.on("ready", () => {
  createSplashWindow();
  createTray();
  
  // Start the setup loop
  setTimeout(() => {
    runSetup();
  }, 1000);
});

app.on("window-all-closed", () => {
  // Minimize to tray on macOS and Windows rather than quitting entirely, unless quitting
  if (process.platform !== "darwin" && isQuitting) {
    app.quit();
  }
});

app.on("activate", () => {
  if (mainWindow === null) {
    createMainWindow();
  }
});

app.on("before-quit", () => {
  isQuitting = true;
  killBackend();
});
