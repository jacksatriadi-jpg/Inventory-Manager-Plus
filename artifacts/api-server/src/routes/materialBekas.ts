import { Router } from "express";
import type { IRouter } from "express";
import { db, materialBekasGaransiTable, materialBekasUsulHapusTable, usersTable } from "@workspace/db";
import { eq, desc, ilike, and } from "drizzle-orm";

const router: IRouter = Router();

function parseSN(sn: string) {
  // Pola: MMYY + 2 karakter (bisa huruf atau angka)
  // Contoh: PLN0325000004806110246E11146 → "1024" + "6E" → Bulan 10, Tahun 2024
  const match = sn.match(/(\d{4})\d./);
  if (!match) return null;

  const dateStr = match[1];
  const month = parseInt(dateStr.slice(0, 2));
  const yearShort = parseInt(dateStr.slice(2, 4));

  if (month < 1 || month > 12) return null;

  const year = yearShort < 50 ? 2000 + yearShort : 1900 + yearShort;
  return { tahun: year, bulan: month };
}

function classifySN(sn: string) {
  const parsed = parseSN(sn);
  if (!parsed) return { valid: false, reason: "Format SN tidak dikenali" };

  if (parsed.tahun > 2021) {
    return { valid: true, target: "garansi", serialNumber: sn, tahun: parsed.tahun, bulan: parsed.bulan };
  }

  return { valid: true, target: "usul_hapus", serialNumber: sn, tahun: parsed.tahun, bulan: parsed.bulan };
}

function garansiToJson(g: any, userName?: string) {
  return {
    id: g.id,
    serialNumber: g.serialNumber,
    materialName: g.materialName,
    merk: g.merk,
    tahun: g.tahun,
    bulan: g.bulan,
    userId: g.userId,
    userName: userName ?? null,
    createdAt: g.createdAt.toISOString(),
  };
}

function usulHapusToJson(u: any, userName?: string) {
  return {
    id: u.id,
    serialNumber: u.serialNumber,
    materialName: u.materialName,
    merk: u.merk,
    tahun: u.tahun,
    bulan: u.bulan,
    userId: u.userId,
    userName: userName ?? null,
    createdAt: u.createdAt.toISOString(),
  };
}

// GET garansi records with optional filters
router.get("/material-bekas/garansi", async (req, res): Promise<void> => {
  const { search, from, to } = req.query as { search?: string; from?: string; to?: string };
  
  let conditions = [];
  if (search) {
    conditions.push(
      and(
        ilike(materialBekasGaransiTable.serialNumber, `%${search}%`),
        ilike(materialBekasGaransiTable.materialName, `%${search}%`),
        ilike(materialBekasGaransiTable.merk, `%${search}%`),
      ),
    );
  }
  if (from) {
    conditions.push(eq(materialBekasGaransiTable.createdAt, new Date(from)));
  }
  if (to) {
    conditions.push(eq(materialBekasGaransiTable.createdAt, new Date(to)));
  }

  let rows;
  if (conditions.length > 0) {
    rows = await db.select().from(materialBekasGaransiTable).where(and(...conditions)).orderBy(desc(materialBekasGaransiTable.createdAt));
  } else {
    rows = await db.select().from(materialBekasGaransiTable).orderBy(desc(materialBekasGaransiTable.createdAt));
  }

  const results = await Promise.all(rows.map(async (r) => {
    const [usr] = await db.select().from(usersTable).where(eq(usersTable.id, r.userId));
    return garansiToJson(r, usr?.username);
  }));
  res.json(results);
});

