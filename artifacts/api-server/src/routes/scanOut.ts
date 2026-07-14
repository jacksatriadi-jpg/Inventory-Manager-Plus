import { Router } from "express";
import type { IRouter } from "express";
import { db, scanOutTable, scanItemsTable, scanInTable, materialsTable, usersTable } from "@workspace/db";
import { eq, and, isNull } from "drizzle-orm";
import {
  ListScanOutQueryParams,
  ListScanOutResponse,
  CreateScanOutBody,
  GetScanOutParams,
  GetScanOutResponse,
  DeleteScanOutParams,
  AddScanOutItemParams,
  AddScanOutItemBody,
  AddScanOutItemsBulkParams,
  AddScanOutItemsBulkBody,
} from "@workspace/api-zod";

const router: IRouter = Router();

async function buildScanOutResponse(scanOut: any) {
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, scanOut.userId));
  const items = await db.select().from(scanItemsTable).where(eq(scanItemsTable.scanOutId, scanOut.id));

  return {
    id: scanOut.id,
    userId: scanOut.userId,
    userName: user?.username ?? "Unknown",
    createdAt: scanOut.createdAt.toISOString(),
    items: items.map((i) => ({
      id: i.id,
      serialNumber: i.serialNumber,
      scanInId: i.scanInId ?? null,
      scanOutId: i.scanOutId ?? null,
      createdAt: i.createdAt.toISOString(),
    })),
  };
}

router.get("/scan-out", async (req, res): Promise<void> => {
  const params = ListScanOutQueryParams.safeParse(req.query);
  const materialId = params.success && params.data.materialId ? Number(params.data.materialId) : undefined;

  let scanOuts;
  if (materialId) {
    // Filter by material through scan_items -> scan_in -> material
    const allScanOuts = await db.select().from(scanOutTable).orderBy(scanOutTable.createdAt);
    const filtered = [];
    for (const so of allScanOuts) {
      const items = await db.select().from(scanItemsTable).where(eq(scanItemsTable.scanOutId, so.id));
      for (const item of items) {
        if (item.scanInId) {
          const [si] = await db.select().from(scanInTable).where(eq(scanInTable.id, item.scanInId));
          if (si && si.materialId === materialId) {
            filtered.push(so);
            break;
          }
        }
      }
    }
    scanOuts = filtered;
  } else {
    scanOuts = await db.select().from(scanOutTable).orderBy(scanOutTable.createdAt);
  }

  const results = await Promise.all(scanOuts.map(buildScanOutResponse));
  res.json(ListScanOutResponse.parse(results));
});

router.post("/scan-out", async (req, res): Promise<void> => {
  const parsed = CreateScanOutBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [scanOut] = await db.insert(scanOutTable).values({ userId: parsed.data.userId }).returning();
  const result = await buildScanOutResponse(scanOut);
  res.status(201).json(result);
});

router.get("/scan-out/:id", async (req, res): Promise<void> => {
  const params = GetScanOutParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [scanOut] = await db.select().from(scanOutTable).where(eq(scanOutTable.id, params.data.id));
  if (!scanOut) {
    res.status(404).json({ error: "ScanOut session not found" });
    return;
  }

  const result = await buildScanOutResponse(scanOut);
  res.json(GetScanOutResponse.parse(result));
});

router.delete("/scan-out/:id", async (req, res): Promise<void> => {
  const params = DeleteScanOutParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  // Unlink items from this scan-out (set scanOutId to null)
  await db.update(scanItemsTable).set({ scanOutId: null }).where(eq(scanItemsTable.scanOutId, params.data.id));
  const [scanOut] = await db.delete(scanOutTable).where(eq(scanOutTable.id, params.data.id)).returning();
  if (!scanOut) {
    res.status(404).json({ error: "ScanOut session not found" });
    return;
  }
  res.sendStatus(204);
});

router.post("/scan-out/:id/items", async (req, res): Promise<void> => {
  const params = AddScanOutItemParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const parsed = AddScanOutItemBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  // The qrData may contain multiple serial numbers (one per line) from the combined QR
  // We process each serial number in the QR data
  const qrData = parsed.data.qrData.trim();
  const serialNumbers = qrData.split("\n").map((s: string) => s.trim()).filter((s: string) => s.length > 0);

  if (serialNumbers.length === 0) {
    res.status(400).json({ error: "No serial numbers found in QR data" });
    return;
  }

  const processedItems = [];
  for (const sn of serialNumbers) {
    // Find the item in scan_in
    const [item] = await db.select().from(scanItemsTable).where(eq(scanItemsTable.serialNumber, sn));
    if (!item) {
      res.status(404).json({ error: `Serial number not found in stock: ${sn}` });
      return;
    }
    if (item.scanOutId != null) {
      res.status(409).json({ error: `Serial number already scanned out: ${sn}` });
      return;
    }

    const [updated] = await db
      .update(scanItemsTable)
      .set({ scanOutId: params.data.id })
      .where(eq(scanItemsTable.serialNumber, sn))
      .returning();

    processedItems.push({
      id: updated.id,
      serialNumber: updated.serialNumber,
      scanInId: updated.scanInId ?? null,
      scanOutId: updated.scanOutId ?? null,
      createdAt: updated.createdAt.toISOString(),
    });
  }

  // Return the first processed item (or all — API only returns one ScanItem per call)
  res.status(201).json(processedItems[0]);
});

// Bulk variant used by "Scan Keluar" triggered from the Riwayat page: the
// caller selects a batch of history rows (potentially hundreds of serials
// across many boxes). Unlike the single-item endpoint above, unknown or
// already-dispatched serials are skipped and reported back rather than
// aborting the whole batch — a stale/partial selection from history is
// expected, not an error case. The whole batch is applied atomically.
router.post("/scan-out/:id/items/bulk", async (req, res): Promise<void> => {
  const params = AddScanOutItemsBulkParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const parsed = AddScanOutItemsBulkBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const serialNumbers = [...new Set(parsed.data.serialNumbers.map((s) => s.trim()).filter((s) => s.length > 0))];
  if (serialNumbers.length === 0) {
    res.status(400).json({ error: "No serial numbers provided" });
    return;
  }

  const [scanOut] = await db.select().from(scanOutTable).where(eq(scanOutTable.id, params.data.id));
  if (!scanOut) {
    res.status(404).json({ error: "ScanOut session not found" });
    return;
  }

  const notFound: string[] = [];
  const alreadyOut: string[] = [];
  let scannedCount = 0;

  await db.transaction(async (tx) => {
    for (const sn of serialNumbers) {
      const [item] = await tx.select().from(scanItemsTable).where(eq(scanItemsTable.serialNumber, sn));
      if (!item) {
        notFound.push(sn);
        continue;
      }
      if (item.scanOutId != null) {
        alreadyOut.push(sn);
        continue;
      }
      await tx.update(scanItemsTable).set({ scanOutId: params.data.id }).where(eq(scanItemsTable.serialNumber, sn));
      scannedCount++;
    }
  });

  res.status(201).json({ scannedCount, alreadyOut, notFound });
});

export default router;
