import { useState, useMemo } from "react";
import { useListHistory, useDeleteHistory, useGetMaterialStats } from "@workspace/api-client-react";
import { useAuth } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { History, FileDown, Printer, Trash2, ArrowDownRight, ArrowUpRight, Loader2, PackagePlus, PackageMinus, Search, X, ChevronLeft, ChevronRight, CalendarRange, Tag, Package, Layers } from "lucide-react";
import { LabelPreviewDialog } from "@/components/label-preview-dialog";
import { type LabelData, printBulkLabels } from "@/lib/print-label";
import { Input } from "@/components/ui/input";
import { format } from "date-fns";
import * as XLSX from "xlsx";
import jsPDF from "jspdf";
import QRCode from "qrcode";
import { useToast } from "@/hooks/use-toast";

const PAGE_SIZE_OPTIONS = [
  { label: "16 / halaman",  value: 16  },
  { label: "32 / halaman",  value: 32  },
  { label: "50 / halaman",  value: 50  },
  { label: "100 / halaman", value: 100 },
  { label: "Semua",         value: 0   },
];

export default function Riwayat() {
  const { user, isGuest } = useAuth();
  const { toast } = useToast();
  const [filterType,       setFilterType]       = useState<"all" | "in" | "out">("all");
  const [filterSource,     setFilterSource]     = useState<"all" | "scan" | "non-scan">("all");
  const [filterMaterialId, setFilterMaterialId] = useState<string>("all");
  const [filterFrom,       setFilterFrom]       = useState("");
  const [filterTo,         setFilterTo]         = useState("");
  const [searchQuery,      setSearchQuery]       = useState("");
  const [selectedIds,      setSelectedIds]       = useState<Set<number>>(new Set());
  const [pageSize,         setPageSize]         = useState<number>(16);
  const [currentPage,      setCurrentPage]      = useState(1);
  const [labelPreview,       setLabelPreview]       = useState<LabelData | null>(null);
  const [filterActiveStock,  setFilterActiveStock]  = useState(false);

  const hasDateFilter = filterFrom !== "" || filterTo !== "";

  // Material stats for "in-stock" filter dropdown
  const { data: materialStats } = useGetMaterialStats();
  const inStockMaterials = useMemo(
    () => (materialStats ?? []).filter(m => m.currentStock > 0).sort((a, b) => a.materialName.localeCompare(b.materialName)),
    [materialStats],
  );
  // Set of materialIds that currently have active stock
  const activeStockIds = useMemo(
    () => new Set(inStockMaterials.map(m => m.materialId)),
    [inStockMaterials],
  );

  const { data: history, isLoading, refetch } = useListHistory({
    type:       filterType === "all" ? undefined : filterType,
    materialId: filterMaterialId !== "all" ? Number(filterMaterialId) : undefined,
    from:       filterFrom || undefined,
    to:         filterTo   ? filterTo + "T23:59:59" : undefined,
  });

  const deleteHistoryMutation = useDeleteHistory();

  const filteredHistory = useMemo(() => {
    if (!history) return [];
    if (filterSource === "all") return history;
    return history.filter(h => h.source === filterSource);
  }, [history, filterSource]);

  const searchedHistory = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    let result = filteredHistory;
    if (q) {
      result = result.filter(h =>
        (h.materialCode ?? "").toLowerCase().includes(q) ||
        (h.materialName ?? "").toLowerCase().includes(q) ||
        (h.boxLabel     ?? "").toLowerCase().includes(q) ||
        (h.userName     ?? "").toLowerCase().includes(q),
      );
    }
    if (filterActiveStock) {
      result = result.filter(h => h.materialId != null && activeStockIds.has(h.materialId));
    }
    return result;
  }, [filteredHistory, searchQuery, filterActiveStock, activeStockIds]);

  const totalPages = pageSize === 0 ? 1 : Math.max(1, Math.ceil(searchedHistory.length / pageSize));
  const safePage   = Math.min(currentPage, totalPages);

  const pagedHistory = useMemo(() => {
    if (pageSize === 0) return searchedHistory;
    const start = (safePage - 1) * pageSize;
    return searchedHistory.slice(start, start + pageSize);
  }, [searchedHistory, pageSize, safePage]);

  const effectiveRecords = useMemo(() => {
    if (selectedIds.size === 0) return searchedHistory;
    return searchedHistory.filter(h => selectedIds.has(h.id));
  }, [searchedHistory, selectedIds]);

  const allIds      = useMemo(() => searchedHistory.map(h => h.id), [searchedHistory]);
  const allSelected = allIds.length > 0 && allIds.every(id => selectedIds.has(id));
  const someSelected = selectedIds.size > 0 && !allSelected;

  const resetPage = () => setCurrentPage(1);

  const toggleAll = () => {
    if (allSelected) setSelectedIds(new Set());
    else             setSelectedIds(new Set(allIds));
  };

  const toggleOne = (id: number) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const selectionLabel = selectedIds.size > 0
    ? `${selectedIds.size} dipilih`
    : `Semua (${searchedHistory.length})`;

  // ── export handlers ────────────────────────────────────────────────────────

  const handleExportXLSX = () => {
    if (effectiveRecords.length === 0) {
      toast({ title: "Tidak ada data", variant: "destructive" }); return;
    }
    const rows: object[] = [];
    effectiveRecords.forEach(h => {
      const isNonScan = h.source === "non-scan";
      const count  = isNonScan ? (h.count ?? 0) : h.serialNumbers.length;
      const satuan = isNonScan ? (h.satuan ?? "") : "";
      if (isNonScan) {
        rows.push({
          Tipe: h.type === "in" ? "Material Masuk" : "Material Keluar",
          Sumber: "Non-Scan",
          Tanggal: format(new Date(h.createdAt), "yyyy-MM-dd HH:mm:ss"),
          Material: h.materialName || "-",
          BoxLabel: "-",
          Jumlah: `${count} ${satuan}`,
          Operator: h.userName,
          SerialNumber: "-",
        });
      } else if (h.serialNumbers.length === 0) {
        rows.push({
          Tipe: h.type === "in" ? "Scan Masuk" : "Scan Keluar",
          Sumber: "Scan",
          Tanggal: format(new Date(h.createdAt), "yyyy-MM-dd HH:mm:ss"),
          Material: h.materialName || "-",
          BoxLabel: h.boxLabel || "-",
          Jumlah: `${count}`,
          Operator: h.userName,
          SerialNumber: "-",
        });
      } else {
        h.serialNumbers.forEach((sn, idx) => {
          rows.push({
            Tipe:   idx === 0 ? (h.type === "in" ? "Scan Masuk" : "Scan Keluar") : "",
            Sumber: idx === 0 ? "Scan" : "",
            Tanggal: idx === 0 ? format(new Date(h.createdAt), "yyyy-MM-dd HH:mm:ss") : "",
            Material: idx === 0 ? (h.materialName || "-") : "",
            BoxLabel: idx === 0 ? (h.boxLabel || "-") : "",
            Jumlah:   idx === 0 ? `${count}` : "",
            Operator: idx === 0 ? h.userName : "",
            SerialNumber: sn,
          });
        });
      }
    });
    const ws = XLSX.utils.json_to_sheet(rows);
    ws["!cols"] = [{ wch: 16 }, { wch: 10 }, { wch: 22 }, { wch: 20 }, { wch: 16 }, { wch: 12 }, { wch: 12 }, { wch: 30 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Riwayat");
    XLSX.writeFile(wb, `Riwayat_MIG_${format(new Date(), "yyyyMMdd")}.xlsx`);
    toast({ title: "Export Excel berhasil", description: `${effectiveRecords.length} record.` });
  };

  const handleExportPDF = () => {
    if (effectiveRecords.length === 0) {
      toast({ title: "Tidak ada data", variant: "destructive" }); return;
    }
    toast({ title: "Membuat PDF...", description: "Harap tunggu sebentar." });
    const doc = new jsPDF();
    const pageH = doc.internal.pageSize.getHeight();
    const margin = 14;
    const lineH  = 5;
    doc.setFontSize(14); doc.setFont("helvetica", "bold");
    doc.text("Laporan Riwayat Transaksi", margin, 18);
    doc.setFontSize(8); doc.setFont("helvetica", "normal"); doc.setTextColor(100);
    doc.text(`Manajemen Inventori Gudang  |  Dicetak: ${format(new Date(), "dd/MM/yyyy HH:mm")}  |  ${effectiveRecords.length} record`, margin, 25);
    doc.setTextColor(0);
    let y = 33;
    const checkPage = (needed: number) => { if (y + needed > pageH - 10) { doc.addPage(); y = 16; } };
    effectiveRecords.forEach((h, i) => {
      checkPage(16);
      const isNonScan = h.source === "non-scan";
      const count  = isNonScan ? (h.count ?? 0) : h.serialNumbers.length;
      const satuan = isNonScan ? (h.satuan ?? "") : "item";
      const tipe   = isNonScan ? (h.type === "in" ? "MATERIAL MASUK" : "MATERIAL KELUAR") : (h.type === "in" ? "SCAN MASUK" : "SCAN KELUAR");
      const boxInfo = isNonScan ? "Non-Scan" : (h.boxLabel || "-");
      doc.setFontSize(9.5); doc.setFont("helvetica", "bold");
      doc.text(`${i + 1}.  [${tipe}]  ${boxInfo}  —  ${h.materialName || "-"}`, margin, y);
      y += lineH;
      doc.setFont("helvetica", "normal"); doc.setFontSize(8); doc.setTextColor(90);
      doc.text(`${format(new Date(h.createdAt), "dd/MM/yyyy HH:mm")}   Operator: ${h.userName}   (${count} ${satuan})`, margin + 4, y);
      y += lineH - 0.5; doc.setTextColor(0);
      if (!isNonScan && h.serialNumbers.length > 0) {
        doc.setFontSize(8);
        h.serialNumbers.forEach((sn, idx) => {
          checkPage(5);
          doc.setTextColor(50);
          doc.text(`${String(idx + 1).padStart(3, " ")}.  ${sn}`, margin + 6, y);
          doc.setTextColor(0);
          y += lineH - 0.5;
        });
      }
      y += 3;
    });
    doc.save(`Riwayat_MIG_${format(new Date(), "yyyyMMdd")}.pdf`);
  };

  const handlePrintQR = async () => {
    const inRecords = effectiveRecords.filter(h => h.type === "in" && h.serialNumbers.length > 0);
    if (inRecords.length === 0) {
      toast({ title: "Tidak ada data Scan Masuk", description: "Pilih record Scan Masuk (scan) untuk cetak QR.", variant: "destructive" });
      return;
    }
    toast({ title: "Membuat halaman cetak...", description: `Menyiapkan ${inRecords.length} QR label.` });
    const printWindow = window.open("", "_blank");
    if (!printWindow) return;
    let html = `<html><head><title>Cetak QR Box Labels</title><style>* { box-sizing: border-box; margin: 0; padding: 0; } body { font-family: monospace; background: #fff; } .grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 4mm; padding: 0; } .card { border: 1px dashed #555; padding: 3mm; text-align: center; break-inside: avoid; page-break-inside: avoid; } .box-label { font-size: 8pt; font-weight: bold; margin-bottom: 1.5mm; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; } .meta { font-size: 6pt; color: #444; margin-bottom: 2mm; line-height: 1.4; } .qr img { width: 100%; height: auto; display: block; } @media print { @page { size: A4 portrait; margin: 8mm; } body { margin: 0; } } @media screen { body { padding: 10mm; } }</style></head><body><div class="grid">`;
    for (const record of inRecords) {
      const qrText  = record.serialNumbers.join("\n");
      const dataUrl = await QRCode.toDataURL(qrText, { margin: 1, width: 180 });
      html += `<div class="card"><div class="box-label">${record.boxLabel || "-"}</div><div class="meta">${record.materialCode || record.materialName || "-"}<br/>${record.serialNumbers.length} item &bull; ${format(new Date(record.createdAt), "dd/MM/yy")}<br/>${record.userName}</div><div class="qr"><img src="${dataUrl}" /></div></div>`;
    }
    html += `</div></body></html>`;
    printWindow.document.write(html);
    printWindow.document.close();
    printWindow.onload = () => { printWindow.focus(); printWindow.print(); };
  };

  const handleDelete = async (id: number) => {
    if (confirm("Yakin ingin menghapus record ini? Tindakan ini tidak bisa dibatalkan.")) {
      try {
        await deleteHistoryMutation.mutateAsync({ id });
        setSelectedIds(prev => { const next = new Set(prev); next.delete(id); return next; });
        toast({ title: "Record dihapus" });
        refetch();
      } catch {
        toast({ title: "Gagal menghapus", variant: "destructive" });
      }
    }
  };

  // ── pagination helpers ─────────────────────────────────────────────────────

  const goToPage = (p: number) => setCurrentPage(Math.max(1, Math.min(p, totalPages)));

  const paginationRange = (): (number | "…")[] => {
    if (totalPages <= 7) return Array.from({ length: totalPages }, (_, i) => i + 1);
    const pages: (number | "…")[] = [1];
    if (safePage > 3) pages.push("…");
    for (let i = Math.max(2, safePage - 1); i <= Math.min(totalPages - 1, safePage + 1); i++) pages.push(i);
    if (safePage < totalPages - 2) pages.push("…");
    pages.push(totalPages);
    return pages;
  };

  const colSpan = isGuest ? 7 : (user?.role === "master" ? 9 : 8);

  /** Convert one history record into LabelData for SATO printing */
  const recordToLabelData = (record: typeof effectiveRecords[number]): LabelData => {
    const isNonScan = record.source === "non-scan";
    const isIn      = record.type === "in";
    const qty       = isNonScan
      ? `${record.count ?? 0} ${record.satuan ?? ""}`
      : `${record.serialNumbers.length} item`;
    const qrVal = isNonScan
      ? (record.materialCode || record.materialName || "MATERIAL")
      : (record.serialNumbers?.length > 0
          ? record.serialNumbers.join("\n")
          : (record.boxLabel || record.materialCode || "BOX"));
    const qrTitle = isNonScan
      ? (record.materialCode || record.materialName || "MATERIAL")
      : (record.boxLabel || record.materialCode || "BOX");
    return {
      qrValue:      qrVal,
      title:        qrTitle,
      materialName: record.materialName || record.materialCode || "-",
      qty,
      type: isIn ? (isNonScan ? "Mat. Masuk" : "Scan Masuk") : (isNonScan ? "Mat. Keluar" : "Scan Keluar"),
      date:     format(new Date(record.createdAt), "dd MMM yyyy HH:mm"),
      operator: record.userName,
    };
  };

  const handlePrintSato = () => {
    const targets = effectiveRecords;
    if (targets.length === 0) {
      toast({ title: "Tidak ada record", description: "Pilih atau filter record terlebih dahulu.", variant: "destructive" });
      return;
    }
    const labels = targets.map(recordToLabelData);
    if (labels.length === 1) {
      // Single record → show preview dialog first
      setLabelPreview(labels[0]);
    } else {
      // Multiple records → print all pages directly
      toast({ title: `Mencetak ${labels.length} label…`, description: "Jendela cetak akan terbuka sebentar lagi." });
      printBulkLabels(labels);
    }
  };

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h2 className="text-3xl font-bold tracking-tight flex items-center gap-3">
            <History className="w-8 h-8 text-primary" />
            Riwayat Transaksi
          </h2>
          {!isGuest && (
            <p className="text-muted-foreground mt-1">
              {selectedIds.size > 0
                ? <span className="text-primary font-medium">{selectedIds.size} record dipilih — export/cetak hanya yang dipilih</span>
                : "Pilih baris untuk export/cetak selektif, atau biarkan kosong untuk semua."}
            </p>
          )}
        </div>
        {!isGuest && (
          <div className="flex flex-wrap items-center gap-2">
            {selectedIds.size > 0 && (
              <Button variant="ghost" size="sm" onClick={() => setSelectedIds(new Set())} className="text-muted-foreground text-xs">
                Batal pilih
              </Button>
            )}
            <Button variant="outline" onClick={handlePrintQR} title={`Cetak QR A4 (${selectionLabel})`}>
              <Printer className="w-4 h-4 mr-2" /> Cetak QR
            </Button>
            <Button variant="outline" onClick={handlePrintSato} title={`Cetak Label SATO 6×3cm — ${effectiveRecords.length} halaman`}>
              <Tag className="w-4 h-4 mr-2" />
              Label SATO{effectiveRecords.length > 1 ? ` (${effectiveRecords.length})` : ""}
            </Button>
            <Button variant="outline" onClick={handleExportPDF} title={`Export PDF (${selectionLabel})`}>
              <FileDown className="w-4 h-4 mr-2" /> PDF
            </Button>
            <Button onClick={handleExportXLSX} className="bg-emerald-600 hover:bg-emerald-700 text-white" title={`Export Excel (${selectionLabel})`}>
              <FileDown className="w-4 h-4 mr-2" /> Excel
            </Button>
          </div>
        )}
      </div>

      <Card className="border-sidebar-border shadow-sm">
        <CardHeader className="py-4 border-b border-border/50 bg-muted/20">
          <div className="flex flex-col gap-3 w-full">
            <div className="flex items-center justify-between gap-4 flex-wrap">
              <CardTitle className="text-base font-semibold">
                Filter & Tabel
                {selectedIds.size > 0 && (
                  <Badge variant="secondary" className="ml-2 text-primary border-primary/30">
                    {selectedIds.size} dipilih
                  </Badge>
                )}
              </CardTitle>
              <div className="flex gap-2 flex-wrap items-center">
                <Select value={filterType} onValueChange={(v: any) => { setFilterType(v); setSelectedIds(new Set()); resetPage(); }}>
                  <SelectTrigger className="w-[130px]">
                    <SelectValue placeholder="Tipe" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Semua Tipe</SelectItem>
                    <SelectItem value="in">Masuk</SelectItem>
                    <SelectItem value="out">Keluar</SelectItem>
                  </SelectContent>
                </Select>
                <Select value={filterSource} onValueChange={(v: any) => { setFilterSource(v); setSelectedIds(new Set()); resetPage(); }}>
                  <SelectTrigger className="w-[140px]">
                    <SelectValue placeholder="Sumber" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Semua Sumber</SelectItem>
                    <SelectItem value="scan">Scan</SelectItem>
                    <SelectItem value="non-scan">Non-Scan</SelectItem>
                  </SelectContent>
                </Select>
                {/* ── active stock toggle ───────────────────────────── */}
                <Button
                  variant={filterActiveStock ? "default" : "outline"}
                  size="sm"
                  className={`h-9 gap-1.5 shrink-0 ${filterActiveStock ? "bg-emerald-600 hover:bg-emerald-700 text-white border-emerald-600" : "text-muted-foreground"}`}
                  onClick={() => { setFilterActiveStock(v => !v); setSelectedIds(new Set()); resetPage(); }}
                  title="Tampilkan hanya material yang masih berstok aktif"
                >
                  <Layers className="w-3.5 h-3.5" />
                  Stok Aktif
                  {filterActiveStock && activeStockIds.size > 0 && (
                    <Badge variant="secondary" className="ml-0.5 bg-emerald-500/20 text-white text-xs px-1">
                      {activeStockIds.size}
                    </Badge>
                  )}
                </Button>
                {/* ── in-stock material filter ──────────────────────── */}
                <Select
                  value={filterMaterialId}
                  onValueChange={(v) => { setFilterMaterialId(v); setSelectedIds(new Set()); resetPage(); }}
                >
                  <SelectTrigger className={`w-[190px] ${filterMaterialId !== "all" ? "border-primary text-primary" : ""}`}>
                    <Package className="w-3.5 h-3.5 mr-1.5 shrink-0" />
                    <SelectValue placeholder="Material stok ada" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Semua Material</SelectItem>
                    {inStockMaterials.length === 0 && (
                      <SelectItem value="__empty__" disabled>— Tidak ada stok —</SelectItem>
                    )}
                    {inStockMaterials.map(m => (
                      <SelectItem key={m.materialId} value={String(m.materialId)}>
                        <span className="flex items-center gap-2 w-full">
                          <span className="font-mono text-xs text-muted-foreground shrink-0">{m.materialCode}</span>
                          <span className="truncate">{m.materialName}</span>
                          <Badge variant="secondary" className="ml-auto shrink-0 text-xs font-mono">
                            {m.currentStock}
                          </Badge>
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select
                  value={String(pageSize)}
                  onValueChange={(v) => { setPageSize(Number(v)); resetPage(); }}
                >
                  <SelectTrigger className="w-[148px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PAGE_SIZE_OPTIONS.map(opt => (
                      <SelectItem key={opt.value} value={String(opt.value)}>{opt.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            {/* ── date range row ─────────────────────────────────────── */}
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <CalendarRange className="w-4 h-4 shrink-0" />
                <span className="shrink-0">Dari</span>
              </div>
              <Input
                type="date"
                value={filterFrom}
                max={filterTo || undefined}
                onChange={e => { setFilterFrom(e.target.value); setSelectedIds(new Set()); resetPage(); }}
                className="h-9 w-[150px] cursor-pointer"
              />
              <span className="text-sm text-muted-foreground shrink-0">—</span>
              <Input
                type="date"
                value={filterTo}
                min={filterFrom || undefined}
                onChange={e => { setFilterTo(e.target.value); setSelectedIds(new Set()); resetPage(); }}
                className="h-9 w-[150px] cursor-pointer"
              />
              {hasDateFilter && (
                <Button
                  variant="ghost" size="sm"
                  className="h-9 px-2 text-xs text-muted-foreground hover:text-foreground"
                  onClick={() => { setFilterFrom(""); setFilterTo(""); setSelectedIds(new Set()); resetPage(); }}
                >
                  <X className="w-3.5 h-3.5 mr-1" /> Hapus tanggal
                </Button>
              )}
              {hasDateFilter && (
                <Badge variant="outline" className="text-primary border-primary/40 text-xs">
                  {filterFrom && filterTo
                    ? `${format(new Date(filterFrom), "dd MMM yyyy")} — ${format(new Date(filterTo), "dd MMM yyyy")}`
                    : filterFrom
                    ? `Dari ${format(new Date(filterFrom), "dd MMM yyyy")}`
                    : `Sampai ${format(new Date(filterTo), "dd MMM yyyy")}`}
                </Badge>
              )}
            </div>

            {/* ── search row ──────────────────────────────────────────── */}
            <div className="relative w-full max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
              <Input
                placeholder="Cari material, box, operator..."
                value={searchQuery}
                onChange={e => { setSearchQuery(e.target.value); setSelectedIds(new Set()); resetPage(); }}
                className="pl-9 pr-9 h-9"
              />
              {searchQuery && (
                <button
                  onClick={() => { setSearchQuery(""); setSelectedIds(new Set()); resetPage(); }}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>
          </div>
        </CardHeader>

        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-12 flex justify-center items-center text-muted-foreground">
              <Loader2 className="w-8 h-8 animate-spin mr-2" /> Memuat riwayat...
            </div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader className="bg-muted/30">
                    <TableRow>
                      {!isGuest && (
                        <TableHead className="w-10 pl-4">
                          <Checkbox
                            checked={allSelected}
                            onCheckedChange={toggleAll}
                            aria-label="Pilih semua"
                            className={someSelected ? "data-[state=unchecked]:bg-primary/20" : ""}
                          />
                        </TableHead>
                      )}
                      <TableHead className="w-[130px]">Tipe</TableHead>
                      <TableHead>Tanggal & Waktu</TableHead>
                      <TableHead>Box / Keterangan</TableHead>
                      <TableHead>Material</TableHead>
                      <TableHead className="text-center">Qty</TableHead>
                      <TableHead>Operator</TableHead>
                      <TableHead className="text-center w-12">Label</TableHead>
                      {user?.role === "master" && <TableHead className="text-right pr-4">Aksi</TableHead>}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {pagedHistory.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={colSpan} className="h-32 text-center text-muted-foreground">
                          <div className="flex flex-col items-center gap-2">
                            <Search className="w-7 h-7 opacity-30" />
                            <span>{searchQuery ? `Tidak ada hasil untuk "${searchQuery}"` : "Tidak ada transaksi ditemukan"}</span>
                          </div>
                        </TableCell>
                      </TableRow>
                    ) : (
                      pagedHistory.map((record) => {
                        const isSelected = selectedIds.has(record.id);
                        const isNonScan  = record.source === "non-scan";
                        const isIn       = record.type   === "in";
                        const qty        = isNonScan
                          ? `${record.count ?? 0} ${record.satuan ?? ""}`
                          : `${record.serialNumbers.length} item`;
                        return (
                          <TableRow
                            key={record.id}
                            className={`transition-colors ${isGuest ? "" : "cursor-pointer"} ${isSelected ? "bg-primary/5 hover:bg-primary/10" : "hover:bg-muted/10"}`}
                            onClick={() => !isGuest && toggleOne(record.id)}
                          >
                            {!isGuest && (
                              <TableCell className="pl-4" onClick={(e) => e.stopPropagation()}>
                                <Checkbox
                                  checked={isSelected}
                                  onCheckedChange={() => toggleOne(record.id)}
                                  aria-label="Pilih baris ini"
                                />
                              </TableCell>
                            )}
                            <TableCell>
                              <div className="flex flex-col gap-1">
                                {isIn ? (
                                  <Badge className="bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400 hover:bg-emerald-100 px-2 py-1 whitespace-nowrap w-fit">
                                    {isNonScan ? <PackagePlus className="w-3 h-3 mr-1" /> : <ArrowDownRight className="w-3 h-3 mr-1" />}
                                    {isNonScan ? "Mat. Masuk" : "Scan Masuk"}
                                  </Badge>
                                ) : (
                                  <Badge className="bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 hover:bg-amber-100 px-2 py-1 whitespace-nowrap w-fit">
                                    {isNonScan ? <PackageMinus className="w-3 h-3 mr-1" /> : <ArrowUpRight className="w-3 h-3 mr-1" />}
                                    {isNonScan ? "Mat. Keluar" : "Scan Keluar"}
                                  </Badge>
                                )}
                              </div>
                            </TableCell>
                            <TableCell className="font-mono text-sm whitespace-nowrap">{format(new Date(record.createdAt), "dd MMM yyyy, HH:mm")}</TableCell>
                            <TableCell className="font-mono font-medium">
                              {isNonScan ? (
                                <span className="text-xs bg-muted px-1.5 py-0.5 rounded text-muted-foreground">Non-Scan</span>
                              ) : (
                                record.boxLabel || "-"
                              )}
                            </TableCell>
                            <TableCell className="font-mono">{record.materialCode || record.materialName || "-"}</TableCell>
                            <TableCell className="text-center font-bold font-mono">{qty}</TableCell>
                            <TableCell>{record.userName}</TableCell>
                            <TableCell className="text-center" onClick={(e) => e.stopPropagation()}>
                              <Button
                                variant="ghost" size="icon"
                                className="h-8 w-8 text-muted-foreground hover:text-foreground hover:bg-muted/50"
                                title="Cetak label SATO 6×3cm"
                                onClick={() => setLabelPreview(recordToLabelData(record))}
                              >
                                <Tag className="w-4 h-4" />
                              </Button>
                            </TableCell>
                            {user?.role === "master" && (
                              <TableCell className="text-right pr-4" onClick={(e) => e.stopPropagation()}>
                                <Button
                                  variant="ghost" size="icon"
                                  className="text-destructive hover:bg-destructive/10 hover:text-destructive h-8 w-8"
                                  onClick={() => handleDelete(record.id)}
                                >
                                  <Trash2 className="w-4 h-4" />
                                </Button>
                              </TableCell>
                            )}
                          </TableRow>
                        );
                      })
                    )}
                  </TableBody>
                </Table>
              </div>

              {/* ── pagination bar ───────────────────────────────────────── */}
              {pageSize !== 0 && searchedHistory.length > 0 && (
                <div className="flex items-center justify-between px-4 py-3 border-t border-border/50 bg-muted/10 flex-wrap gap-2">
                  <span className="text-xs text-muted-foreground">
                    {(() => {
                      const start = (safePage - 1) * pageSize + 1;
                      const end   = Math.min(safePage * pageSize, searchedHistory.length);
                      return `Menampilkan ${start}–${end} dari ${searchedHistory.length} record`;
                    })()}
                  </span>
                  <div className="flex items-center gap-1">
                    <Button
                      variant="outline" size="icon" className="h-7 w-7"
                      disabled={safePage === 1}
                      onClick={() => goToPage(safePage - 1)}
                    >
                      <ChevronLeft className="w-4 h-4" />
                    </Button>
                    {paginationRange().map((p, i) =>
                      p === "…" ? (
                        <span key={`ellipsis-${i}`} className="px-1 text-muted-foreground text-xs">…</span>
                      ) : (
                        <Button
                          key={p}
                          variant={p === safePage ? "default" : "outline"}
                          size="icon" className="h-7 w-7 text-xs"
                          onClick={() => goToPage(p as number)}
                        >
                          {p}
                        </Button>
                      ),
                    )}
                    <Button
                      variant="outline" size="icon" className="h-7 w-7"
                      disabled={safePage === totalPages}
                      onClick={() => goToPage(safePage + 1)}
                    >
                      <ChevronRight className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              )}

              {pageSize !== 0 && searchedHistory.length === 0 && null}
            </>
          )}
        </CardContent>
      </Card>

      <LabelPreviewDialog
        open={labelPreview !== null}
        onOpenChange={(open) => { if (!open) setLabelPreview(null); }}
        data={labelPreview}
      />
    </div>
  );
}