// GET usul hapus records with optional filters
router.get("/material-bekas/usul-hapus", async (req, res): Promise<void> => {
  const { search, from, to } = req.query as { search?: string; from?: string; to?: string };
  
  let conditions = [];
  if (search) {
    conditions.push(
      and(
        ilike(materialBekasUsulHapusTable.serialNumber, `%${search}%`),
        ilike(materialBekasUsulHapusTable.materialName, `%${search}%`),
        ilike(materialBekasUsulHapusTable.merk, `%${search}%`),
      ),
    );
  }
  if (from) {
    conditions.push(eq(materialBekasUsulHapusTable.createdAt, new Date(from)));
  }
  if (to) {
    conditions.push(eq(materialBekasUsulHapusTable.createdAt, new Date(to)));
  }

  let rows;
  if (conditions.length > 0) {
    rows = await db.select().from(materialBekasUsulHapusTable).where(and(...conditions)).orderBy(desc(materialBekasUsulHapusTable.createdAt));
  } else {
    rows = await db.select().from(materialBekasUsulHapusTable).orderBy(desc(materialBekasUsulHapusTable.createdAt));
  }

  const results = await Promise.all(rows.map(async (r) => {
    const [usr] = await db.select().from(usersTable).where(eq(usersTable.id, r.userId));
    return usulHapusToJson(r, usr?.username);
  }));
  res.json(results);
});

// POST scan SN and classify
router.post("/material-bekas/scan", async (req, res): Promise<void> => {
  const { serialNumber, materialName, merk, userId } = req.body ?? {};

  if (!serialNumber || typeof serialNumber !== "string" || serialNumber.trim() === "") {
    res.status(400).json({ error: "Serial number harus diisi" });
    return;
  }

  if (!materialName || typeof materialName !== "string" || materialName.trim() === "") {
    res.status(400).json({ error: "Nama material harus diisi" });
    return;
  }

  if (!Number.isInteger(userId) || userId <= 0) {
    res.status(400).json({ error: "User ID tidak valid" });
    return;
  }

  const sn = serialNumber.trim();

  const [existingGaransi] = await db.select().from(materialBekasGaransiTable).where(eq(materialBekasGaransiTable.serialNumber, sn));
  const [existingUsul] = await db.select().from(materialBekasUsulHapusTable).where(eq(materialBekasUsulHapusTable.serialNumber, sn));

  if (existingGaransi) {
    res.status(409).json({ error: "SN sudah ada di Material Garansi" });
    return;
  }

  if (existingUsul) {
    res.status(409).json({ error: "SN sudah ada di Material Usul Hapus" });
    return;
  }

  const classification = classifySN(sn);

  if (!classification.valid) {
    res.status(400).json({ error: classification.reason });
    return;
  }

  let record;

  if (classification.target === "garansi") {
    [record] = await db.insert(materialBekasGaransiTable).values({
      serialNumber: classification.serialNumber,
      materialName: materialName.trim(),
      merk: (merk?.trim() || "").trim(),
      tahun: classification.tahun,
      bulan: classification.bulan,
      userId,
    }).returning();
    res.status(201).json({
      target: "garansi",
      message: `Material masuk ke Material Garansi (Tahun ${classification.tahun} > 2021)`,
      record: garansiToJson(record),
    });
  } else {
    [record] = await db.insert(materialBekasUsulHapusTable).values({
      serialNumber: classification.serialNumber,
      materialName: materialName.trim(),
      merk: (merk?.trim() || "").trim(),
      tahun: classification.tahun,
      bulan: classification.bulan,
      userId,
    }).returning();
    res.status(201).json({
      target: "usul_hapus",
      message: `Material masuk ke Material Usul Hapus (Tahun ${classification.tahun} ≤ 2021)`,
      record: usulHapusToJson(record),
    });
  }
});

router.delete("/material-bekas/garansi/:id", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "ID tidak valid" }); return; }
  const [record] = await db.delete(materialBekasGaransiTable).where(eq(materialBekasGaransiTable.id, id)).returning();
  if (!record) { res.status(404).json({ error: "Data tidak ditemukan" }); return; }
  res.sendStatus(204);
});

router.delete("/material-bekas/usul-hapus/:id", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "ID tidak valid" }); return; }
  const [record] = await db.delete(materialBekasUsulHapusTable).where(eq(materialBekasUsulHapusTable.id, id)).returning();
  if (!record) { res.status(404).json({ error: "Data tidak ditemukan" }); return; }
  res.sendStatus(204);
});

export default router;
