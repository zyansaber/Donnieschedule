import * as React from "react";
import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Line, LineChart, ResponsiveContainer, Tooltip as RechartsTooltip, XAxis, YAxis } from "recharts";
import { database, subscribeAllDealerConfigs, subscribeToPGIRecords } from "@/lib/firebase";
import { off, onValue, ref } from "firebase/database";
import DialogWrapper from "@/components/DialogWrapper";

const yardRangeDefs = [
  { label: "0–30", min: 0, max: 30 },
  { label: "31–90", min: 31, max: 90 },
  { label: "91–180", min: 91, max: 180 },
  { label: "180+", min: 181, max: 9999 },
];

const toStr = (v: unknown) => String(v ?? "");
const normalizeDealerSlug = (name?: string | null) =>
  toStr(name)
    .toLowerCase()
    .replace(/&/g, "and")
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

const parseDateValue = (raw?: string | null) => {
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
};

const parseDDMMYYYY = (input?: string | null) => {
  if (!input) return null;
  const s = String(input).trim();
  const m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
  if (!m) return null;
  const dd = Number.parseInt(m[1], 10);
  const mm = Number.parseInt(m[2], 10);
  let yy = Number.parseInt(m[3], 10);
  if (yy < 100) yy += 2000;
  const d = new Date(yy, mm - 1, dd);
  d.setHours(0, 0, 0, 0);
  if (d.getFullYear() !== yy || d.getMonth() !== mm - 1 || d.getDate() !== dd) return null;
  return d;
};

const parseHandoverDate = (raw?: string | null) => parseDateValue(raw);

const parsePgiDate = (row: Record<string, any>) =>
  parseDDMMYYYY(row?.pgidate ?? row?.PGIDATE ?? row?.PGI_DATE ?? null) ??
  parseDateValue(row?.pgiAt ?? row?.pgiDate ?? row?.issuedAt ?? row?.createdAt ?? null);

const isWithinDays = (date: Date | null, days: number) => {
  if (!date) return false;
  const threshold = Date.now() - days * 24 * 60 * 60 * 1000;
  return date.getTime() >= threshold;
};

const normalizeType = (value: unknown, customer?: unknown) => {
  const t = toStr(value).toLowerCase().trim();
  const c = toStr(customer).trim();
  if (!t) return /stock$/i.test(c) ? "Stock" : "Customer";
  if (t.includes("stock")) return "Stock";
  if (t.includes("customer") || t.includes("retail")) {
    return t.slice(-5) === "stock" ? "Stock" : "Customer";
  }
  return "Customer";
};

