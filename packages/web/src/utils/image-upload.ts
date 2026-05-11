import { apiClient } from "../api/client.js";

const MAX_IMAGE_SIZE = 10 * 1024 * 1024;
const MAX_DIMENSION = 1920;

interface UploadResult {
  id: string;
  mimeType: string;
  size: number;
}

export function compressImage(file: File): Promise<Blob> {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith("image/")) {
      resolve(file);
      return;
    }

    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      let { width, height } = img;
      if (width <= MAX_DIMENSION && height <= MAX_DIMENSION && file.size <= MAX_IMAGE_SIZE) {
        resolve(file);
        return;
      }
      if (width > MAX_DIMENSION) {
        height = Math.round(height * (MAX_DIMENSION / width));
        width = MAX_DIMENSION;
      }
      if (height > MAX_DIMENSION) {
        width = Math.round(width * (MAX_DIMENSION / height));
        height = MAX_DIMENSION;
      }
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) { resolve(file); return; }
      ctx.drawImage(img, 0, 0, width, height);
      canvas.toBlob((blob) => {
        if (blob) resolve(blob);
        else resolve(file);
      }, "image/jpeg", 0.85);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(file);
    };
    img.src = url;
  });
}

export async function uploadImage(file: File): Promise<UploadResult> {
  const compressed = await compressImage(file);
  const form = new FormData();
  form.append("file", compressed, file.name);
  const res = await apiClient<{ data: UploadResult[] }>("/conversations/_/attachments", {
    method: "POST",
    body: form,
  });
  const results = res.data;
  if (!results || results.length === 0) throw new Error("Upload failed");
  return results[0];
}

export function readFileAsDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}
