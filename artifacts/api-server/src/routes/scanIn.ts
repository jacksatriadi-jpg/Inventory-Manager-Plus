import { Router } from "express";
import type { IRouter } from "express";
import { db, scanInTable, scanItemsTable, materialsTable, usersTable } from "@workspace/db";
import { and, eq, sql } from "drizzle-orm";
import { logger } from "../lib/logger";
import { requireActor, requireScanWrite } from "../lib/request-auth";
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

// Nomor urut label box diambil dari SUFFIX ANGKA tertinggi pada label existing untuk
// material ini (bukan jumlah sesi): stabil walau ada sesi dibatalkan/terhapus, dan
// label baru tidak menabrak label lama yang sudah dobel. Data lama tidak diubah.
async function nextBoxLabelFor(materialId: number, code: string): Promise<string> {
  const rows = await db
    .select({ boxLabel: scanInTable.boxLabel })
    .from(scanInTable)
    .where(eq(scanInTable.materialId, materialId));
  let maxSeq = 0;
  for (const row of rows) {
    if (typeof row.boxLabel === "string" && row.boxLabel.startsWith(code)) {
      const n = parseInt(row.boxLabel.slice(code.length), 10);
      if (Number.isFinite(n) && n > maxSeq) maxSeq = n;
    }
  }
  return `${code}${String(maxSeq + 1).padStart(3, "0")}`;
}

router.get("/scan-in", async (req, res): Promise<void> => {
  if (!(await requireActor(req, res))) return;
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
  const actor = await requireScanWrite(req, res);
  if (!actor) return;
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
    .where(and(eq(scanInTable.userId, actor.id), eq(scanInTable.status, "scanning")));
  for (const s of abandonedSessions) {
    await db.delete(scanItemsTable).where(eq(scanItemsTable.scanInId, s.id));
    await db.delete(scanInTable).where(eq(scanInTable.id, s.id));
  }

  const boxLabel = await nextBoxLabelFor(parsed.data.materialId, material.code);

  const [scanIn] = await db
    .insert(scanInTable)
    .values({
      materialId: parsed.data.materialId,
      boxLabel,
      status: "scanning",
      userId: actor.id, // selalu dari token — tak bisa impersonasi operator lain
    })
    .returning();

  const result = await buildScanInResponse(scanIn);
  res.status(201).json(result);
});

router.get("/scan-in/:id", async (req, res): Promise<void> => {
  if (!(await requireActor(req, res))) return;
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
  if (!(await requireScanWrite(req, res))) return;
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
      // Guard sisi server: box "completed" tanpa item membuat riwayat kosong & label terbuang.
      const itemsNow = await db.select({ id: scanItemsTable.id }).from(scanItemsTable).where(eq(scanItemsTable.scanInId, params.data.id));
      if (itemsNow.length === 0) { res.status(400).json({ error: "Sesi tidak memiliki item — butuh minimal 1 serial untuk diselesaikan" }); return; }
      updateData.completedAt = new Date();
    }
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

  // SN yang SUDAH discan-out tidak boleh ikut hilang: item dispatch hanya di-LEPAS
  // (scan_in_id = NULL) supaya riwayat keluar tetap utuh; hanya item yang belum pernah
  // keluar yang dihapus. Satu transaksi utuh (dulu: items duluan, sesi belakangan).
  if (!(await requireScanWrite(req, res))) return;
  let deleted = false;
  try {
    deleted = await db.transaction(async (tx) => {
      const [exists] = await tx.select({ id: scanInTable.id }).from(scanInTable).where(eq(scanInTable.id, params.data.id));
      if (!exists) return false;
      await tx.update(scanItemsTable).set({ scanInId: null })
        .where(and(eq(scanItemsTable.scanInId, params.data.id), sql`${scanItemsTable.scanOutId} is not null`));
      await tx.delete(scanItemsTable)
        .where(and(eq(scanItemsTable.scanInId, params.data.id), sql`${scanItemsTable.scanOutId} is null`));
      await tx.delete(scanInTable).where(eq(scanInTable.id, params.data.id));
      return true;
    });
  } catch (err) {
    logger.error({ err }, "scan-in: gagal menghapus sesi");
    res.status(500).json({ error: "Gagal menghapus sesi" });
    return;
  }
  if (!deleted) {
    res.status(404).json({ error: "ScanIn session not found" });
    return;
  }
  res.sendStatus(204);
});

router.post("/scan-in/:id/complete-and-continue", async (req, res): Promise<void> => {
  if (!(await requireScanWrite(req, res))) return;
  const params = UpdateScanInParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [currentSession] = await db.select().from(scanInTable).where(eq(scanInTable.id, params.data.id));
  if (!currentSession) {
    res.status(404).json({ error: "ScanIn session not found" });
    return;
  }

  if (currentSession.status !== "scanning") {
    res.status(400).json({ error: "Session is not in scanning state" });
    return;
  }

  const itemsNow = await db.select({ id: scanItemsTable.id }).from(scanItemsTable).where(eq(scanItemsTable.scanInId, params.data.id));
  if (itemsNow.length === 0) {
    res.status(400).json({ error: "Sesi tidak memiliki item — scan minimal 1 serial sebelum lanjut" });
    return;
  }

  try {
    // Complete the current session
    await db
      .update(scanInTable)
      .set({ status: "completed", completedAt: new Date() })
      .where(eq(scanInTable.id, params.data.id));

    // Get material info for box label generation
    const [material] = await db.select().from(materialsTable).where(eq(materialsTable.id, currentSession.materialId));
    if (!material) {
      res.status(404).json({ error: "Material not found" });
      return;
    }

    const boxLabel = await nextBoxLabelFor(currentSession.materialId, material.code);

    // Create new session with same material and user
    const [newScanIn] = await db
      .insert(scanInTable)
      .values({
        materialId: currentSession.materialId,
        boxLabel,
        status: "scanning",
        userId: currentSession.userId,
      })
      .returning();

    const result = await buildScanInResponse(newScanIn);
    res.status(201).json(result);
  } catch {
    res.status(500).json({ error: "Failed to complete and continue session" });
  }
});

router.post("/scan-in/:id/items", async (req, res): Promise<void> => {
  if (!(await requireScanWrite(req, res))) return;
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
  if (!(await requireScanWrite(req, res))) return;
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
