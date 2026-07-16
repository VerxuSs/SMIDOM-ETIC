"use client";

import { useEffect, useMemo, useState } from "react";
import {
  CalendarDays,
  Loader2,
  AlertTriangle,
  Truck,
  Recycle,
  Users,
  Sparkles,
  Info,
} from "lucide-react";
import { DuoChart } from "./components/DuoChart";
import { MultiCategoryDuoChart } from "./components/MultiCategoryDuoChart";
import { AlertCard, StatCard } from "./components/AlertCard";
import type { KpiWindow } from "@/lib/dateWindows";

/* -------------------------------------------------------------------------
 * Types — miroir exact du JSON renvoyé par /api/dashboard
 * ---------------------------------------------------------------------- */

type OmrTab = {
  collecteBOM: KpiWindow;
  collectePAV: KpiWindow;
  collecteEntretienPAV: KpiWindow;
  bioDechetsTotal: KpiWindow;
  activiteParticuliers: {
    mocked: boolean;
    nombreLevees: KpiWindow;
    parcBacs: KpiWindow;
    moyenneLeveesParBac: KpiWindow;
  };
};

type DecheteriesTab = {
  passagesParSite: { site: string; kpi: KpiWindow }[];
  fluxPayantsParMatiere: { matiere: string; kpi: KpiWindow }[];
  egtTotal: KpiWindow;
};

type RiTab = {
  mouvements: { arrivees: KpiWindow; departs: KpiWindow };
  typologie: { particulier: KpiWindow; professionnel: KpiWindow; administration: KpiWindow };
  parc: { bac: KpiWindow; sac: KpiWindow; convention: KpiWindow; pav: KpiWindow };
  anomalies: { zeroLevee: KpiWindow; zeroDepot: KpiWindow; sansDotation: KpiWindow; dossiersEnCours: KpiWindow };
};

type EfficienceFlotte = {
  vehicule: string;
  conso100KmMois: number | null;
  conso100KmMoisN1: number | null;
  evolutionPct: number | null;
  ameliore: boolean | null;
};

type CsTab = {
  tonnages: { emballagesRegie: KpiWindow; papier: KpiWindow; tlc: KpiWindow; verre: KpiWindow };
  efficienceFlotte: EfficienceFlotte[];
};

type DashboardData = {
  success: boolean;
  month: string;
  label: { mois: string; year: number; yearN1: number };
  omr: OmrTab;
  decheteries: DecheteriesTab;
  ri: RiTab;
  cs: CsTab;
  error?: string;
};

type TabId = "omr" | "decheteries" | "ri" | "cs";

const TABS: { id: TabId; label: string; icon: typeof Truck; accent: string }[] = [
  { id: "omr", label: "Collecte (OMR)", icon: Truck, accent: "#1D6FA5" },
  { id: "decheteries", label: "Déchèteries", icon: Recycle, accent: "#2E9E6D" },
  { id: "ri", label: "Redevance Incitative", icon: Users, accent: "#D98E3F" },
  { id: "cs", label: "Collecte Sélective", icon: Sparkles, accent: "#1D6FA5" },
];

