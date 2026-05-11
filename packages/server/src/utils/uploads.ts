import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { readdir } from "node:fs/promises";

const UPLOAD_DIR = join(process.cwd(), "data", "uploads");

export interface UploadedFileInfo {
  id: string;
  filename: string;
  mimeType: string;
}

async function findFile(id: string): Promise<UploadedFileInfo | null> {
  try {
    const files = await readdir(UPLOAD_DIR);
    const match = files.find((f) => f.startsWith(id));
    if (!match) return null;
    const ext = match.split(".").pop() ?? "";
    return { id, filename: match, mimeType: mimeTypeFromExt(ext) };
  } catch {
    return null;
  }
}

function mimeTypeFromExt(ext: string): string {
  const map: Record<string, string> = {
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    webp: "image/webp",
  };
  return map[ext.toLowerCase()] ?? "application/octet-stream";
}

export async function loadImageAsBase64(id: string): Promise<{ data: string; mimeType: string; type: "image" } | null> {
  const info = await findFile(id);
  if (!info) return null;

  try {
    const buffer = await readFile(join(UPLOAD_DIR, info.filename));
    return {
      data: buffer.toString("base64"),
      mimeType: info.mimeType,
      type: "image" as const,
    };
  } catch {
    return null;
  }
}
