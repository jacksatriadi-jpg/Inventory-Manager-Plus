#!/usr/bin/env node
// Sekali-jalan: pindahkan foto base64 lama (kas_transaksi.bukti_image &
// lembur_absensi.selfie_image) ke Google Drive akun Retur, subfolder "KAS GUDANG",
// lalu kosongkan kolom base64 + VACUUM supaya ruang Postgres/Disk STB terlepas.
// Jalankan DI STB: node artifacts/api-server/scripts/move-kas-photos-to-drive.cjs
"use strict";
const fs = require("fs");
const { Readable } = require("stream");
const { Pool } = require("pg");
const { google } = require("googleapis");

const envVar = (name) => {
  const sh = fs.readFileSync("/usr/local/bin/start-webapp.sh", "utf8");
  const m = new RegExp(`export ${name}="([^"]*)"`).exec(sh);
  if (!m) throw new Error(name + " tidak ditemukan di /usr/local/bin/start-webapp.sh");
  return m[1];
};

async function main() {
  const db = new Pool({ host: "localhost", user: "dewa", password: "Bali@123", database: "master_db" });
  const cfg = (await db.query("SELECT * FROM retur_gdrive_config LIMIT 1")).rows[0];
  if (!cfg || !cfg.refresh_token) throw new Error("retur_gdrive_config kosong — sambungkan akun Drive Retur lewat app dulu");
  if (!cfg.folder_id) throw new Error("folder root Drive Retur belum siap (folder_id null) — buka menu Retur sekali agar app menyiapkan folder");

  const auth = new google.auth.OAuth2(envVar("GOOGLE_CLIENT_ID"), envVar("GOOGLE_CLIENT_SECRET"));
  auth.setCredentials({
    access_token: cfg.access_token ?? undefined,
    refresh_token: cfg.refresh_token,
    expiry_date: cfg.token_expiry ? new Date(cfg.token_expiry).getTime() : undefined,
  });
  const { token } = await auth.getAccessToken();
  if (token && token !== cfg.access_token) {
    await db.query(
      "UPDATE retur_gdrive_config SET access_token=$1, refresh_token=$2, token_expiry=$3, updated_at=now() WHERE id=$4",
      [token, auth.credentials.refresh_token ?? cfg.refresh_token, auth.credentials.expiry_date ? new Date(auth.credentials.expiry_date) : null, cfg.id],
    );
  }
  const drive = google.drive({ version: "v3", auth });

  const child = await drive.files.list({
    q: `mimeType='application/vnd.google-apps.folder' and name='KAS GUDANG' and parents in '${cfg.folder_id}' and trashed=false`,
    fields: "files(id)",
  });
  const folderId = (child.data.files ?? [])[0]?.id ??
    (await drive.files.create({
      requestBody: { name: "KAS GUDANG", mimeType: "application/vnd.google-apps.folder", parents: [cfg.folder_id] },
      fields: "id",
    })).data.id;
  if (!folderId) throw new Error("gagal menyiapkan folder 'KAS GUDANG'");

  const put = async (dataUrl, name) => {
    const m = /^data:([^;,]+);base64,(.+)$/s.exec(dataUrl);
    if (!m) throw new Error("format data URL tidak valid");
    const res = await drive.files.create({
      requestBody: { name, parents: [folderId] },
      media: { mimeType: m[1], body: Readable.from(Buffer.from(m[2], "base64")) },
      fields: "id",
    });
    if (!res.data.id) throw new Error("upload tidak mengembalikan id");
    return res.data.id;
  };

  let moved = 0, failed = 0;
  const jobs = [];
  for (const row of (await db.query("SELECT id, bukti_image FROM kas_transaksi WHERE bukti_image IS NOT NULL AND bukti_file_id IS NULL ORDER BY id")).rows) {
    jobs.push({ table: "kas_transaksi", col: ["bukti_file_id", "bukti_image"], id: row.id, dataUrl: row.bukti_image, name: `KAS-BUKTI-${row.id}.jpg` });
  }
  for (const row of (await db.query("SELECT id, selfie_image FROM lembur_absensi WHERE selfie_image IS NOT NULL AND selfie_file_id IS NULL ORDER BY id")).rows) {
    jobs.push({ table: "lembur_absensi", col: ["selfie_file_id", "selfie_image"], id: row.id, dataUrl: row.selfie_image, name: `KAS-LEMBUR-${row.id}.jpg` });
  }
  for (const j of jobs) {
    try {
      const fileId = await put(j.dataUrl, j.name);
      await db.query(`UPDATE ${j.table} SET ${j.col[0]}=$1, ${j.col[1]}=NULL WHERE id=$2`, [fileId, j.id]);
      moved++;
      console.log(`${j.table} #${j.id} -> Drive ${fileId}`);
    } catch (e) {
      failed++;
      console.error(`${j.table} #${j.id} GAGAL: ${e.message}`);
    }
  }
  if (moved) {
    await db.query("VACUUM (FULL) kas_transaksi").catch((e) => console.warn("VACUUM kas:", e.message));
    await db.query("VACUUM (FULL) lembur_absensi").catch((e) => console.warn("VACUUM lembur:", e.message));
  }
  console.log(`SELESAI moved=${moved} failed=${failed}`);
  await db.end();
  if (failed) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
