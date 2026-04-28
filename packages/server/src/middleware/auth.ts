import type { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";

const JWT_SECRET = process.env.JWT_SECRET ?? "change-me-to-random-string";
const PUBLIC_AUTH_PATHS = new Set<string>(["/auth/login", "/auth/register"]);

export interface AuthUser {
  id: string;
  username: string;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

export function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  // auth 路由挂载在 /api/auth 下，中间件在 /api 层级，所以 req.path 以 /auth/* 开头
  if (PUBLIC_AUTH_PATHS.has(req.path)) {
    return next();
  }

  if (req.path === "/health") {
    return next();
  }

  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) {
    res.status(401).json({ error: "未登录" });
    return;
  }

  try {
    const payload = verifyAccessToken(header.slice(7));
    if (!payload) {
      res.status(401).json({ error: "登录已过期" });
      return;
    }
    req.user = payload;
    next();
  } catch {
    res.status(401).json({ error: "登录已过期" });
  }
}

export function signToken(user: { id: string; username: string }): string {
  const expiresIn = process.env.JWT_EXPIRES_IN ?? "7d";
  return jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: expiresIn as any });
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (!req.user) {
    res.status(401).json({ error: "未登录" });
    return;
  }
  next();
}

export function resolveRequestUserId(req: Request): string | null {
  return req.user?.id ?? null;
}

export function verifyAccessToken(token: string): AuthUser | null {
  try {
    return jwt.verify(token, JWT_SECRET) as AuthUser;
  } catch {
    return null;
  }
}