type DealerSnapshot = {
  slug: string;
  name: string;
  waitingCount: number;
  waitingDetails: { chassis: string }[];
  stockTrend: { week: string; level: number }[];
  yardRanges: { label: string; count: number }[];
  yardInventory: { stock: number; customer: number; total: number; stockPct: number; customerPct: number };
  yardDetails: { chassis: string; daysInYard: number }[];
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
      const d = parseHandoverDate(x.receivedAt);
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
  const [searchQuery, setSearchQuery] = useState("");
  const [detailDialog, setDetailDialog] = useState<{
    title: string;
    type: "waiting" | "yard";
    items: { chassis: string; daysInYard?: number }[];
  } | null>(null);

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

  const dealerSnapshots = useMemo<DealerSnapshot[]>(() => {
    const pgiList = Object.entries(pgiRecords || {}).map(([chassis, rec]) => ({
      chassis,
      ...(rec as Record<string, any>),
    }));
    return Object.keys(dealerConfigs || {})
      .map((slug) => {
        const config = dealerConfigs[slug] || {};
        const normalizedSlug = normalizeDealerSlug(config.slug || slug);
        const yard = yardstockAll[normalizedSlug] || {};
        const handover = handoverAll[normalizedSlug] || {};

        const yardEntries = Object.entries(yard)
          .filter(([chassis]) => chassis !== "dealer-chassis")
          .map(([chassis, rec]) => {
            const customer = rec?.customer ?? rec?.Customer ?? null;
            return {
              chassis: toStr(chassis).toUpperCase(),
              receivedAt: rec?.receivedAt ?? null,
              type: normalizeType(rec?.type ?? rec?.Type, customer),
              daysInYard: daysSinceISO(rec?.receivedAt ?? null),
            };
          });

        const handoverEntries = Object.entries(handover || {}).map(([chassis, rec]) => ({
          chassis: toStr(chassis).toUpperCase(),
          handoverAt: rec?.handoverAt ?? rec?.createdAt ?? null,
        }));

        const yardChassisSet = new Set(yardEntries.map((x) => x.chassis));
        const handoverChassisSet = new Set(handoverEntries.map((x) => x.chassis));

        const pgiRangeDays = 180;
        const waitingDetails = pgiList.filter((row: any) => {
          const targetSlug = normalizeDealerSlug(row?.dealer || row?.Dealer || "");
          const ch = toStr(row?.chassis ?? row?.Chassis ?? row?.CHASSIS).toUpperCase().trim();
          if (targetSlug !== normalizedSlug || !ch) return false;
          if (Number.isFinite(pgiRangeDays) && pgiRangeDays > 0) {
            if (!isWithinDays(parsePgiDate(row), pgiRangeDays)) return false;
          }
          return !yardChassisSet.has(ch) && !handoverChassisSet.has(ch);
        }).map((row: any) => ({
          chassis: toStr(row?.chassis ?? row?.Chassis ?? row?.CHASSIS).toUpperCase().trim(),
        }));

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
          waitingCount: waitingDetails.length,
          waitingDetails,
          yardRanges,
          yardInventory,
          yardDetails: yardEntries.map((entry) => ({
            chassis: entry.chassis,
            daysInYard: entry.daysInYard,
          })),
          stockTrend,
        };
      })
      .filter((snap) => !["alldealers", "selfowned"].includes(snap.slug));
  }, [dealerConfigs, handoverAll, pgiRecords, yardstockAll]);

  const visibleSnapshots = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return dealerSnapshots;
    return dealerSnapshots.filter((dealer) => {
      return dealer.name.toLowerCase().includes(query);
    });
  }, [dealerSnapshots, searchQuery]);

  const selfOwnedDealers = useMemo(() => {
    const selfOwnedNames = ["Frankston", "Geelong", "Launceston", "ST James", "Traralgon"];
    const selfOwnedSlugs = new Set(selfOwnedNames.map((name) => normalizeDealerSlug(name)));
    return visibleSnapshots.filter((dealer) => selfOwnedSlugs.has(dealer.slug));
  }, [visibleSnapshots]);

  const otherDealers = useMemo(() => {
    const selfOwnedNames = ["Frankston", "Geelong", "Launceston", "ST James", "Traralgon"];
    const selfOwnedSlugs = new Set(selfOwnedNames.map((name) => normalizeDealerSlug(name)));
    return visibleSnapshots.filter((dealer) => !selfOwnedSlugs.has(dealer.slug));
  }, [visibleSnapshots]);

  return (
    <TooltipProvider>
      <div className="min-h-screen bg-slate-50 px-4 pb-16 pt-8 text-slate-900">
        <div className="mx-auto w-full max-w-7xl">
          <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h1 className="text-2xl font-semibold text-slate-900">Internal Snowy snapshot</h1>
              <p className="text-sm text-slate-500">Latest yard, waiting, and handover insights.</p>
            </div>
            <div className="w-full sm:max-w-xs">
              <Input
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="Search dealers"
                className="bg-white"
              />
            </div>
          </div>

        {selfOwnedDealers.length > 0 && (
          <div className="mb-8 rounded-xl border-2 border-blue-200 bg-white p-4 shadow-sm">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold text-slate-800">Self owned dealers</h2>
                <p className="text-xs text-slate-500">
                  Frankston, Geelong, Launceston, ST James, Traralgon
                </p>
              </div>
              <Badge variant="secondary" className="bg-blue-50 text-blue-700">
                Waiting for Receiving
              </Badge>
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {selfOwnedDealers.map((dealer) => (
                <Card key={dealer.slug} className="relative overflow-hidden border-blue-100 shadow-sm">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base text-slate-800">{dealer.name}</CardTitle>
                    <p className="text-xs text-slate-500">{dealer.slug}</p>
                  </CardHeader>
                  <CardContent className="space-y-4 text-sm text-slate-700">
                    <div className="flex items-center justify-between rounded-lg bg-white p-3 shadow-inner">
                      <span className="text-slate-600">Waiting for Receiving</span>
                      <div className="flex items-center gap-3">
                        <span className="text-lg font-semibold text-blue-700">{dealer.waitingCount}</span>
                        <button
                          type="button"
                          onClick={() =>
                            setDetailDialog({
                              title: `${dealer.name} — Waiting for Receiving`,
                              type: "waiting",
                              items: dealer.waitingDetails,
                            })
                          }
                          className="rounded-md border border-blue-200 px-2 py-1 text-xs font-semibold text-blue-700 hover:bg-blue-50"
                        >
                          Details
                        </button>
                      </div>
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
                      <div className="mb-2 flex items-center justify-between text-xs font-semibold text-slate-600">
                        <span>Days In Yard</span>
                        <button
                          type="button"
                          onClick={() =>
                            setDetailDialog({
                              title: `${dealer.name} — Days In Yard`,
                              type: "yard",
                              items: dealer.yardDetails,
                            })
                          }
                          className="rounded-md border border-slate-200 px-2 py-1 text-[11px] font-semibold text-slate-600 hover:bg-slate-50"
                        >
                          Details
                        </button>
                      </div>
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
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-4">
          {otherDealers.map((dealer) => (
            <Card key={dealer.slug} className="relative overflow-hidden border-slate-200 shadow-sm">
              <CardHeader className="pb-2">
                <CardTitle className="text-lg text-slate-800">{dealer.name}</CardTitle>
                <p className="text-xs text-slate-500">{dealer.slug}</p>
              </CardHeader>
              <CardContent className="space-y-4 text-sm text-slate-700">
                <div className="flex items-center justify-between rounded-lg bg-white p-3 shadow-inner">
                  <span className="text-slate-600">Waiting for Receiving</span>
                  <div className="flex items-center gap-3">
                    <span className="text-lg font-semibold text-blue-700">{dealer.waitingCount}</span>
                    <button
                      type="button"
                      onClick={() =>
                        setDetailDialog({
                          title: `${dealer.name} — Waiting for Receiving`,
                          type: "waiting",
                          items: dealer.waitingDetails,
                        })
                      }
                      className="rounded-md border border-blue-200 px-2 py-1 text-xs font-semibold text-blue-700 hover:bg-blue-50"
                    >
                      Details
                    </button>
                  </div>
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
                  <div className="mb-2 flex items-center justify-between text-xs font-semibold text-slate-600">
                    <span>Days In Yard</span>
                    <button
                      type="button"
                      onClick={() =>
                        setDetailDialog({
                          title: `${dealer.name} — Days In Yard`,
                          type: "yard",
                          items: dealer.yardDetails,
                        })
                      }
                      className="rounded-md border border-slate-200 px-2 py-1 text-[11px] font-semibold text-slate-600 hover:bg-slate-50"
                    >
                      Details
                    </button>
                  </div>
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
    </div>
      <DialogWrapper
        isOpen={Boolean(detailDialog)}
        onClose={() => setDetailDialog(null)}
        title={detailDialog?.title ?? ""}
      >
        {!detailDialog?.items.length && <p className="text-sm text-slate-500">No records available.</p>}
        {detailDialog?.items.length ? (
          <div className="space-y-2">
            {detailDialog.items.map((item) => (
              <div
                key={`${detailDialog.type}-${item.chassis}`}
                className="flex items-center justify-between rounded-lg border border-slate-100 bg-white px-3 py-2 text-sm"
              >
                <span className="font-semibold text-slate-700">{item.chassis}</span>
                {detailDialog.type === "yard" && (
                  <span className="text-slate-500">{item.daysInYard ?? 0} days</span>
                )}
              </div>
            ))}
          </div>
        ) : null}
      </DialogWrapper>
    </TooltipProvider>
  );
};

export default InternalSnowyPage;
