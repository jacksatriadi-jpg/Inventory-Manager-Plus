// Combobox material dgn pencarian kode/nama (Popover + cmdk) — dipakai tab Buat & Pengaturan retur.
import { useState } from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface MaterialOption {
  id: number;
  code?: string;
  name: string;
}

export function MaterialPicker({
  materials,
  value,
  onChange,
}: {
  materials: MaterialOption[] | undefined;
  value: string;
  onChange: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const list = materials ?? [];
  const selected = list.find((m) => String(m.id) === value);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="w-full justify-between font-normal"
        >
          {selected ? (
            <span className="truncate text-left">
              <span className="font-mono text-xs mr-2 text-muted-foreground">{selected.code}</span>
              {selected.name}
            </span>
          ) : (
            "Pilih material — ketik untuk mencari..."
          )}
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
        <Command>
          <CommandInput placeholder="Cari kode / nama material..." />
          <CommandList>
            <CommandEmpty>Tidak ada material cocok.</CommandEmpty>
            <CommandGroup>
              {list.map((m) => {
                const mid = String(m.id);
                return (
                  <CommandItem
                    key={m.id}
                    // id di awal nilai pencarian: unik per material, pencarian teks tetap cocok
                    value={`${mid} ${m.code ?? ""} ${m.name}`}
                    onSelect={() => {
                      onChange(mid);
                      setOpen(false);
                    }}
                  >
                    <Check className={cn("mr-2 h-4 w-4", value === mid ? "opacity-100" : "opacity-0")} />
                    <span className="font-mono text-xs mr-2 text-muted-foreground">{m.code}</span>
                    {m.name}
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
