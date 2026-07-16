import { prisma } from "@/lib/prisma";
import { TERRITOIRE_SITES } from "@/lib/sites";
import {
  FourWindows,
  KpiWindow,
  DateRange,
  sumFourWindows,
  buildKpiWindow,
  computeEvolutionPct,
} from "@/lib/dateWindows";

/* =========================================================================
 * Onglet 1 — Collecte (OMR)
 * ======================================================================= */

/**
 * Pesee et Vehicule ne sont PAS reliés par une relation Prisma (choix fait
 * lors de l'import : certaines pesées, ex. Serfim, ne référencent aucun
 * véhicule réel). On fait donc la jointure "à la main" en 2 requêtes :
 * d'abord la liste des immatriculations pour une fonction donnée, puis le
 * filtre sur Pesee.
 */
async function getImmatriculationsByFonction(fonction: string): Promise<string[]> {
  const vehicules = await prisma.vehicule.findMany({
    where: { fonction },
    select: { immatriculation: true },
  });
  return vehicules.map((v) => v.immatriculation);
}

async function kpiCollecteParFonction(fonction: string, windows: FourWindows): Promise<KpiWindow> {
  const immats = await getImmatriculationsByFonction(fonction);

  const sumFn = async (range: DateRange): Promise<number> => {
    if (immats.length === 0) return 0;
    const result = await prisma.pesee.aggregate({
      _sum: { poidsNet: true },
      where: { immatriculation: { in: immats }, date: { gte: range.start, lt: range.end } },
    });
    return result._sum.poidsNet ?? 0;
  };

  return sumFourWindows(windows, sumFn);
}

async function kpiBioDechetsTotal(windows: FourWindows): Promise<KpiWindow> {
  const sumFn = async (range: DateRange): Promise<number> => {
    const result = await prisma.bioDechet.aggregate({
      _sum: { poidsKg: true },
      where: { date: { gte: range.start, lt: range.end } },
    });
    return (result._sum.poidsKg ?? 0) / 1000; // kg -> tonnes
  };
  return sumFourWindows(windows, sumFn);
}

export async function getOmrTab(windows: FourWindows) {
  const [collecteBOM, collectePAV, collecteEntretienPAV, bioDechets] = await Promise.all([
    kpiCollecteParFonction("Collecte BOM", windows),
    kpiCollecteParFonction("Collecte PAV", windows),
    kpiCollecteParFonction("Collecte entretien PAV", windows),
    kpiBioDechetsTotal(windows),
  ]);

  return {
    collecteBOM,
    collectePAV,
    collecteEntretienPAV,
    // ⚠️ Le schéma BioDechet n'a pas de champ pour distinguer "abri bacs" /
    // "composteur établissement" / "composteur public" (seulement `idBac`).
    // On expose donc le TOTAL réel ici. Pour restituer la répartition
    // demandée dans la maquette PDF, il faudrait soit un champ
    // `typeContenant` sur BioDechet, soit un référentiel idBac -> type.
    bioDechetsTotal: bioDechets,
    // Activité "particuliers" : aucune table ne porte ces données
    // aujourd'hui (nombre de levées, parc de bacs). Mockées explicitement,
    // à remplacer dès qu'un import Styx/RI dédié existera.
    activiteParticuliers: {
      mocked: true,
      nombreLevees: buildKpiWindow(14000, 27500, 13500, 26200),
      parcBacs: buildKpiWindow(17000, 17000, 16700, 16700),
      moyenneLeveesParBac: buildKpiWindow(0.82, 1.61, 0.81, 1.57),
    },
  };
}

/* =========================================================================
 * Onglet 2 — Déchèteries
 * ======================================================================= */

async function kpiPassagesParSite(windows: FourWindows) {
  const results: { site: string; kpi: KpiWindow }[] = [];

  // On déstructure l'objet pour récupérer uniquement la propriété "canon"
  for (const { canon } of TERRITOIRE_SITES) {
    const sumFn = (range: DateRange) =>
        prisma.dechetteriePassage.count({
          where: { site: canon, datePassage: { gte: range.start, lt: range.end } },
        });

    results.push({ site: canon, kpi: await sumFourWindows(windows, sumFn) });
  }

  return results;
}

async function kpiFluxPayantsParMatiere(windows: FourWindows) {
  const matieresRows = await prisma.dechetterieFlux.findMany({
    where: { categorieFlux: "PAYANT" },
    select: { matiere: true },
    distinct: ["matiere"],
    orderBy: { matiere: "asc" },
  });

  const results: { matiere: string; kpi: KpiWindow }[] = [];

  for (const { matiere } of matieresRows) {
    const sumFn = async (range: DateRange): Promise<number> => {
      const result = await prisma.dechetterieFlux.aggregate({
        _sum: { poidsTonnes: true },
        where: { categorieFlux: "PAYANT", matiere, dateCollecte: { gte: range.start, lt: range.end } },
      });
      return result._sum.poidsTonnes ?? 0;
    };
    results.push({ matiere, kpi: await sumFourWindows(windows, sumFn) });
  }

  return results;
}

