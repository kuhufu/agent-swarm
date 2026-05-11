import { Router } from "express";
import { randomUUID } from "node:crypto";
import { writeFile, mkdir } from "node:fs/promises";
import { join, extname } from "node:path";
import { existsSync } from "node:fs";
import type { AgentSwarm } from "@agent-swarm/core";
import { resolveRequestUserId } from "../middleware/auth.js";
import { readRequestBody, parseMultipartBody } from "./documents.js";

const ALLOWED_MIME_TYPES = [
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
];

const MAX_FILE_SIZE = 10 * 1024 * 1024;
const MAX_FILES_PER_REQUEST = 10;

function getUploadDir(): string {
  const dir = join(process.cwd(), "data", "uploads");
  return dir;
}

async function ensureUploadDir(): Promise<string> {
  const dir = getUploadDir();
  if (!existsSync(dir)) {
    await mkdir(dir, { recursive: true });
  }
  return dir;
}

export function attachmentRoutes(swarm: AgentSwarm): Router {
  const router = Router();

  router.post("/conversations/:id/attachments", async (req, res) => {
    try {
      const userId = resolveRequestUserId(req);
      if (!userId) {
        return res.status(401).json({ error: "Unauthorized" });
      }

      const contentType = req.headers["content-type"] ?? "";
      if (!contentType.includes("multipart/form-data")) {
        return res.status(400).json({ error: "Content-Type must be multipart/form-data" });
      }

      const body = await readRequestBody(req, MAX_FILE_SIZE);
      const multipart = parseMultipartBody(contentType, body);

      if (multipart.files.length === 0) {
        return res.status(400).json({ error: "No files uploaded" });
      }

      if (multipart.files.length > MAX_FILES_PER_REQUEST) {
        return res.status(400).json({ error: `Maximum ${MAX_FILES_PER_REQUEST} files per request` });
      }

      const uploadDir = await ensureUploadDir();
      const results: Array<{ id: string; mimeType: string; size: number }> = [];

      for (const file of multipart.files) {
        const mimeType = file.contentType ?? "application/octet-stream";
        if (!ALLOWED_MIME_TYPES.includes(mimeType)) {
          return res.status(400).json({ error: `Unsupported file type: ${mimeType}` });
        }

        const id = randomUUID();
        const ext = extname(file.filename) || ".bin";
        const filename = `${id}${ext}`;

        await writeFile(join(uploadDir, filename), file.data);
        results.push({ id, mimeType, size: file.data.length });
      }

      res.json({ data: results });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Upload failed";
      res.status(400).json({ error: message });
    }
  });

  return router;
}
