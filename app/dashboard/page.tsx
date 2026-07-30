"use client";

import { useEffect, useState, useMemo } from "react";
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
    efficienceFlotteBOM: EfficienceFlotte;
};

type ProviderData = {
    matieres: string[];
    totalParSite: { site: string; kpi: KpiWindow }[];
    parSiteEtMatiere: { site: string; matiere: string; kpi: KpiWindow }[];
};

type DecheteriesTab = {
    passagesParSite: { site: string; kpi: KpiWindow }[];
    ecoSol: KpiWindow;
    egt: ProviderData;
    chimirec: ProviderData;
    ecodds: ProviderData;
    d3e: ProviderData;
    chimirecEcoddsTotal: { site: string; kpi: KpiWindow }[];
    pneus?: KpiWindow;
    ecoMaison?: KpiWindow;
    ecoLogic?: KpiWindow;
    radiographies?: KpiWindow;
    huileVegetale?: KpiWindow;
};

type RiTab = {
    mouvements: { arrivees: KpiWindow; departs: KpiWindow };
    typologie: { particulier: KpiWindow; professionnel: KpiWindow; administration: KpiWindow };
    parc: { bac: KpiWindow; sac: KpiWindow; convention: KpiWindow; pav: KpiWindow };
    anomalies: { zeroLevee: KpiWindow; zeroDepot: KpiWindow; sansDotation: KpiWindow; dossiersEnCours: KpiWindow };
};

type EfficienceFlotte = {
    vehicule: string;
    kmMois: number | null;
    litresMois: number | null;
    conso100KmMois: number | null;
    conso100KmMoisN1: number | null;
    evolutionPct: number | null;
    ameliore: boolean | null;
};

type CsTab = {
    tonnages: { emballagesRegie: KpiWindow; papier: KpiWindow; tlc: KpiWindow; verre: KpiWindow };
    efficienceFlotte: EfficienceFlotte[];
};

type Temporalite = {
    mois: string;
    trimestre: string;
    annee: string;
    label: string;
};

type DashboardData = {
    success: boolean;
    month: string;
    temporalite: Temporalite;
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

    return (
        <div className="min-h-screen w-full bg-[#F4F7F5]">
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
                        {/* On passe la "temporalite" aux panels pour qu'ils sachent dans quel trimestre on est */}
                        {activeTab === "omr" && <OmrPanel tab={data.omr} temporalite={data.temporalite} />}
                        {activeTab === "decheteries" && <DecheteriesPanel tab={data.decheteries} temporalite={data.temporalite} />}
                        {activeTab === "ri" && <RiPanel tab={data.ri} temporalite={data.temporalite} />}
                        {activeTab === "cs" && <CsPanel tab={data.cs} temporalite={data.temporalite} />}
                    </>
                )}
            </main>
        </div>
    );
}

/* -------------------------------------------------------------------------
 * Sous-composant spécifique pour les graphiques de Prestataires (Onglet Déchèteries)
 * ---------------------------------------------------------------------- */
function GraphiquePrestataire({ title, data }: { title: string; data: ProviderData }) {
    const [filtre, setFiltre] = useState("TOTAL");

    const items = useMemo(() => {
        if (filtre === "TOTAL") {
            return data.totalParSite.map((d) => ({ label: d.site, kpi: d.kpi }));
        }
        return data.parSiteEtMatiere
            .filter((d) => d.matiere === filtre)
            .map((d) => ({ label: d.site, kpi: d.kpi }));
    }, [data, filtre]);

    return (
        <div className="relative">
            {data.matieres.length > 0 && (
                <div className="absolute top-5 right-5 z-10 flex items-center gap-2">
                    <label className="text-[10px] text-[#8AA0AA] uppercase font-bold tracking-wide hidden sm:block">
                        Matière
                    </label>
                    <select
                        value={filtre}
                        onChange={(e) => setFiltre(e.target.value)}
                        className="rounded-lg border border-[#E1E8E6] bg-[#FAFCFB] px-2 py-1.5 text-xs text-[#0F2A3D] font-bold focus:outline-none focus:ring-2 focus:ring-[#1D6FA5]/30 cursor-pointer shadow-sm"
                    >
                        <option value="TOTAL">Total (Toutes matières)</option>
                        {data.matieres.map((m) => (
                            <option key={m} value={m}>
                                {m}
                            </option>
                        ))}
                    </select>
                </div>
            )}
            <MultiCategoryDuoChart title={title} unit="T" items={items} />
        </div>
    );
}

/* -------------------------------------------------------------------------
 * Onglet OMR
 * ---------------------------------------------------------------------- */
function OmrPanel({ tab }: { tab: OmrTab, temporalite: Temporalite }) {
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

            <Section title="Efficience flotte BOM" badge="L/100km">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {tab.efficienceFlotteBOM && (
                        <StatCard
                            label={tab.efficienceFlotteBOM.vehicule}
                            value={tab.efficienceFlotteBOM.conso100KmMois ?? "n/a"}
                            suffix={tab.efficienceFlotteBOM.conso100KmMois !== null ? "L/100km" : undefined}
                            evolutionPct={tab.efficienceFlotteBOM.evolutionPct}
                            accent={tab.efficienceFlotteBOM.ameliore ? "green" : tab.efficienceFlotteBOM.ameliore === false ? "amber" : "blue"}
                            helperText={`${tab.efficienceFlotteBOM.kmMois?.toLocaleString("fr-FR") ?? 0} km parcourus • ${tab.efficienceFlotteBOM.litresMois?.toLocaleString("fr-FR") ?? 0} L consommés`}
                        />
                    )}
                </div>
            </Section>
        </div>
    );
}

