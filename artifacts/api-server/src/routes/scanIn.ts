import { Router } from "express";
import type { IRouter } from "express";
import { db, scanInTable, scanItemsTable, materialsTable, usersTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import {
  ListScanInQueryParams,
  ListScanInResponse,
  CreateScanInBody,
  GetScanInParams,
  GetScanInResponse,
  UpdateScanInParams,
  UpdateScanInBody,
  UpdateScanInResponse,
  DeleteScanInParams,
  AddScanInItemParams,
  AddScanInItemBody,
  DeleteScanInItemParams,
} from "@workspace/api-zod";

const router: IRouter = Router();

async function buildScanInResponse(scanIn: any) {
  const [material] = await db.select().from(materialsTable).where(eq(materialsTable.id, scanIn.materialId));
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, scanIn.userId));
  const items = await db.select().from(scanItemsTable).where(eq(scanItemsTable.scanInId, scanIn.id));

  return {
    id: scanIn.id,
    materialId: scanIn.materialId,
    materialName: material?.name ?? "Unknown",
    boxLabel: scanIn.boxLabel,
    status: scanIn.status,
    userId: scanIn.userId,
    userName: user?.username ?? "Unknown",
    qrCodeData: scanIn.qrCodeData ?? null,
    createdAt: scanIn.createdAt.toISOString(),
    completedAt: scanIn.completedAt ? scanIn.completedAt.toISOString() : null,
    items: items.map((i) => ({
      id: i.id,
      serialNumber: i.serialNumber,
      scanInId: i.scanInId ?? null,
      scanOutId: i.scanOutId ?? null,
      createdAt: i.createdAt.toISOString(),
    })),
  };
}

router.get("/scan-in", async (req, res): Promise<void> => {
  const params = ListScanInQueryParams.safeParse(req.query);
  const materialId = params.success && params.data.materialId ? Number(params.data.materialId) : undefined;

  let query = db.select().from(scanInTable);
  const scanIns = materialId
    ? await db.select().from(scanInTable).where(eq(scanInTable.materialId, materialId)).orderBy(scanInTable.createdAt)
    : await db.select().from(scanInTable).orderBy(scanInTable.createdAt);

  const results = await Promise.all(scanIns.map(buildScanInResponse));
  res.json(ListScanInResponse.parse(results));
});

router.post("/scan-in", async (req, res): Promise<void> => {
  const parsed = CreateScanInBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [material] = await db.select().from(materialsTable).where(eq(materialsTable.id, parsed.data.materialId));
  if (!material) {
    res.status(404).json({ error: "Material not found" });
    return;
  }

  // Clean up any abandoned "scanning" sessions from this user before creating a new one
  const abandonedSessions = await db
    .select()
    .from(scanInTable)
    .where(and(eq(scanInTable.userId, parsed.data.userId), eq(scanInTable.status, "scanning")));
  for (const s of abandonedSessions) {
    await db.delete(scanItemsTable).where(eq(scanItemsTable.scanInId, s.id));
    await db.delete(scanInTable).where(eq(scanInTable.id, s.id));
  }

  // Count ALL sessions (scanning by other users + completed) so concurrent users get unique sequential numbers.
  // This user's own abandoned sessions were deleted above, so they don't inflate the count.
  const allSessions = await db
    .select()
    .from(scanInTable)
    .where(eq(scanInTable.materialId, parsed.data.materialId));
  const seqNum = (allSessions.length + 1).toString().padStart(3, "0");
  const boxLabel = `${material.code}${seqNum}`;

  const [scanIn] = await db
    .insert(scanInTable)
    .values({
      materialId: parsed.data.materialId,
      boxLabel,
      status: "scanning",
      userId: parsed.data.userId,
    })
    .returning();

  const result = await buildScanInResponse(scanIn);
  res.status(201).json(result);
});

router.get("/scan-in/:id", async (req, res): Promise<void> => {
  const params = GetScanInParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [scanIn] = await db.select().from(scanInTable).where(eq(scanInTable.id, params.data.id));
  if (!scanIn) {
    res.status(404).json({ error: "ScanIn session not found" });
    return;
  }

  const result = await buildScanInResponse(scanIn);
  res.json(GetScanInResponse.parse(result));
});

router.patch("/scan-in/:id", async (req, res): Promise<void> => {
  const params = UpdateScanInParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const parsed = UpdateScanInBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const updateData: any = {};
  if (parsed.data.status) {
    updateData.status = parsed.data.status;
    if (parsed.data.status === "completed") {
      updateData.completedAt = new Date();
    }
  }
  if (parsed.data.qrCodeData != null) {
    updateData.qrCodeData = parsed.data.qrCodeData;
  }

  const [scanIn] = await db
    .update(scanInTable)
    .set(updateData)
    .where(eq(scanInTable.id, params.data.id))
    .returning();

  if (!scanIn) {
    res.status(404).json({ error: "ScanIn session not found" });
    return;
  }

  const result = await buildScanInResponse(scanIn);
  res.json(UpdateScanInResponse.parse(result));
});

router.delete("/scan-in/:id", async (req, res): Promise<void> => {
  const params = DeleteScanInParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  // Delete items first
  await db.delete(scanItemsTable).where(eq(scanItemsTable.scanInId, params.data.id));
  const [scanIn] = await db.delete(scanInTable).where(eq(scanInTable.id, params.data.id)).returning();
  if (!scanIn) {
    res.status(404).json({ error: "ScanIn session not found" });
    return;
  }
  res.sendStatus(204);
});

router.post("/scan-in/:id/items", async (req, res): Promise<void> => {
  const params = AddScanInItemParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const parsed = AddScanInItemBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { serialNumber } = parsed.data;

  // Check for duplicate
  const existing = await db.select().from(scanItemsTable).where(eq(scanItemsTable.serialNumber, serialNumber));
  if (existing.length > 0) {
    res.status(409).json({ error: "Duplicate serial number" });
    return;
  }

  const [item] = await db
    .insert(scanItemsTable)
    .values({ serialNumber, scanInId: params.data.id, scanOutId: null })
    .returning();

  res.status(201).json({
    id: item.id,
    serialNumber: item.serialNumber,
    scanInId: item.scanInId ?? null,
    scanOutId: item.scanOutId ?? null,
    createdAt: item.createdAt.toISOString(),
  });
});

router.delete("/scan-in/:id/items/:itemId", async (req, res): Promise<void> => {
  const params = DeleteScanInItemParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [item] = await db
    .delete(scanItemsTable)
    .where(and(eq(scanItemsTable.id, params.data.itemId), eq(scanItemsTable.scanInId, params.data.id)))
    .returning();

  if (!item) {
    res.status(404).json({ error: "Item not found" });
    return;
  }
  res.sendStatus(204);
});

export default router;
