interface ConfirmOptions {
  header?: string;
  body: string;
  confirmText?: string;
  cancelText?: string;
  theme?: "default" | "warning" | "danger";
}

const CONFIRM_Z_INDEX = 10000;

export function confirmDialog(options: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;

    const overlay = document.createElement("div");
    overlay.style.cssText = `
      position: fixed; inset: 0; z-index: ${CONFIRM_Z_INDEX};
      background: var(--bg-overlay);
      display: flex; align-items: center; justify-content: center;
      padding: 24px;
    `;

    const dialog = document.createElement("div");
    dialog.style.cssText = `
      width: 380px; max-width: calc(100vw - 48px);
      background: var(--bg-card);
      border: 1px solid var(--border-default);
      border-radius: var(--radius-xl);
      box-shadow: var(--shadow-lg);
      display: flex; flex-direction: column;
      overflow: hidden;
    `;

    const headerEl = document.createElement("div");
    headerEl.style.cssText = `
      display: flex; align-items: center; justify-content: space-between;
      padding: 16px 20px 0;
    `;
    const headerText = document.createElement("h3");
    headerText.textContent = options.header ?? "请确认";
    headerText.style.cssText = `
      margin: 0; color: var(--text-primary);
      font-size: var(--text-lg); font-weight: var(--weight-bold);
    `;
    headerEl.appendChild(headerText);

    const bodyEl = document.createElement("div");
    bodyEl.style.cssText = `
      padding: 12px 20px; color: var(--text-secondary);
      font-size: var(--text-base); line-height: 1.5;
      word-break: break-word;
    `;
    bodyEl.textContent = options.body;

    const footerEl = document.createElement("div");
    footerEl.style.cssText = `
      display: flex; justify-content: flex-end; gap: 10px;
      padding: 14px 20px 20px;
    `;

    const cancelBtn = document.createElement("button");
    cancelBtn.textContent = options.cancelText ?? "取消";
    cancelBtn.style.cssText = `
      padding: 7px 16px; border: 1px solid var(--border-default);
      border-radius: var(--radius-md); background: var(--bg-card);
      color: var(--text-secondary); font-size: var(--text-base);
      font-weight: var(--weight-medium); font-family: inherit;
      cursor: pointer; transition: all 0.15s;
    `;
    cancelBtn.onmouseenter = () => {
      cancelBtn.style.background = "var(--bg-hover)";
      cancelBtn.style.color = "var(--text-primary)";
    };
    cancelBtn.onmouseleave = () => {
      cancelBtn.style.background = "var(--bg-card)";
      cancelBtn.style.color = "var(--text-secondary)";
    };

    const confirmBtn = document.createElement("button");
    confirmBtn.textContent = options.confirmText ?? "确定";
    const isDanger = options.theme === "danger";
    confirmBtn.style.cssText = `
      padding: 7px 16px; border: 1px solid ${isDanger ? "var(--color-danger)" : "var(--border-default)"};
      border-radius: var(--radius-md); background: ${isDanger ? "transparent" : "var(--bg-hover)"};
      color: ${isDanger ? "var(--color-danger)" : "var(--text-primary)"};
      font-size: var(--text-base); font-weight: var(--weight-bold); font-family: inherit;
      cursor: pointer; transition: all 0.15s;
    `;
    confirmBtn.onmouseenter = () => {
      confirmBtn.style.background = isDanger ? "var(--bg-danger)" : "var(--bg-card)";
      confirmBtn.style.borderColor = "var(--border-default)";
    };
    confirmBtn.onmouseleave = () => {
      confirmBtn.style.background = isDanger ? "transparent" : "var(--bg-hover)";
      confirmBtn.style.borderColor = isDanger ? "var(--color-danger)" : "var(--border-default)";
    };

    function close() {
      if (!settled) {
        settled = true;
        resolve(false);
      }
      overlay.remove();
    }

    cancelBtn.onclick = close;
    confirmBtn.onclick = () => {
      settled = true;
      resolve(true);
      overlay.remove();
    };
    overlay.onclick = (e) => {
      if (e.target === overlay) close();
    };

    footerEl.appendChild(cancelBtn);
    footerEl.appendChild(confirmBtn);
    dialog.appendChild(headerEl);
    dialog.appendChild(bodyEl);
    dialog.appendChild(footerEl);
    overlay.appendChild(dialog);
    document.body.appendChild(overlay);
  });
}

let toastTimer: ReturnType<typeof setTimeout> | null = null;

export function showToast(message: string) {
  const existing = document.querySelector(".custom-toast");
  if (existing) existing.remove();
  if (toastTimer) clearTimeout(toastTimer);

  const el = document.createElement("div");
  el.className = "custom-toast";
  el.textContent = message;
  Object.assign(el.style, {
    position: "fixed",
    bottom: "24px",
    left: "50%",
    transform: "translateX(-50%)",
    zIndex: "9999",
    padding: "8px 16px",
    borderRadius: "8px",
    background: "var(--bg-card)",
    border: "1px solid var(--border-subtle)",
    color: "var(--text-secondary)",
    fontSize: "14px",
    lineHeight: "1.4",
    boxShadow: "var(--shadow-md)",
    transition: "opacity 0.2s",
    pointerEvents: "none",
  });
  document.body.appendChild(el);

  toastTimer = setTimeout(() => {
    el.style.opacity = "0";
    setTimeout(() => el.remove(), 200);
  }, 2000);
}

export function showError(message: string) {
  showToast(message);
}

export function showSuccess(message: string) {
  showToast(message);
}
