import { DialogPlugin, MessagePlugin } from "tdesign-vue-next";

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

export function showError(message: string) {
  MessagePlugin.error(message);
}