function currentMonthValue(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

export default function DashboardPage() {
  const [month, setMonth] = useState<string>(currentMonthValue());
  const [activeTab, setActiveTab] = useState<TabId>("omr");
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedMatiere, setSelectedMatiere] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    fetch(`/api/dashboard?month=${month}`)
      .then((res) => res.json())
      .then((json: DashboardData) => {
        if (cancelled) return;
        if (!json.success) {
          setError(json.error ?? "Erreur lors du chargement du tableau de bord.");
          setData(null);
          return;
        }
        setData(json);
        // Sélectionne la première matière disponible par défaut.
        if (json.decheteries.fluxPayantsParMatiere.length > 0) {
          setSelectedMatiere(json.decheteries.fluxPayantsParMatiere[0].matiere);
        }
      })
      .catch(() => {
        if (!cancelled) setError("Impossible de contacter le serveur.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [month]);

  const selectedFluxPayant = useMemo(() => {
    if (!data || !selectedMatiere) return null;
    return data.decheteries.fluxPayantsParMatiere.find((m) => m.matiere === selectedMatiere) ?? null;
  }, [data, selectedMatiere]);

  return (
    <div className="min-h-screen w-full bg-[#F4F7F5]">
      {/* Header */}
      <header className="bg-white border-b border-[#E1E8E6] sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-6 py-4 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-[#0F2A3D] flex items-center justify-center">
              <Recycle className="w-5 h-5 text-[#7FD9AE]" strokeWidth={2.2} />
            </div>
            <div>
              <p className="text-[#0F2A3D] text-base font-extrabold leading-tight">Tableau de bord stratégique</p>
              <p className="text-[#8AA0AA] text-[11px]">Consolidation Déchets — vue mensuelle</p>
            </div>
          </div>

          <div className="relative">
            <CalendarDays className="w-4 h-4 text-[#52677A] absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="month"
              value={month}
              onChange={(e) => setMonth(e.target.value)}
              className="rounded-xl border border-[#E1E8E6] bg-[#FAFCFB] pl-10 pr-3.5 py-2 text-sm text-[#0F2A3D] font-semibold focus:outline-none focus:ring-2 focus:ring-[#2E9E6D]/30 focus:border-[#2E9E6D]"
            />
          </div>
        </div>

        {/* Tabs */}
        <div className="max-w-6xl mx-auto px-6 flex gap-1 overflow-x-auto">
          {TABS.map((tab) => {
            const Icon = tab.icon;
            const selected = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={[
                  "flex items-center gap-2 px-4 py-3 text-sm font-semibold border-b-2 whitespace-nowrap transition-colors",
                  selected ? "border-current text-[#0F2A3D]" : "border-transparent text-[#8AA0AA] hover:text-[#52677A]",
                ].join(" ")}
                style={selected ? { color: tab.accent, borderColor: tab.accent } : undefined}
              >
                <Icon className="w-4 h-4" />
                {tab.label}
              </button>
            );
          })}
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-8">
        {loading && (
          <div className="flex items-center justify-center gap-2 text-[#52677A] text-sm py-24">
            <Loader2 className="w-4 h-4 animate-spin" />
            Calcul des indicateurs en cours…
          </div>
        )}

        {error && (
          <div className="rounded-xl bg-[#FBEEEA] border border-[#F0D2C7] p-4 flex items-start gap-2 mb-6">
            <AlertTriangle className="w-4 h-4 text-[#C05B3C] mt-0.5 shrink-0" />
            <p className="text-xs text-[#8A4128]">{error}</p>
          </div>
        )}

        {!loading && !error && data && (
          <>
            {activeTab === "omr" && <OmrPanel tab={data.omr} />}
            {activeTab === "decheteries" && (
              <DecheteriesPanel
                tab={data.decheteries}
                selectedMatiere={selectedMatiere}
                setSelectedMatiere={setSelectedMatiere}
                selectedFluxPayant={selectedFluxPayant}
              />
            )}
            {activeTab === "ri" && <RiPanel tab={data.ri} />}
            {activeTab === "cs" && <CsPanel tab={data.cs} />}
          </>
        )}
      </main>
    </div>
  );
}

/* -------------------------------------------------------------------------
 * Onglet OMR
 * ---------------------------------------------------------------------- */
function OmrPanel({ tab }: { tab: OmrTab }) {
  return (
    <div className="space-y-6">
      <Section title="Collecte">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <DuoChart title="Collecte BOM" unit="T" kpi={tab.collecteBOM} accent="#1D6FA5" />
          <DuoChart title="Collecte PAV" unit="T" kpi={tab.collectePAV} accent="#2E9E6D" />
          <DuoChart title="Collecte entretien PAV" unit="T" kpi={tab.collecteEntretienPAV} accent="#D98E3F" />
          <DuoChart
            title="Bio-déchets (total)"
            unit="T"
            kpi={tab.bioDechetsTotal}
            accent="#2E9E6D"
            caption='⚠️ Le schéma ne distingue pas "abri bacs" / "composteurs" — total tous contenants confondus.'
          />
        </div>
      </Section>

      <Section title="Activité particuliers" badge="Données de démonstration">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <StatCard
            label="Nombre de levées"
            value={tab.activiteParticuliers.nombreLevees.mois}
            evolutionPct={tab.activiteParticuliers.nombreLevees.evolMois}
            accent="blue"
          />
          <StatCard
            label="Parc de bacs"
            value={tab.activiteParticuliers.parcBacs.mois}
            evolutionPct={tab.activiteParticuliers.parcBacs.evolMois}
            accent="green"
          />
          <StatCard
            label="Moyenne levées / bac / mois"
            value={tab.activiteParticuliers.moyenneLeveesParBac.mois}
            evolutionPct={tab.activiteParticuliers.moyenneLeveesParBac.evolMois}
            accent="amber"
          />
        </div>
      </Section>
    </div>
  );
}

/* -------------------------------------------------------------------------
 * Onglet Déchèteries
 * ---------------------------------------------------------------------- */
function DecheteriesPanel({
  tab,
  selectedMatiere,
  setSelectedMatiere,
  selectedFluxPayant,
}: {
  tab: DecheteriesTab;
  selectedMatiere: string | null;
  setSelectedMatiere: (m: string) => void;
  selectedFluxPayant: { matiere: string; kpi: KpiWindow } | null;
}) {
  return (
    <div className="space-y-6">
      <Section title="Passages par site">
        <MultiCategoryDuoChart
          title="Passages en déchèterie"
          unit="passages"
          items={tab.passagesParSite.map((p) => ({ label: p.site, kpi: p.kpi }))}
        />
      </Section>

      <Section title="Flux payants">
        <div className="bg-white rounded-2xl border border-[#E1E8E6] p-5 mb-4">
          <label className="text-[11px] text-[#8AA0AA] uppercase font-bold tracking-wide mb-2 block">
            Matière
          </label>
          <select
            value={selectedMatiere ?? ""}
            onChange={(e) => setSelectedMatiere(e.target.value)}
            className="w-full sm:w-72 rounded-xl border border-[#E1E8E6] bg-[#FAFCFB] px-3.5 py-2.5 text-sm text-[#0F2A3D] font-semibold focus:outline-none focus:ring-2 focus:ring-[#2E9E6D]/30 focus:border-[#2E9E6D]"
          >
            {tab.fluxPayantsParMatiere.map((m) => (
              <option key={m.matiere} value={m.matiere}>
                {m.matiere}
              </option>
            ))}
          </select>
        </div>

        {selectedFluxPayant ? (
          <DuoChart title={selectedFluxPayant.matiere} unit="T" kpi={selectedFluxPayant.kpi} accent="#D98E3F" />
        ) : (
          <EmptyState text="Aucune matière en flux payant sur cette période." />
        )}
      </Section>

      <Section title="Contrôle EGT">
        <DuoChart title="Tonnage total EGT (tous flux)" unit="T" kpi={tab.egtTotal} accent="#1D6FA5" />
      </Section>
    </div>
  );
}

/* -------------------------------------------------------------------------
 * Onglet RI
 * ---------------------------------------------------------------------- */
function RiPanel({ tab }: { tab: RiTab }) {
  return (
    <div className="space-y-6">
      <Section title="Mouvements clients">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <DuoChart title="Arrivées clients" unit="clients" kpi={tab.mouvements.arrivees} accent="#2E9E6D" />
          <DuoChart title="Départs clients" unit="clients" kpi={tab.mouvements.departs} accent="#C05B3C" />
        </div>
      </Section>

      <Section title="Typologie des redevables" badge="Photo à l'instant — pas de cumul">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <DuoChart title="Particuliers" unit="clients" kpi={tab.typologie.particulier} accent="#1D6FA5" hideEvolution={false} />
          <DuoChart title="Professionnels" unit="clients" kpi={tab.typologie.professionnel} accent="#2E9E6D" />
          <DuoChart title="Administrations" unit="clients" kpi={tab.typologie.administration} accent="#D98E3F" />
        </div>
      </Section>

      <Section title="Parc de dotation" badge="Photo à l'instant — pas de cumul">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <DuoChart title="Bacs" unit="clients" kpi={tab.parc.bac} accent="#1D6FA5" />
          <DuoChart title="Sacs" unit="clients" kpi={tab.parc.sac} accent="#2E9E6D" />
          <DuoChart title="Convention" unit="clients" kpi={tab.parc.convention} accent="#D98E3F" />
          <DuoChart title="PAV" unit="clients" kpi={tab.parc.pav} accent="#1D6FA5" />
        </div>
      </Section>

      <Section title="Anomalies">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <AlertCard label="0 levée" kpi={tab.anomalies.zeroLevee} />
          <AlertCard label="0 dépôt" kpi={tab.anomalies.zeroDepot} />
          <AlertCard label="Sans dotation" kpi={tab.anomalies.sansDotation} />
          <AlertCard label="Dossiers en cours" kpi={tab.anomalies.dossiersEnCours} />
        </div>
      </Section>
    </div>
  );
}

/* -------------------------------------------------------------------------
 * Onglet CS
 * ---------------------------------------------------------------------- */
function CsPanel({ tab }: { tab: CsTab }) {
  return (
    <div className="space-y-6">
      <Section title="Tonnages">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <DuoChart
            title="Emballages"
            unit="T"
            kpi={tab.tonnages.emballagesRegie}
            accent="#1D6FA5"
            caption="⚠️ Régie uniquement (Veolia) — la part déchèterie n'a pas encore de source dédiée dans le schéma."
          />
          <DuoChart title="Papier (Quincieux)" unit="T" kpi={tab.tonnages.papier} accent="#2E9E6D" />
          <DuoChart title="TLC (Le Relais)" unit="T" kpi={tab.tonnages.tlc} accent="#D98E3F" />
          <DuoChart title="Verre" unit="T" kpi={tab.tonnages.verre} accent="#1D6FA5" />
        </div>
      </Section>

      <Section title="Efficience flotte" badge="L/100km">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {tab.efficienceFlotte.map((f) => (
            <StatCard
              key={f.vehicule}
              label={f.vehicule}
              value={f.conso100KmMois ?? "n/a"}
              suffix={f.conso100KmMois !== null ? "L/100km" : undefined}
              evolutionPct={f.evolutionPct}
              accent={f.ameliore ? "green" : f.ameliore === false ? "amber" : "blue"}
              helperText={
                f.ameliore === null
                  ? "Données insuffisantes pour comparer à N-1."
                  : f.ameliore
                  ? "En amélioration par rapport à l'an dernier."
                  : "En dégradation par rapport à l'an dernier."
              }
            />
          ))}
        </div>
      </Section>
    </div>
  );
}

/* -------------------------------------------------------------------------
 * Petits composants de mise en page
 * ---------------------------------------------------------------------- */
function Section({ title, badge, children }: { title: string; badge?: string; children: React.ReactNode }) {
  return (
    <section>
      <div className="flex items-center gap-2 mb-3">
        <h2 className="text-[#0F2A3D] text-sm font-extrabold uppercase tracking-wide">{title}</h2>
        {badge && (
          <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-[#8AA0AA] bg-[#EDF1F0] rounded-full px-2 py-0.5">
            <Info className="w-3 h-3" />
            {badge}
          </span>
        )}
      </div>
      {children}
    </section>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="bg-white rounded-2xl border border-[#E1E8E6] p-8 text-center">
      <p className="text-sm text-[#8AA0AA]">{text}</p>
    </div>
  );
}
