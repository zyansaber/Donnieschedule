import * as React from "react";
import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { X } from "lucide-react";
import { Line, LineChart, ResponsiveContainer, Tooltip as RechartsTooltip, XAxis, YAxis } from "recharts";
import { database, subscribeAllDealerConfigs, subscribeToPGIRecords } from "@/lib/firebase";
import { off, onValue, ref, set } from "firebase/database";

const yardRangeDefs = [
  { label: "0–30", min: 0, max: 30 },
  { label: "31–90", min: 31, max: 90 },
  { label: "91–180", min: 91, max: 180 },
  { label: "180+", min: 181, max: 9999 },
];

const toStr = (v: unknown) => String(v ?? "");
const slugifyDealerName = (name?: string | null) =>
  toStr(name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

const daysSinceISO = (iso?: string | null) => {
  if (!iso) return 0;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 0;
  const diff = Date.now() - d.getTime();
  return Math.max(0, Math.floor(diff / (1000 * 60 * 60 * 24)));
};

const startOfWeekMonday = (d: Date) => {
  const date = new Date(d);
  const day = date.getDay();
  const diff = (day + 6) % 7;
  date.setDate(date.getDate() - diff);
  date.setHours(0, 0, 0, 0);
  return date;
};

const addDays = (d: Date, n: number) => {
  const next = new Date(d);
  next.setDate(next.getDate() + n);
  return next;
};

const fmtWeekLabel = (d: Date) => `${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}`;

const parseHandoverDate = (raw?: string | null) => {
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
};

const normalizeType = (value: unknown) => {
  const t = toStr(value).toLowerCase();
  if (t.includes("stock")) return "Stock";
  if (t.includes("customer") || t.includes("retail")) return "Customer";
  return "Customer";
};

const csvHeaders = ["slug", "name", "hidden"];

const escapeCsvValue = (value: string) => {
  if (/[",\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
};

const buildCsv = (rows: string[][]) => rows.map((row) => row.map((cell) => escapeCsvValue(cell)).join(",")).join("\n");

const parseCsvRows = (input: string) => {
  const rows: string[][] = [];
  let currentRow: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < input.length; i += 1) {
    const char = input[i];
    const next = input[i + 1];
    if (char === '"' && inQuotes && next === '"') {
      current += '"';
      i += 1;
      continue;
    }
    if (char === '"') {
      inQuotes = !inQuotes;
      continue;
    }
    if (!inQuotes && (char === "\n" || char === "\r")) {
      if (char === "\r" && next === "\n") i += 1;
      currentRow.push(current);
      rows.push(currentRow);
      currentRow = [];
      current = "";
      continue;
    }
    if (!inQuotes && char === ",") {
      currentRow.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  if (current.length > 0 || currentRow.length > 0) {
    currentRow.push(current);
    rows.push(currentRow);
  }
  return rows;
};

const parseHiddenFromCsv = (input: string) => {
  const rows = parseCsvRows(input).filter((row) => row.some((cell) => cell.trim() !== ""));
  if (rows.length === 0) return [];
  const header = rows[0].map((cell) => cell.trim().toLowerCase());
  const slugIdx = header.indexOf("slug");
  const nameIdx = header.indexOf("name");
  const hiddenIdx = header.indexOf("hidden");
  if (slugIdx === -1 || hiddenIdx === -1) return [];
  const hidden: string[] = [];
  rows.slice(1).forEach((row) => {
    const slug = row[slugIdx]?.trim();
    const name = nameIdx > -1 ? row[nameIdx]?.trim() : "";
    const hiddenRaw = row[hiddenIdx]?.trim().toLowerCase();
    if (!slug && !name) return;
    const isHidden = ["true", "1", "yes", "y", "hidden"].includes(hiddenRaw);
    if (slug && isHidden) hidden.push(slugifyDealerName(slug));
  });
  return hidden;
};

type DealerSnapshot = {
  slug: string;
  name: string;
  waitingCount: number;
  stockTrend: { week: string; level: number }[];
  yardRanges: { label: string; count: number }[];
  yardInventory: { stock: number; customer: number; total: number; stockPct: number; customerPct: number };
};

const computeStockTrend = (
  yardEntries: { receivedAt?: string | null }[],
  handoverEntries: { handoverAt?: string | null }[],
  currentTotal: number
) => {
  const now = new Date();
  const latestStart = startOfWeekMonday(now);
  const starts: Date[] = [];
  for (let i = 9; i >= 0; i -= 1) {
    starts.push(addDays(latestStart, -7 * i));
  }
  const nextStarts = starts.map((s) => addDays(s, 7));

  const receivedByWeek = starts.map((s, i) => {
    const e = nextStarts[i];
    return yardEntries.filter((x) => {
      const d = x.receivedAt ? new Date(x.receivedAt) : null;
      return d && d >= s && d < e;
    }).length;
  });

  const handoversByWeek = starts.map((s, i) => {
    const e = nextStarts[i];
    return handoverEntries.filter((x) => {
      const d = parseHandoverDate(x.handoverAt);
      return d && d >= s && d < e;
    }).length;
  });

  const netByWeek = starts.map((_, i) => receivedByWeek[i] - handoversByWeek[i]);

  const levels = starts.map((_, i) => {
    let sumLater = 0;
    for (let j = i + 1; j < netByWeek.length; j += 1) sumLater += netByWeek[j];
    return Math.max(0, currentTotal - sumLater);
  });

  return starts.map((s, i) => ({ week: fmtWeekLabel(s), level: levels[i] }));
};

const InternalSnowyPage = () => {
  const [dealerConfigs, setDealerConfigs] = useState<Record<string, any>>({});
  const [pgiRecords, setPgiRecords] = useState<Record<string, any>>({});
  const [yardstockAll, setYardstockAll] = useState<Record<string, any>>({});
  const [handoverAll, setHandoverAll] = useState<Record<string, any>>({});
  const [hiddenSlugs, setHiddenSlugs] = useState<string[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [templateMessage, setTemplateMessage] = useState<string | null>(null);

  useEffect(() => {
    const unsub = subscribeAllDealerConfigs((data) => setDealerConfigs(data || {}));
    return () => unsub?.();
  }, []);

  useEffect(() => {
    const unsub = subscribeToPGIRecords((data) => setPgiRecords(data || {}));
    return () => unsub?.();
  }, []);

  useEffect(() => {
    const r = ref(database, "yardstock");
    const handler = (snap: any) => setYardstockAll(snap?.exists() ? snap.val() || {} : {});
    onValue(r, handler);
    return () => off(r, "value", handler);
  }, []);

  useEffect(() => {
    const r = ref(database, "handover");
    const handler = (snap: any) => setHandoverAll(snap?.exists() ? snap.val() || {} : {});
    onValue(r, handler);
    return () => off(r, "value", handler);
  }, []);

  useEffect(() => {
    const r = ref(database, "internalSnowy/hiddenDealers");
    const handler = (snap: any) => setHiddenSlugs(snap?.exists() ? snap.val() || [] : []);
    onValue(r, handler);
    return () => off(r, "value", handler);
  }, []);

  const updateHidden = async (next: string[]) => {
    const unique = Array.from(new Set(next));
    setHiddenSlugs(unique);
    await set(ref(database, "internalSnowy/hiddenDealers"), unique);
  };

  const dealerNameMap = useMemo(() => {
    const map: Record<string, string> = {};
    Object.keys(dealerConfigs || {}).forEach((slug) => {
      const config = dealerConfigs[slug] || {};
      const normalizedSlug = slugifyDealerName(config.slug || slug);
      map[normalizedSlug] = config.name || normalizedSlug;
    });
    return map;
  }, [dealerConfigs]);

  const dealerSnapshots = useMemo<DealerSnapshot[]>(() => {
    const pgiList = Object.values(pgiRecords || {});

    return Object.keys(dealerConfigs || {})
      .map((slug) => {
        const config = dealerConfigs[slug] || {};
        const normalizedSlug = slugifyDealerName(config.slug || slug);
        const yard = yardstockAll[normalizedSlug] || {};
        const handover = handoverAll[normalizedSlug] || {};

        const yardEntries = Object.entries(yard)
          .filter(([chassis]) => chassis !== "dealer-chassis")
          .map(([chassis, rec]) => ({
            chassis: toStr(chassis).toUpperCase(),
            receivedAt: rec?.receivedAt ?? null,
            type: normalizeType(rec?.type ?? rec?.Type),
            daysInYard: daysSinceISO(rec?.receivedAt ?? null),
          }));

        const handoverEntries = Object.entries(handover || {}).map(([chassis, rec]) => ({
          chassis: toStr(chassis).toUpperCase(),
          handoverAt: rec?.handoverAt ?? rec?.createdAt ?? null,
        }));

        const yardChassisSet = new Set(yardEntries.map((x) => x.chassis));
        const handoverChassisSet = new Set(handoverEntries.map((x) => x.chassis));

        const waitingCount = pgiList.filter((row: any) => {
          const targetSlug = slugifyDealerName(row?.dealer || row?.Dealer || "");
          const ch = toStr(row?.chassis).toUpperCase();
          if (targetSlug !== normalizedSlug || !ch) return false;
          return !yardChassisSet.has(ch) && !handoverChassisSet.has(ch);
        }).length;

        const yardRanges = yardRangeDefs.map(({ label, min, max }) => ({
          label,
          count: yardEntries.filter((x) => x.daysInYard >= min && x.daysInYard <= max).length,
        }));

        const stock = yardEntries.filter((x) => x.type === "Stock").length;
        const customer = yardEntries.filter((x) => x.type === "Customer").length;
        const total = yardEntries.length;
        const yardInventory = {
          stock,
          customer,
          total,
          stockPct: total ? Math.round((stock / total) * 100) : 0,
          customerPct: total ? Math.round((customer / total) * 100) : 0,
        };

        const stockTrend = computeStockTrend(yardEntries, handoverEntries, total);

        return {
          slug: normalizedSlug,
          name: config.name || normalizedSlug,
          waitingCount,
          yardRanges,
          yardInventory,
          stockTrend,
        };
      })
      .filter((snap) => !hiddenSlugs.includes(snap.slug));
  }, [dealerConfigs, handoverAll, hiddenSlugs, pgiRecords, yardstockAll]);

  const hiddenList = useMemo(
    () =>
      hiddenSlugs.map((slug) => ({
        slug,
        name: dealerNameMap[slug] || slug,
      })),
    [dealerNameMap, hiddenSlugs]
  );

  const visibleSnapshots = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return dealerSnapshots;
    return dealerSnapshots.filter((dealer) => {
      const searchBlob = [
        dealer.name,
        dealer.slug,
        dealer.waitingCount,
        dealer.yardInventory.total,
        dealer.yardInventory.stock,
        dealer.yardInventory.customer,
        dealer.yardRanges.map((range) => `${range.label}:${range.count}`).join(" "),
      ]
        .join(" ")
        .toLowerCase();
      return searchBlob.includes(query);
    });
  }, [dealerSnapshots, searchQuery]);

  const downloadTemplate = () => {
    const rows: string[][] = [];
    rows.push(csvHeaders);
    rows.push(["example-dealer", "Example Dealer", "false"]);
    Object.keys(dealerNameMap).forEach((slug) => {
      rows.push([slug, dealerNameMap[slug], hiddenSlugs.includes(slug) ? "true" : "false"]);
    });
    const csv = buildCsv(rows);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "internal-snowy-template.csv";
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  const handleTemplateUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    const hidden = parseHiddenFromCsv(text);
    await updateHidden(hidden);
    setTemplateMessage(`Saved ${hidden.length} hidden dealers from template.`);
    event.target.value = "";
  };

  return (
    <TooltipProvider>
      <div className="min-h-screen bg-slate-50 p-6">
        <header className="mb-4">
          <h1 className="text-2xl font-semibold text-slate-800">Internal Snowy Overview</h1>
          <p className="text-sm text-slate-600">xxx/internal-snowy-2487 · standalone internal view without sidebar</p>
        </header>

        <div className="mb-6 flex flex-col gap-4 rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex items-center gap-3">
              <Button type="button" onClick={downloadTemplate}>
                Download template
              </Button>
              <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-600">
                <span className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1">Upload filled template</span>
                <input type="file" accept=".csv" className="hidden" onChange={handleTemplateUpload} />
              </label>
            </div>
            <div className="w-full lg:w-80">
              <Input
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="Search dealers, counts, ranges..."
              />
            </div>
          </div>
          <p className="text-xs text-slate-500">
            Template columns: slug, name, hidden. Editing and uploading saves immediately—no extra button needed.
          </p>
          {templateMessage && <p className="text-xs text-emerald-600">{templateMessage}</p>}
        </div>

        {hiddenList.length > 0 && (
          <div className="mb-4 flex flex-wrap items-center gap-2 text-sm text-slate-700">
            <span className="font-medium">Hidden dealers:</span>
            {hiddenList.map((item) => (
              <Badge key={item.slug} variant="secondary" className="flex items-center gap-1">
                {item.name}
                <button type="button" onClick={() => updateHidden(hiddenSlugs.filter((s) => s !== item.slug))}>
                  <X className="h-3 w-3" />
                </button>
              </Badge>
            ))}
            <Button variant="ghost" size="sm" onClick={() => updateHidden([])}>
              Show All
            </Button>
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-4">
          {visibleSnapshots.map((dealer) => (
            <Card key={dealer.slug} className="relative overflow-hidden border-slate-200 shadow-sm">
              <button
                type="button"
                aria-label="Hide dealer"
                className="absolute right-2 top-2 rounded-md p-1 text-slate-500 hover:bg-slate-100"
                onClick={() => updateHidden([...hiddenSlugs, dealer.slug])}
              >
                <X className="h-4 w-4" />
              </button>
              <CardHeader className="pb-2">
                <CardTitle className="text-lg text-slate-800">{dealer.name}</CardTitle>
                <p className="text-xs text-slate-500">{dealer.slug}</p>
              </CardHeader>
              <CardContent className="space-y-4 text-sm text-slate-700">
                <div className="flex items-center justify-between rounded-lg bg-white p-3 shadow-inner">
                  <span className="text-slate-600">Waiting for Receiving</span>
                  <span className="text-lg font-semibold text-blue-700">{dealer.waitingCount}</span>
                </div>

                <div>
                  <div className="mb-1 flex items-center justify-between text-xs text-slate-500">
                    <span>Stock level (10 weeks)</span>
                    <span>Current: {dealer.yardInventory.total}</span>
                  </div>
                  <div className="h-28 bg-white">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={dealer.stockTrend} margin={{ left: 0, right: 0, top: 5, bottom: 5 }}>
                        <XAxis dataKey="week" hide />
                        <YAxis allowDecimals={false} hide domain={[0, "dataMax + 2"]} />
                        <RechartsTooltip />
                        <Line type="monotone" dataKey="level" stroke="#2563eb" strokeWidth={2} dot={false} />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                <div>
                  <div className="mb-2 text-xs font-semibold text-slate-600">Days In Yard</div>
                  <div className="grid grid-cols-2 gap-2">
                    {dealer.yardRanges.map((range) => (
                      <div key={range.label} className="rounded-lg bg-white p-2 shadow-inner">
                        <div className="text-xs text-slate-500">{range.label} days</div>
                        <div className="text-base font-semibold text-slate-800">{range.count}</div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="rounded-lg bg-white p-3 shadow-inner">
                  <div className="mb-2 flex items-center justify-between text-xs text-slate-500">
                    <span>Yard Inventory</span>
                    <span>Total: {dealer.yardInventory.total}</span>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <Tooltip>
                      <TooltipTrigger className="flex items-center gap-1">
                        <span className="h-3 w-3 rounded-full bg-blue-500" />
                        <span>Stock</span>
                      </TooltipTrigger>
                      <TooltipContent>{dealer.yardInventory.stockPct}%</TooltipContent>
                    </Tooltip>
                    <span className="font-semibold text-slate-800">{dealer.yardInventory.stock}</span>
                  </div>
                  <div className="mt-1 flex items-center justify-between text-sm">
                    <Tooltip>
                      <TooltipTrigger className="flex items-center gap-1">
                        <span className="h-3 w-3 rounded-full bg-emerald-500" />
                        <span>Customer</span>
                      </TooltipTrigger>
                      <TooltipContent>{dealer.yardInventory.customerPct}%</TooltipContent>
                    </Tooltip>
                    <span className="font-semibold text-slate-800">{dealer.yardInventory.customer}</span>
                  </div>
                  <div className="mt-2 flex h-2 w-full overflow-hidden rounded-full bg-slate-100">
                    <div className="h-full bg-blue-500" style={{ width: `${dealer.yardInventory.stockPct}%` }} />
                    <div className="h-full bg-emerald-500" style={{ width: `${dealer.yardInventory.customerPct}%` }} />
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </TooltipProvider>
  );
};

export default InternalSnowyPage;
