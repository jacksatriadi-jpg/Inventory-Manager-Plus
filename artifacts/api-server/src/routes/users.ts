import { Router } from "express";
import type { IRouter } from "express";
import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import {
  ListUsersResponse,
  CreateUserBody,
  GetUserParams,
  GetUserResponse,
  UpdateUserParams,
  UpdateUserBody,
  UpdateUserResponse,
  DeleteUserParams,
} from "@workspace/api-zod";
import { hashPassword, generateToken, parseToken } from "../lib/auth";

const router: IRouter = Router();

function requireMaster(req: any, res: any): boolean {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    res.status(401).json({ error: "Not authenticated" });
    return false;
  }
  const token = authHeader.slice(7);
  const parsed = parseToken(token);
  if (!parsed) {
    res.status(401).json({ error: "Invalid token" });
    return false;
  }
  // We'll trust the token for now — full role check done in middleware
  return true;
}

router.get("/users", async (req, res): Promise<void> => {
  const users = await db.select().from(usersTable).orderBy(usersTable.createdAt);
  const response = ListUsersResponse.parse(
    users.map((u) => ({
      id: u.id,
      username: u.username,
      role: u.role,
      menuAccess: u.menuAccess || [],
      createdAt: u.createdAt.toISOString(),
    }))
  );
  res.json(response);
});

router.post("/users", async (req, res): Promise<void> => {
  const parsed = CreateUserBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { username, password, role, menuAccess } = parsed.data;
  const passwordHash = hashPassword(password);

  const [user] = await db
    .insert(usersTable)
    .values({ username, passwordHash, role, menuAccess: menuAccess || [] })
    .returning();

  res.status(201).json({
    id: user.id,
    username: user.username,
    role: user.role,
    menuAccess: user.menuAccess || [],
    createdAt: user.createdAt.toISOString(),
  });
});

router.get("/users/:id", async (req, res): Promise<void> => {
  const params = GetUserParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, params.data.id));
  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  res.json(GetUserResponse.parse({
    id: user.id,
    username: user.username,
    role: user.role,
    menuAccess: user.menuAccess || [],
    createdAt: user.createdAt.toISOString(),
  }));
});

router.patch("/users/:id", async (req, res): Promise<void> => {
  const params = UpdateUserParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const parsed = UpdateUserBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const updateData: any = {};
  if (parsed.data.username) updateData.username = parsed.data.username;
  if (parsed.data.role) updateData.role = parsed.data.role;
  if (parsed.data.password) updateData.passwordHash = hashPassword(parsed.data.password);
  if (parsed.data.menuAccess !== undefined) updateData.menuAccess = parsed.data.menuAccess;

  const [user] = await db
    .update(usersTable)
    .set(updateData)
    .where(eq(usersTable.id, params.data.id))
    .returning();

  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  res.json(UpdateUserResponse.parse({
    id: user.id,
    username: user.username,
    role: user.role,
    menuAccess: user.menuAccess || [],
    createdAt: user.createdAt.toISOString(),
  }));
});

router.delete("/users/:id", async (req, res): Promise<void> => {
  const params = DeleteUserParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [user] = await db.delete(usersTable).where(eq(usersTable.id, params.data.id)).returning();
  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  res.sendStatus(204);
});

export default router;
