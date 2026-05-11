import { DialogPlugin } from "tdesign-vue-next";

interface ConfirmOptions {
  header?: string;
  body: string;
  confirmText?: string;
  cancelText?: string;
  theme?: "default" | "warning" | "danger";
}

export function confirmDialog(options: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    const dialog = DialogPlugin.confirm({
      header: options.header ?? "请确认",
      body: options.body,
      theme: options.theme ?? "warning",
      confirmBtn: options.confirmText ?? "确定",
      cancelBtn: options.cancelText ?? "取消",
      closeOnOverlayClick: true,
      onConfirm: () => {
        settled = true;
        resolve(true);
        dialog.destroy();
      },
      onCancel: () => {
        settled = true;
        resolve(false);
        dialog.destroy();
      },
      onClose: () => {
        if (!settled) {
          resolve(false);
        }
      },
    });
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