/* -------------------------------------------------------------------------
 * Onglet Déchèteries
 * ---------------------------------------------------------------------- */
function DecheteriesPanel({ tab, temporalite }: { tab: DecheteriesTab, temporalite: Temporalite }) {
    // On extrait "T1", "T2", etc. à partir de "2026-T2"
    const currentQuarter = temporalite.trimestre.split("-")[1] || "Trimestre";

    return (
        <div className="space-y-6">
            <Section title="Passages par site (Mensuel)">
                <MultiCategoryDuoChart
                    title="Passages en déchèterie"
                    unit="passages"
                    items={tab.passagesParSite.map((p) => ({ label: p.site, kpi: p.kpi }))}
                />
            </Section>

            <Section title="Flux Prestataires & Déchets Dangereux (par déchèterie)">
                <div className="space-y-4">
                    <GraphiquePrestataire title="Flux EGT" data={tab.egt} />
                    <GraphiquePrestataire title="Flux Chimirec" data={tab.chimirec} />
                    <GraphiquePrestataire title="Flux EcoDDS" data={tab.ecodds} />

                    <GraphiquePrestataire title="Flux D3E" data={tab.d3e} />

                    <MultiCategoryDuoChart
                        title="Total Produits Chimiques (Chimirec + EcoDDS)"
                        unit="T"
                        items={tab.chimirecEcoddsTotal.map((p) => ({ label: p.site, kpi: p.kpi }))}
                    />
                </div>
            </Section>

            <Section title="Détournement Eco'Sol">
                <div className="grid grid-cols-1 gap-4">
                    {tab.ecoSol && (
                        <DuoChart
                            title="Flux Eco'Sol (Trimestriel)"
                            unit="T"
                            kpi={tab.ecoSol}
                            accent="#2E9E6D"
                            periodLabel={currentQuarter}
                        />
                    )}
                </div>
            </Section>

            {/* SECTION : Flux manuels */}
            <Section title="Autres flux (Saisies manuelles)">
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {tab.pneus && <DuoChart title="Pneus (Alpharecyclage)" unit="T" kpi={tab.pneus} accent="#1D6FA5" />}
                    {tab.ecoMaison && <DuoChart title="Eco maison (Sytraival)" unit="T" kpi={tab.ecoMaison} accent="#2E9E6D" />}
                    {tab.ecoLogic && <DuoChart title="Eco logic (Sytraival)" unit="T" kpi={tab.ecoLogic} accent="#D98E3F" />}
                    {tab.radiographies && <DuoChart title="Radiographies (Rhône Alpes)" unit="T" kpi={tab.radiographies} accent="#1D6FA5" />}
                    {tab.huileVegetale && <DuoChart title="Huile végétale (Quatra)" unit="T" kpi={tab.huileVegetale} accent="#2E9E6D" />}
                </div>
            </Section>
        </div>
    );
}

/* -------------------------------------------------------------------------
 * Onglet RI
 * ---------------------------------------------------------------------- */
function RiPanel({ tab, temporalite }: { tab: RiTab, temporalite: Temporalite }) {
    const currentQuarter = temporalite.trimestre.split("-")[1] || "Trimestre";

    return (
        <div className="space-y-6">
            <Section title="Mouvements clients (Année en cours)">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <DuoChart title="Arrivées clients" unit="clients" kpi={tab.mouvements.arrivees} accent="#2E9E6D" hideEvolution={false} />
                    <DuoChart title="Départs clients" unit="clients" kpi={tab.mouvements.departs} accent="#C05B3C" hideEvolution={false} />
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
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
                    <StatCard label="Parc Bacs" value={tab.parc.bac.mois} accent="blue" />
                    <StatCard label="Parc Sacs" value={tab.parc.sac.mois} accent="green" />
                    <StatCard label="Parc PAV" value={tab.parc.pav.mois} accent="blue" />
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <DuoChart
                        title="Clients Convention (Trimestriel)"
                        unit="clients"
                        kpi={tab.parc.convention}
                        accent="#D98E3F"
                        hideEvolution={false}
                        periodLabel={currentQuarter} // Dynamique
                        caption="Filtre appliqué sur la date de dotation au trimestre."
                    />
                </div>
            </Section>

            <Section title="Anomalies & Événements (Trimestriel)">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <DuoChart title="Anomalies 0 levée" unit="clients" kpi={tab.anomalies.zeroLevee} accent="#C05B3C" hideEvolution={false} periodLabel={currentQuarter} />
                    <DuoChart title="Anomalies 0 dépôt" unit="clients" kpi={tab.anomalies.zeroDepot} accent="#C05B3C" hideEvolution={false} periodLabel={currentQuarter} />
                    <DuoChart title="Sans dotation" unit="clients" kpi={tab.anomalies.sansDotation} accent="#C05B3C" hideEvolution={false} periodLabel={currentQuarter} />
                    <DuoChart title="Dossiers en cours" unit="dossiers" kpi={tab.anomalies.dossiersEnCours} accent="#C05B3C" hideEvolution={false} periodLabel={currentQuarter} />
                </div>
            </Section>
        </div>
    );
}

/* -------------------------------------------------------------------------
 * Onglet CS
 * ---------------------------------------------------------------------- */
function CsPanel({ tab }: { tab: CsTab, temporalite: Temporalite }) {
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
                            helperText={`${f.kmMois?.toLocaleString("fr-FR") ?? 0} km parcourus • ${f.litresMois?.toLocaleString("fr-FR") ?? 0} L consommés`}
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
