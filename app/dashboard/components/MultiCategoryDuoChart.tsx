"use client";

import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from "recharts";
import type { KpiWindow } from "@/lib/dateWindows";

const COLORS = { blue: "#1D6FA5", green: "#2E9E6D", grid: "#EDF1F0", slate: "#52677A" };

function formatNumber(n: number): string {
  return n.toLocaleString("fr-FR", { maximumFractionDigits: 1 });
}

function CustomTooltip({ active, payload, label, unit }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-white border border-[#E1E8E6] rounded-lg px-3 py-2 shadow-md">
      <p className="text-xs font-bold text-[#0F2A3D] mb-1">{label}</p>
      {payload.map((p: any) => (
        <p key={p.dataKey} className="text-xs" style={{ color: p.color }}>
          {p.name} : {formatNumber(p.value)} {unit}
        </p>
      ))}
    </div>
  );
}

export type MultiCategoryDuoChartProps = {
  title: string;
  unit: string;
  items: { label: string; kpi: KpiWindow }[];
};

/**
 * Variante "multi-catégories" du DuoChart : au lieu d'un seul indicateur,
 * affiche plusieurs entités (les 4 déchèteries, une liste de matières…)
 * côte à côte sur le même graphique Volume, puis le même principe pour
 * l'Évolution. Conserve la règle des "2 graphiques" tout en restant lisible
 * quand il y a plus de 2 barres à comparer.
 */
export function MultiCategoryDuoChart({ title, unit, items }: MultiCategoryDuoChartProps) {
  const volumeData = items.map((it) => ({ name: it.label, Mois: it.kpi.mois, Cumul: it.kpi.cumul }));
  const evolutionData = items.map((it) => ({
    name: it.label,
    "Évol. mois": it.kpi.evolMois ?? 0,
    "Évol. cumul": it.kpi.evolCumul ?? 0,
  }));

  return (
    <div className="bg-white rounded-2xl border border-[#E1E8E6] p-5">
      <div className="flex items-center justify-between mb-3">
        <p className="text-[#0F2A3D] text-sm font-bold">{title}</p>
        <span className="text-[11px] text-[#8AA0AA] font-semibold uppercase tracking-wide">{unit}</span>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div>
          <p className="text-[10px] text-[#8AA0AA] uppercase font-bold mb-1 tracking-wide">Volume</p>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={volumeData} margin={{ top: 4, right: 4, left: -18, bottom: 0 }}>
              <CartesianGrid vertical={false} stroke={COLORS.grid} />
              <XAxis dataKey="name" tick={{ fontSize: 10, fill: COLORS.slate }} axisLine={{ stroke: "#E1E8E6" }} tickLine={false} interval={0} angle={-20} textAnchor="end" height={50} />
              <YAxis tick={{ fontSize: 10, fill: "#8AA0AA" }} axisLine={false} tickLine={false} />
              <Tooltip content={<CustomTooltip unit={unit} />} cursor={{ fill: COLORS.grid }} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey="Mois" fill={COLORS.blue} radius={[6, 6, 0, 0]} maxBarSize={28} />
              <Bar dataKey="Cumul" fill={COLORS.green} radius={[6, 6, 0, 0]} maxBarSize={28} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div>
          <p className="text-[10px] text-[#8AA0AA] uppercase font-bold mb-1 tracking-wide">Évolution N-1</p>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={evolutionData} margin={{ top: 4, right: 4, left: -18, bottom: 0 }}>
              <CartesianGrid vertical={false} stroke={COLORS.grid} />
              <XAxis dataKey="name" tick={{ fontSize: 10, fill: COLORS.slate }} axisLine={{ stroke: "#E1E8E6" }} tickLine={false} interval={0} angle={-20} textAnchor="end" height={50} />
              <YAxis tick={{ fontSize: 10, fill: "#8AA0AA" }} axisLine={false} tickLine={false} unit="%" />
              <Tooltip content={<CustomTooltip unit="%" />} cursor={{ fill: COLORS.grid }} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey="Évol. mois" fill={COLORS.blue} radius={[6, 6, 0, 0]} maxBarSize={28} />
              <Bar dataKey="Évol. cumul" fill={COLORS.green} radius={[6, 6, 0, 0]} maxBarSize={28} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}
