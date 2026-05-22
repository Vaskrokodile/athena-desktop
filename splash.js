const statusMessageEl = document.getElementById("status-message");
const statusPctEl = document.getElementById("status-pct");
const progressBarEl = document.getElementById("progress-bar");
const consoleEl = document.getElementById("console");

function addLog(text, type = "info") {
  const line = document.createElement("div");
  line.className = `log-line ${type}`;
  line.textContent = `> ${text}`;
  consoleEl.appendChild(line);
  consoleEl.scrollTop = consoleEl.scrollHeight;
}

if (window.api) {
  window.api.onStatus((data) => {
    const { status, message, pct } = data;
    
    statusMessageEl.textContent = message || "Processing...";
    statusPctEl.textContent = `${pct}%`;
    progressBarEl.style.width = `${pct}%`;
    
    let logType = "info";
    if (status === "ready") logType = "success";
    if (status === "error") logType = "error";
    if (status === "installing_deps" || status === "creating_venv") logType = "running";
    
    addLog(message, logType);
  });

  window.api.onProgress((data) => {
    // raw shell outputs or installation details
    const text = data.trim();
    if (text) {
      // Split by newline and add each
      const lines = text.split(/\r?\n/);
      lines.forEach(line => {
        if (line.trim()) {
          // Detect some keywords to color
          let type = "info";
          if (line.toLowerCase().includes("error") || line.toLowerCase().includes("failed")) {
            type = "error";
          } else if (line.toLowerCase().includes("warning") || line.toLowerCase().includes("warn")) {
            type = "warn";
          } else if (line.toLowerCase().includes("successfully") || line.toLowerCase().includes("installed") || line.toLowerCase().includes("complete")) {
            type = "success";
          }
          addLog(line, type);
        }
      });
    }
  });

  window.api.onError((err) => {
    addLog(`Error encountered: ${err}`, "error");
    statusMessageEl.textContent = "Setup Failed";
    statusMessageEl.style.color = "#f87171";
    statusPctEl.textContent = "Err";
    progressBarEl.style.background = "#ef4444";
    progressBarEl.style.boxShadow = "0 0 10px rgba(239, 68, 68, 0.8)";
  });
} else {
  addLog("Electron API not detected. Make sure preload.js is configured.", "error");
}
