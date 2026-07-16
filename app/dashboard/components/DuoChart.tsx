"use client";

import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Cell } from "recharts";
import type { KpiWindow } from "@/lib/dateWindows";

const COLORS = {
  ink: "#0F2A3D",
  blue: "#1D6FA5",
  green: "#2E9E6D",
  amber: "#D98E3F",
  slate: "#52677A",
  up: "#2E9E6D",
  down: "#C05B3C",
  grid: "#EDF1F0",
};

function formatNumber(n: number, decimals = 1): string {
  return n.toLocaleString("fr-FR", { minimumFractionDigits: 0, maximumFractionDigits: decimals });
}

function VolumeTooltip({ active, payload, unit }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-white border border-[#E1E8E6] rounded-lg px-3 py-2 shadow-md">
      <p className="text-xs font-bold text-[#0F2A3D]">{payload[0].payload.name}</p>
      <p className="text-xs text-[#52677A]">
        {formatNumber(payload[0].value)} {unit}
      </p>
    </div>
  );
}

function EvolutionTooltip({ active, payload }: any) {
  if (!active || !payload?.length) return null;
  const v = payload[0].value as number;
  return (
    <div className="bg-white border border-[#E1E8E6] rounded-lg px-3 py-2 shadow-md">
      <p className="text-xs font-bold text-[#0F2A3D]">{payload[0].payload.name}</p>
      <p className="text-xs" style={{ color: v >= 0 ? COLORS.up : COLORS.down }}>
        {v >= 0 ? "+" : ""}
        {formatNumber(v)} %
      </p>
    </div>
  );
}

export type DuoChartProps = {
  title: string;
  unit: string;
  kpi: KpiWindow;
  accent?: string;
  /** Masque le graphique d'évolution (utile pour les stocks sans vraie N-1 comparable). */
  hideEvolution?: boolean;
  caption?: string;
};

export function DuoChart({ title, unit, kpi, accent = COLORS.blue, hideEvolution, caption }: DuoChartProps) {
  const volumeData = [
    { name: "Mois", value: kpi.mois },
    { name: "Cumul", value: kpi.cumul },
  ];
  const evolutionData = [
    { name: "Évol. mois", value: kpi.evolMois ?? 0 },
    { name: "Évol. cumul", value: kpi.evolCumul ?? 0 },
  ];

  return (
    <div className="bg-white rounded-2xl border border-[#E1E8E6] p-5">
      <div className="flex items-center justify-between mb-3">
        <p className="text-[#0F2A3D] text-sm font-bold">{title}</p>
        <span className="text-[11px] text-[#8AA0AA] font-semibold uppercase tracking-wide">{unit}</span>
      </div>

      <div className={hideEvolution ? "" : "grid grid-cols-2 gap-4"}>
        <div>
          <p className="text-[10px] text-[#8AA0AA] uppercase font-bold mb-1 tracking-wide">Volume</p>
          <ResponsiveContainer width="100%" height={140}>
            <BarChart data={volumeData} margin={{ top: 4, right: 4, left: -18, bottom: 0 }}>
              <CartesianGrid vertical={false} stroke={COLORS.grid} />
              <XAxis dataKey="name" tick={{ fontSize: 11, fill: COLORS.slate }} axisLine={{ stroke: "#E1E8E6" }} tickLine={false} />
              <YAxis tick={{ fontSize: 10, fill: "#8AA0AA" }} axisLine={false} tickLine={false} />
              <Tooltip content={<VolumeTooltip unit={unit} />} cursor={{ fill: COLORS.grid }} />
              <Bar dataKey="value" fill={accent} radius={[6, 6, 0, 0]} maxBarSize={48} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        {!hideEvolution && (
          <div>
            <p className="text-[10px] text-[#8AA0AA] uppercase font-bold mb-1 tracking-wide">Évolution N-1</p>
            <ResponsiveContainer width="100%" height={140}>
              <BarChart data={evolutionData} margin={{ top: 4, right: 4, left: -18, bottom: 0 }}>
                <CartesianGrid vertical={false} stroke={COLORS.grid} />
                <XAxis dataKey="name" tick={{ fontSize: 11, fill: COLORS.slate }} axisLine={{ stroke: "#E1E8E6" }} tickLine={false} />
                <YAxis tick={{ fontSize: 10, fill: "#8AA0AA" }} axisLine={false} tickLine={false} unit="%" />
                <Tooltip content={<EvolutionTooltip />} cursor={{ fill: COLORS.grid }} />
                <Bar dataKey="value" radius={[6, 6, 0, 0]} maxBarSize={48}>
                  {evolutionData.map((d, i) => (
                    <Cell key={i} fill={d.value >= 0 ? COLORS.up : COLORS.down} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      {caption && <p className="text-[11px] text-[#8AA0AA] mt-2">{caption}</p>}
    </div>
  );
}