async function kpiEgtTotal(windows: FourWindows): Promise<KpiWindow> {
  const sumFn = async (range: DateRange): Promise<number> => {
    const result = await prisma.dechetterieFlux.aggregate({
      _sum: { poidsTonnes: true },
      where: { prestataire: "EGT", dateCollecte: { gte: range.start, lt: range.end } },
    });
    return result._sum.poidsTonnes ?? 0;
  };
  return sumFourWindows(windows, sumFn);
}

export async function getDecheteriesTab(windows: FourWindows) {
  const [passagesParSite, fluxPayantsParMatiere, egtTotal] = await Promise.all([
    kpiPassagesParSite(windows),
    kpiFluxPayantsParMatiere(windows),
    kpiEgtTotal(windows),
  ]);

  return { passagesParSite, fluxPayantsParMatiere, egtTotal };
}

/* =========================================================================
 * Onglet 3 — Redevance Incitative (RI)
 * ======================================================================= */

/**
 * Deux familles bien distinctes d'indicateurs RI :
 *  - FLOW  : un compteur d'événements du mois (arrivées, départs), pour
 *            lesquels sommer plusieurs mois donne un vrai cumul YTD.
 *  - SNAPSHOT : une "photographie à l'instant T" (parc de bacs, nombre de
 *            redevables, anomalies en cours…). Sommer 5 mois de photos
 *            n'a AUCUN sens (ça ne fait que quintupler un stock). Pour ces
 *            indicateurs, le "cumul" affiché est donc la valeur au dernier
 *            mois disponible de la période — pas une somme.
 */
type RiIndicatorKind = "FLOW" | "SNAPSHOT";

async function sumRiValeurs(indicateur: string, moisReferences: string[]): Promise<number> {
  if (moisReferences.length === 0) return 0;
  const rows = await prisma.riIndicateur.findMany({
    where: { indicateur, moisReference: { in: moisReferences } },
    select: { valeur: true },
  });
  return rows.reduce((acc, r) => acc + r.valeur, 0);
}

async function getRiValeur(indicateur: string, moisReference: string): Promise<number> {
  const row = await prisma.riIndicateur.findUnique({
    where: { moisReference_indicateur: { moisReference, indicateur } },
  });
  return row?.valeur ?? 0;
}

async function riFlowWindow(indicateur: string, windows: FourWindows): Promise<KpiWindow> {
  const [mois, cumul, moisN1, cumulN1] = await Promise.all([
    sumRiValeurs(indicateur, windows.moisReferenceList),
    sumRiValeurs(indicateur, windows.cumulReferenceList),
    sumRiValeurs(indicateur, [windows.moisReferenceN1]),
    sumRiValeurs(indicateur, windows.cumulReferenceN1List),
  ]);
  return buildKpiWindow(mois, cumul, moisN1, cumulN1);
}

async function riSnapshotWindow(indicateur: string, windows: FourWindows): Promise<KpiWindow> {
  const mois = await getRiValeur(indicateur, windows.moisReferenceList[0]);
  const moisN1 = await getRiValeur(indicateur, windows.moisReferenceN1);
  // Pour un stock, le "cumul" pertinent est la valeur constatée en fin de
  // période, identique à "mois" — jamais une somme des photos mensuelles.
  return buildKpiWindow(mois, mois, moisN1, moisN1);
}

async function computeRiIndicator(indicateur: string, kind: RiIndicatorKind, windows: FourWindows): Promise<KpiWindow> {
  return kind === "FLOW" ? riFlowWindow(indicateur, windows) : riSnapshotWindow(indicateur, windows);
}

export async function getRiTab(windows: FourWindows) {
  const [arrivees, departs, redevablesPart, redevablesPro, redevablesAdmin, clientsBac, clientsSac, clientsConvention, clientsPav, anomalie0Levee, anomalie0Depot, sansDotation, dossiersEnCours] =
    await Promise.all([
      computeRiIndicator("ARRIVEES_CLIENTS", "FLOW", windows),
      computeRiIndicator("DEPARTS_CLIENTS", "FLOW", windows),
      computeRiIndicator("REDEVABLES_PART", "SNAPSHOT", windows),
      computeRiIndicator("REDEVABLES_PRO", "SNAPSHOT", windows),
      computeRiIndicator("REDEVABLES_ADMIN", "SNAPSHOT", windows),
      computeRiIndicator("CLIENTS_BAC", "SNAPSHOT", windows),
      computeRiIndicator("CLIENTS_SAC", "SNAPSHOT", windows),
      computeRiIndicator("CLIENTS_CONVENTION", "SNAPSHOT", windows),
      computeRiIndicator("CLIENTS_PAV", "SNAPSHOT", windows),
      computeRiIndicator("ANOMALIE_0_LEVEE", "SNAPSHOT", windows),
      computeRiIndicator("ANOMALIE_0_DEPOT", "SNAPSHOT", windows),
      computeRiIndicator("CLIENTS_SANS_DOTATION", "SNAPSHOT", windows),
      computeRiIndicator("DOSSIERS_EN_COURS", "SNAPSHOT", windows),
    ]);

  return {
    mouvements: { arrivees, departs },
    typologie: { particulier: redevablesPart, professionnel: redevablesPro, administration: redevablesAdmin },
    parc: { bac: clientsBac, sac: clientsSac, convention: clientsConvention, pav: clientsPav },
    anomalies: {
      zeroLevee: anomalie0Levee,
      zeroDepot: anomalie0Depot,
      sansDotation: sansDotation,
      dossiersEnCours: dossiersEnCours,
    },
  };
}

