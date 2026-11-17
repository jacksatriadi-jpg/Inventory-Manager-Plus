import { Router } from "express";
import type { IRouter } from "express";
import { db, materialsTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import {
  ListMaterialsResponse,
  CreateMaterialBody,
  GetMaterialParams,
  GetMaterialResponse,
  UpdateMaterialParams,
  UpdateMaterialBody,
  UpdateMaterialResponse,
  DeleteMaterialParams,
} from "@workspace/api-zod";

const router: IRouter = Router();

function materialToJson(m: any) {
  return {
    id: m.id,
    name: m.name,
    code: m.code,
    description: m.description ?? null,
    kategori: m.kategori ?? "scan",
    createdAt: m.createdAt.toISOString(),
  };
}

router.get("/materials", async (req, res): Promise<void> => {
  // kategori 'retur' = material khusus menu retur — tersembunyi dari material master/scan.
  const includeRetur = req.query.includeRetur === "1";
  const materials = await db.select().from(materialsTable)
    .where(includeRetur ? undefined : sql`kategori IS DISTINCT FROM 'retur'`)
    .orderBy(materialsTable.createdAt);
  res.json(ListMaterialsResponse.parse(materials.map(materialToJson)));
});

router.post("/materials", async (req, res): Promise<void> => {
  const parsed = CreateMaterialBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [material] = await db.insert(materialsTable).values(parsed.data).returning();
  res.status(201).json(materialToJson(material));
});

router.get("/materials/:id", async (req, res): Promise<void> => {
  const params = GetMaterialParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [material] = await db.select().from(materialsTable).where(eq(materialsTable.id, params.data.id));
  if (!material) {
    res.status(404).json({ error: "Material not found" });
    return;
  }
  res.json(GetMaterialResponse.parse(materialToJson(material)));
});

router.patch("/materials/:id", async (req, res): Promise<void> => {
  const params = UpdateMaterialParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const parsed = UpdateMaterialBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [material] = await db
    .update(materialsTable)
    .set(parsed.data)
    .where(eq(materialsTable.id, params.data.id))
    .returning();

  if (!material) {
    res.status(404).json({ error: "Material not found" });
    return;
  }
  res.json(UpdateMaterialResponse.parse(materialToJson(material)));
});

router.delete("/materials/:id", async (req, res): Promise<void> => {
  const params = DeleteMaterialParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [material] = await db.delete(materialsTable).where(eq(materialsTable.id, params.data.id)).returning();
  if (!material) {
    res.status(404).json({ error: "Material not found" });
    return;
  }
  res.sendStatus(204);
});

export default router;
