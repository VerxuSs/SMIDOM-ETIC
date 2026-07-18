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

  parcBacsParticuliers: KpiWindow;
  parcCartesPav: KpiWindow;

  transfertSerfim: KpiWindow;
  totalOmrSytraival: KpiWindow;
};

type DecheteriesTab = {
  passagesParSite: { site: string; kpi: KpiWindow }[];
  fluxPayantsParMatiere: { matiere: string; kpi: KpiWindow }[];
  egtTotal: KpiWindow;
  ecoSol: KpiWindow;
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
  temporalite: {
    mois: string;
    trimestre: string;
    annee: string;
    label: string;
  };
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
      {/* Header */}
      <header className="bg-white border-b border-[#E1E8E6] sticky top-0 z-10 shadow-sm">
        <div className="max-w-6xl mx-auto px-6 py-4 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-[#0F2A3D] flex items-center justify-center">
              <Recycle className="w-5 h-5 text-[#7FD9AE]" strokeWidth={2.2} />
            </div>
            <div>
              <p className="text-[#0F2A3D] text-base font-extrabold leading-tight">Tableau de bord stratégique</p>
              <p className="text-[#8AA0AA] text-[11px]">Consolidation Déchets — SMIDOM</p>
            </div>
          </div>

          <div className="flex items-center gap-6">
            {/* Badges dynamiques de temporalité */}
            {!loading && !error && data && (
                <div className="hidden md:flex gap-2">
                <span className="bg-[#EAF3F9] text-[#1D6FA5] text-[11px] font-bold px-2.5 py-1 rounded-lg">
                  {data.temporalite.mois}
                </span>
                  <span className="bg-[#EFF8F3] text-[#2E9E6D] text-[11px] font-bold px-2.5 py-1 rounded-lg">
                  {/* data.temporalite.trimestre vient de l'API /api/dashboard */}
                    {data.temporalite?.trimestre}
                </span>
                  <span className="bg-[#FBF3E7] text-[#D98E3F] text-[11px] font-bold px-2.5 py-1 rounded-lg">
                  Année {data.temporalite?.annee.replace('-ANNUEL', '')}
                </span>
                </div>
            )}

            {/* Sélecteur Global Unique */}
            <div className="relative">
              <CalendarDays className="w-4 h-4 text-[#52677A] absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                  type="month"
                  value={month}
                  onChange={(e) => setMonth(e.target.value)}
                  className="w-40 rounded-xl border border-[#E1E8E6] bg-[#FAFCFB] pl-10 pr-3.5 py-2 text-sm text-[#0F2A3D] font-bold focus:outline-none focus:ring-2 focus:ring-[#2E9E6D]/30 focus:border-[#2E9E6D] cursor-pointer shadow-sm hover:bg-white transition-colors"
                  title="Sélecteur global (Mois / Trimestre / Année)"
              />
            </div>
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
  // Calcul rapide de l'écart (Tonnage OMR Sytraival vs Tonnage Serfim/Organom)
  // On affiche un écart positif si Sytraival a facturé plus que ce qu'Organom a reçu.
  const ecartControleMois = (tab.totalOmrSytraival.mois - tab.transfertSerfim.mois);
  const ecartControleCumul = (tab.totalOmrSytraival.cumul - tab.transfertSerfim.cumul);

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
                caption='Donnée issue du tableau récapitulatif mensuel Ecovalim.'
            />
          </div>
        </Section>

        <Section title="Activité particuliers" badge="Données globales (Instant T)">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <StatCard
                label="Parc de bacs OMR (Particuliers)"
                value={tab.parcBacsParticuliers.mois}
                accent="green"
                helperText="Mis à jour à chaque import du fichier de dotation."
            />
            <StatCard
                label="Parc de cartes PAV (Particuliers)"
                value={tab.parcCartesPav.mois}
                accent="blue"
                helperText="Mis à jour à chaque import du fichier des déposants."
            />
          </div>
        </Section>

        <Section title="Contrôle Organom (Serfim)">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* On utilise hideEvolution car la donnée Serfim n'a peut-être pas d'historique N-1 */}
            <DuoChart
                title="Tonnage Total (Sytraival)"
                unit="T"
                kpi={tab.totalOmrSytraival}
                accent="#1D6FA5"
                hideEvolution
            />
            <DuoChart
                title="Transfert Organom (Serfim)"
                unit="T"
                kpi={tab.transfertSerfim}
                accent="#D98E3F"
                hideEvolution
            />

            <div className="bg-white rounded-2xl border border-[#E1E8E6] p-5 flex flex-col justify-center">
              <p className="text-[11px] text-[#8AA0AA] uppercase font-bold tracking-wide mb-2">Écart (Sytraival - Organom)</p>
              <div className="space-y-4">
                <div>
                  <p className="text-xs text-[#52677A] font-semibold">Mois en cours :</p>
                  <p className={`text-2xl font-extrabold ${Math.abs(ecartControleMois) > 10 ? 'text-[#C05B3C]' : 'text-[#2E9E6D]'}`}>
                    {ecartControleMois > 0 ? "+" : ""}{ecartControleMois.toLocaleString("fr-FR", { maximumFractionDigits: 1 })} T
                  </p>
                </div>
                <div>
                  <p className="text-xs text-[#52677A] font-semibold">Cumul annuel :</p>
                  <p className={`text-2xl font-extrabold ${Math.abs(ecartControleCumul) > 50 ? 'text-[#C05B3C]' : 'text-[#2E9E6D]'}`}>
                    {ecartControleCumul > 0 ? "+" : ""}{ecartControleCumul.toLocaleString("fr-FR", { maximumFractionDigits: 1 })} T
                  </p>
                </div>
              </div>
            </div>
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
        <Section title="Passages par site (Mensuel)">
          <MultiCategoryDuoChart
              title="Passages en déchèterie"
              unit="passages"
              items={tab.passagesParSite.map((p) => ({ label: p.site, kpi: p.kpi }))}
          />
        </Section>

        <Section title="Flux payants EGT & Chimirec (Mensuel)">
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

        <Section title="Contrôles Globaux">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <DuoChart title="Tonnage total EGT (Mensuel)" unit="T" kpi={tab.egtTotal} accent="#1D6FA5" />

            {/* Nouveau graphique Trimestriel pour Eco'Sol */}
            {tab.ecoSol && (
                <DuoChart title="Détournement Eco'Sol (Trimestriel)" unit="T" kpi={tab.ecoSol} accent="#2E9E6D" />
            )}
          </div>
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
        <Section title="Mouvements clients (Année en cours)">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <DuoChart title="Arrivées clients" unit="clients" kpi={tab.mouvements.arrivees} accent="#2E9E6D" hideEvolution={true} />
            <DuoChart title="Départs clients" unit="clients" kpi={tab.mouvements.departs} accent="#C05B3C" hideEvolution={true} />
          </div>
        </Section>

        <Section title="Typologie des redevables" badge="Données Globales (Instant T)">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <StatCard label="Particuliers" value={tab.typologie.particulier.mois} accent="blue" />
            <StatCard label="Professionnels" value={tab.typologie.professionnel.mois} accent="green" />
            <StatCard label="Administrations" value={tab.typologie.administration.mois} accent="amber" />
          </div>
        </Section>

        <Section title="Parc de dotation">
          {/* Les dotations classiques sont des snapshots globaux */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
            <StatCard label="Parc Bacs" value={tab.parc.bac.mois} accent="blue" />
            <StatCard label="Parc Sacs" value={tab.parc.sac.mois} accent="green" />
            <StatCard label="Parc PAV" value={tab.parc.pav.mois} accent="blue" />
          </div>
          {/* La convention est trimestrielle, donc graphique en barres ! */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <DuoChart
                title="Clients Convention (Trimestriel)"
                unit="clients"
                kpi={tab.parc.convention}
                accent="#D98E3F"
                hideEvolution={true}
                caption="Filtre appliqué sur la date de dotation au trimestre."
            />
          </div>
        </Section>

        <Section title="Anomalies & Événements (Trimestriel)">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Passage en graphe avec barres (rouge) pour respecter la temporalité trimestrielle */}
            <DuoChart title="Anomalies 0 levée" unit="clients" kpi={tab.anomalies.zeroLevee} accent="#C05B3C" hideEvolution={true} />
            <DuoChart title="Anomalies 0 dépôt" unit="clients" kpi={tab.anomalies.zeroDepot} accent="#C05B3C" hideEvolution={true} />
            <DuoChart title="Sans dotation" unit="clients" kpi={tab.anomalies.sansDotation} accent="#C05B3C" hideEvolution={true} />
            <DuoChart title="Dossiers en cours" unit="dossiers" kpi={tab.anomalies.dossiersEnCours} accent="#C05B3C" hideEvolution={true} />
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