/* =========================================================================
 * Onglet 4 — Collecte Sélective (CS)
 * ======================================================================= */

/** CsIndicateur stocke de vrais flux mensuels (tonnages, litres, km parcourus
 * dans le mois) : contrairement au RI, sommer plusieurs mois pour un cumul
 * YTD est ici toujours sémantiquement correct. */
async function sumCsValeurs(indicateur: string, moisReferences: string[]): Promise<number> {
  if (moisReferences.length === 0) return 0;
  const rows = await prisma.csIndicateur.findMany({
    where: { indicateur, moisReference: { in: moisReferences } },
    select: { valeur: true },
  });
  return rows.reduce((acc, r) => acc + r.valeur, 0);
}

async function getCsValeur(indicateur: string, moisReference: string): Promise<number> {
  const row = await prisma.csIndicateur.findUnique({
    where: { moisReference_indicateur: { moisReference, indicateur } },
  });
  return row?.valeur ?? 0;
}

async function csFlowWindow(indicateur: string, windows: FourWindows): Promise<KpiWindow> {
  const [mois, cumul, moisN1, cumulN1] = await Promise.all([
    sumCsValeurs(indicateur, windows.moisReferenceList),
    sumCsValeurs(indicateur, windows.cumulReferenceList),
    sumCsValeurs(indicateur, [windows.moisReferenceN1]),
    sumCsValeurs(indicateur, windows.cumulReferenceN1List),
  ]);
  return buildKpiWindow(mois, cumul, moisN1, cumulN1);
}

async function kpiVerre(windows: FourWindows): Promise<KpiWindow> {
  // NB SQLite : `contains` compile en `LIKE '%...%'`, et SQLite est
  // insensible à la casse sur LIKE pour les caractères ASCII par défaut
  // (pas besoin de `mode: "insensitive"`, non supporté par ce provider).
  const sumFn = async (range: DateRange): Promise<number> => {
    const result = await prisma.pesee.aggregate({
      _sum: { poidsNet: true },
      where: { produit: { contains: "VERRE" }, date: { gte: range.start, lt: range.end } },
    });
    return result._sum.poidsNet ?? 0;
  };
  return sumFourWindows(windows, sumFn);
}

async function kpiEfficienceFlotte(vehiculeLabel: string, consoKey: string, kmKey: string, windows: FourWindows) {
  const [conso, km, consoN1, kmN1] = await Promise.all([
    getCsValeur(consoKey, windows.moisReferenceList[0]),
    getCsValeur(kmKey, windows.moisReferenceList[0]),
    getCsValeur(consoKey, windows.moisReferenceN1),
    getCsValeur(kmKey, windows.moisReferenceN1),
  ]);

  const conso100 = km > 0 ? Math.round((conso / km) * 100 * 100) / 100 : null;
  const conso100N1 = kmN1 > 0 ? Math.round((consoN1 / kmN1) * 100 * 100) / 100 : null;
  const evolutionPct = conso100 !== null && conso100N1 !== null ? computeEvolutionPct(conso100, conso100N1) : null;

  return {
    vehicule: vehiculeLabel,
    conso100KmMois: conso100,
    conso100KmMoisN1: conso100N1,
    evolutionPct,
    // Moins de litres/100km = amélioration ; on l'expose explicitement pour
    // que le front n'ait pas à réinventer la sémantique du signe.
    ameliore: evolutionPct !== null ? evolutionPct < 0 : null,
  };
}

export async function getCsTab(windows: FourWindows) {
  const [emballagesRegie, papier, tlc, verre, efficienceEvolupac, efficienceEvoluvrac] = await Promise.all([
    csFlowWindow("EMBALLAGES_REGIE", windows),
    csFlowWindow("PAPIER_QUINCIEUX", windows),
    csFlowWindow("TLC_LE_RELAIS", windows),
    kpiVerre(windows),
    kpiEfficienceFlotte("Evolupac A", "CONSO_EVOLUPAC", "KM_EVOLUPAC", windows),
    kpiEfficienceFlotte("Evoluvrac B", "CONSO_EVOLUVRAC", "KM_EVOLUVRAC", windows),
  ]);

  return {
    tonnages: {
      // ⚠️ "Emballages déchèterie" (2ᵉ composante attendue par la maquette
      // PDF) n'a pas de source distincte dans le schéma actuel : le
      // workflow EGT importe des matières (Déchets verts, Gravats,
      // Cartons…) qui n'incluent pas "Emballages". En l'état on n'expose
      // donc que la part Régie (EMBALLAGES_REGIE), réellement tracée.
      emballagesRegie,
      papier,
      tlc,
      verre,
    },
    efficienceFlotte: [efficienceEvolupac, efficienceEvoluvrac],
  };
}
