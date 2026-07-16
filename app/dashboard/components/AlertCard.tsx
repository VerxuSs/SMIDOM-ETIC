"use client";

import { AlertTriangle, TrendingDown, TrendingUp, Minus } from "lucide-react";
import type { KpiWindow } from "@/lib/dateWindows";

function formatNumber(n: number): string {
  return n.toLocaleString("fr-FR", { maximumFractionDigits: 1 });
}

function EvolutionBadge({ value }: { value: number | null }) {
  if (value === null) {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] text-[#8AA0AA] font-semibold">
        <Minus className="w-3 h-3" /> n/a
      </span>
    );
  }
  const isUp = value > 0;
  const isFlat = value === 0;
  return (
    <span
      className="inline-flex items-center gap-1 text-[11px] font-bold"
      style={{ color: isFlat ? "#8AA0AA" : isUp ? "#C05B3C" : "#2E9E6D" }}
    >
      {isFlat ? <Minus className="w-3 h-3" /> : isUp ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
      {isUp ? "+" : ""}
      {formatNumber(value)} %
    </span>
  );
}

export type AlertCardProps = {
  label: string;
  kpi: KpiWindow;
};

/** Carte rouge pour les anomalies RI (0 levée, 0 dépôt, sans dotation…). */
export function AlertCard({ label, kpi }: AlertCardProps) {
  return (
    <div className="bg-[#FBEEEA] border border-[#F0D2C7] rounded-2xl p-4">
      <div className="flex items-center gap-2 mb-2">
        <AlertTriangle className="w-4 h-4 text-[#C05B3C]" />
        <p className="text-xs font-bold text-[#8A4128] uppercase tracking-wide">{label}</p>
      </div>
      <p className="text-2xl font-extrabold text-[#8A4128]">{formatNumber(kpi.mois)}</p>
      <div className="mt-1">
        <EvolutionBadge value={kpi.evolMois} />
      </div>
    </div>
  );
}

export type StatCardProps = {
  label: string;
  value: number | string;
  suffix?: string;
  evolutionPct?: number | null;
  accent?: "green" | "blue" | "amber";
  helperText?: string;
};

/** Carte compacte pour un chiffre unique (ex: efficience flotte). */
export function StatCard({ label, value, suffix, evolutionPct, accent = "blue", helperText }: StatCardProps) {
  const accentColor = accent === "green" ? "#2E9E6D" : accent === "amber" ? "#D98E3F" : "#1D6FA5";
  const accentBg = accent === "green" ? "#EFF8F3" : accent === "amber" ? "#FBF3E7" : "#EAF3F9";

  return (
    <div className="bg-white rounded-2xl border border-[#E1E8E6] p-5">
      <p className="text-[11px] text-[#8AA0AA] uppercase font-bold tracking-wide mb-2">{label}</p>
      <div className="flex items-baseline gap-1.5">
        <span className="text-3xl font-extrabold" style={{ color: accentColor }}>
          {typeof value === "number" ? formatNumber(value) : value}
        </span>
        {suffix && <span className="text-sm font-semibold text-[#52677A]">{suffix}</span>}
      </div>
      {evolutionPct !== undefined && (
        <div className="mt-2">
          <EvolutionBadge value={evolutionPct} />
        </div>
      )}
      {helperText && <p className="text-[11px] text-[#8AA0AA] mt-2">{helperText}</p>}
      <div className="mt-3 h-1 rounded-full" style={{ backgroundColor: accentBg }}>
        <div className="h-full rounded-full" style={{ backgroundColor: accentColor, width: "60%" }} />
      </div>
    </div>
  );
}
