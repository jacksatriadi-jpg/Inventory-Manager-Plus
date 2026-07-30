import { Router } from "express";
import type { IRouter } from "express";
import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { LoginBody, LoginResponse, GetMeResponse } from "@workspace/api-zod";
import { hashPassword, verifyPassword, generateToken, parseToken } from "../lib/auth";
import { logger } from "../lib/logger";

const router: IRouter = Router();

router.post("/auth/login", async (req, res): Promise<void> => {
  const parsed = LoginBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { username, password } = parsed.data;

  const [user] = await db.select().from(usersTable).where(eq(usersTable.username, username));

  if (!user || !verifyPassword(password, user.passwordHash)) {
    res.status(401).json({ error: "Invalid username or password" });
    return;
  }

  const token = generateToken(user.id, user.username);

  const responseUser = {
    id: user.id,
    username: user.username,
    role: user.role,
    menuAccess: user.menuAccess || [],
    createdAt: user.createdAt.toISOString(),
  };

  const response = LoginResponse.parse({ token, user: responseUser });
  res.json(response);
});

router.get("/auth/me", async (req, res): Promise<void> => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }

  const token = authHeader.slice(7);
  const parsed = parseToken(token);
  if (!parsed) {
    res.status(401).json({ error: "Invalid token" });
    return;
  }

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, parsed.userId));
  if (!user) {
    res.status(401).json({ error: "User not found" });
    return;
  }

  const response = GetMeResponse.parse({
    id: user.id,
    username: user.username,
    role: user.role,
    menuAccess: user.menuAccess || [],
    createdAt: user.createdAt.toISOString(),
  });
  res.json(response);
});

export default router;
