import { Router } from "express";
import type { IRouter } from "express";
import { db, materialBekasGaransiTable, materialBekasUsulHapusTable, usersTable } from "@workspace/db";
import { eq, desc } from "drizzle-orm";

const router: IRouter = Router();

function parseSN(sn: string) {
  // Cari huruf terakhir, ambil 2 digit sebelum huruf tersebut sebagai tahun
  // Contoh: PLN0325000005402510222Z00630 -> huruf terakhir Z, digit sebelum Z adalah 1022 -> tahun = 22 -> 2022
  const match = sn.match(/(\d{2})[A-Za-z][^0-9]*$/);
  if (!match) return null;

  const yearShort = parseInt(match[1]);
  const year = yearShort >= 0 && yearShort <= 99 ? (yearShort < 50 ? 2000 + yearShort : 1900 + yearShort) : null;

  // Ambil bulan dari 2 digit sebelum tahun
  const monthMatch = sn.match(/(\d{2})(\d{2})[A-Za-z][^0-9]*$/);
  const month = monthMatch ? parseInt(monthMatch[1]) : null;

  if (year === null || month === null || month < 1 || month > 12) return null;

  return { tahun: year, bulan: month };
}

function classifySN(sn: string) {
  const parsed = parseSN(sn);
  if (!parsed) return { valid: false, reason: "Format SN tidak dikenali" };

  if (parsed.tahun < 2021) {
    return { valid: true, target: "usul_hapus", serialNumber: sn, tahun: parsed.tahun, bulan: parsed.bulan };
  }

  return { valid: true, target: "garansi", serialNumber: sn, tahun: parsed.tahun, bulan: parsed.bulan };
}

function garansiToJson(g: any, userName?: string) {
  return {
    id: g.id,
    serialNumber: g.serialNumber,
    materialName: g.materialName,
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
    tahun: u.tahun,
    bulan: u.bulan,
    userId: u.userId,
    userName: userName ?? null,
    createdAt: u.createdAt.toISOString(),
  };
}

// GET all garansi records
router.get("/material-bekas/garansi", async (req, res): Promise<void> => {
  const rows = await db.select().from(materialBekasGaransiTable).orderBy(desc(materialBekasGaransiTable.createdAt));
  const results = await Promise.all(rows.map(async (r) => {
    const [usr] = await db.select().from(usersTable).where(eq(usersTable.id, r.userId));
    return garansiToJson(r, usr?.username);
  }));
  res.json(results);
});

// GET all usul hapus records
router.get("/material-bekas/usul-hapus", async (req, res): Promise<void> => {
  const rows = await db.select().from(materialBekasUsulHapusTable).orderBy(desc(materialBekasUsulHapusTable.createdAt));
  const results = await Promise.all(rows.map(async (r) => {
    const [usr] = await db.select().from(usersTable).where(eq(usersTable.id, r.userId));
    return usulHapusToJson(r, usr?.username);
  }));
  res.json(results);
});

// POST scan SN and classify
router.post("/material-bekas/scan", async (req, res): Promise<void> => {
  const { serialNumber, materialName, userId } = req.body ?? {};

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

  const classification = classifySN(serialNumber.trim());

  if (!classification.valid) {
    res.status(400).json({ error: classification.reason });
    return;
  }

  let record;

  if (classification.target === "garansi") {
    [record] = await db.insert(materialBekasGaransiTable).values({
      serialNumber: classification.serialNumber,
      materialName: materialName.trim(),
      tahun: classification.tahun,
      bulan: classification.bulan,
      userId,
    }).returning();
    res.status(201).json({
      target: "garansi",
      message: `Material masuk ke Material Garansi (Tahun ${classification.tahun})`,
      record: garansiToJson(record),
    });
  } else {
    [record] = await db.insert(materialBekasUsulHapusTable).values({
      serialNumber: classification.serialNumber,
      materialName: materialName.trim(),
      tahun: classification.tahun,
      bulan: classification.bulan,
      userId,
    }).returning();
    res.status(201).json({
      target: "usul_hapus",
      message: `Material masuk ke Material Usul Hapus (Tahun ${classification.tahun} < 2021)`,
      record: usulHapusToJson(record),
    });
  }
});

// DELETE garansi record
router.delete("/material-bekas/garansi/:id", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "ID tidak valid" }); return; }
  const [record] = await db.delete(materialBekasGaransiTable).where(eq(materialBekasGaransiTable.id, id)).returning();
  if (!record) { res.status(404).json({ error: "Data tidak ditemukan" }); return; }
  res.sendStatus(204);
});

// DELETE usul hapus record
router.delete("/material-bekas/usul-hapus/:id", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "ID tidak valid" }); return; }
  const [record] = await db.delete(materialBekasUsulHapusTable).where(eq(materialBekasUsulHapusTable.id, id)).returning();
  if (!record) { res.status(404).json({ error: "Data tidak ditemukan" }); return; }
  res.sendStatus(204);
});

export default router;
