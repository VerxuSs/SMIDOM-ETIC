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

// Récupère les plaques d'immatriculation associées à une ou plusieurs fonctions
async function getImmatriculationsByFonction(fonctions: string | string[]): Promise<string[]> {
  const condition = Array.isArray(fonctions) ? { in: fonctions } : fonctions;
  const vehicules = await prisma.vehicule.findMany({
    where: { fonction: condition },
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

// Calcule le total Sytraival (Somme de BOM, PAV et Entretien PAV)
async function kpiTotalOmrSytraival(windows: FourWindows): Promise<KpiWindow> {
  const immats = await getImmatriculationsByFonction(["Collecte BOM", "Collecte PAV", "Collecte entretien PAV"]);
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

// Transfert Serfim (identifié par l'immatriculation factice "SERFIM" lors de l'import)
async function kpiTransfertSerfim(windows: FourWindows): Promise<KpiWindow> {
  const sumFn = async (range: DateRange): Promise<number> => {
    const result = await prisma.pesee.aggregate({
      _sum: { poidsNet: true },
      where: { immatriculation: "SERFIM", date: { gte: range.start, lt: range.end } },
    });
    return result._sum.poidsNet ?? 0;
  };
  return sumFourWindows(windows, sumFn);
}

// --- Helpers pour la nouvelle table OmrIndicateur ---
async function sumOmrValeurs(indicateur: string, periodes: string[]): Promise<number> {
  if (periodes.length === 0) return 0;
  const rows = await prisma.omrIndicateur.findMany({
    where: { indicateur, periodeReference: { in: periodes } },
    select: { valeur: true },
  });
  return rows.reduce((acc, r) => acc + r.valeur, 0);
}

async function getOmrValeur(indicateur: string, periode: string): Promise<number> {
  const row = await prisma.omrIndicateur.findUnique({
    where: { periodeReference_indicateur: { periodeReference: periode, indicateur } },
  });
  return row?.valeur ?? 0;
}

export async function getOmrTab(windows: FourWindows) {
  const [
    collecteBOM,
    collectePAV,
    collecteEntretienPAV,
    totalOmrSytraival,
    transfertSerfim,

    // Bio-déchets (Flux mensuel)
    bioMois, bioCumul, bioMoisN1, bioCumulN1,

    // Parcs (Instantanés globaux)
    parcBacs,
    parcCartes
  ] = await Promise.all([
    kpiCollecteParFonction("Collecte BOM", windows),
    kpiCollecteParFonction("Collecte PAV", windows),
    kpiCollecteParFonction("Collecte entretien PAV", windows),
    kpiTotalOmrSytraival(windows),
    kpiTransfertSerfim(windows),

    // Récupération des Bio-déchets
    sumOmrValeurs("TOTAL_BIODECHETS", windows.moisReferenceList),
    sumOmrValeurs("TOTAL_BIODECHETS", windows.cumulReferenceList),
    sumOmrValeurs("TOTAL_BIODECHETS", [windows.moisReferenceN1]),
    sumOmrValeurs("TOTAL_BIODECHETS", windows.cumulReferenceN1List),

    // Récupération des données globales
    getOmrValeur("PARC_BACS_PARTICULIERS", windows.periodeGlobale),
    getOmrValeur("PARC_CARTES_PAV", windows.periodeGlobale),
  ]);

  return {
    collecteBOM,
    collectePAV,
    collecteEntretienPAV,
    totalOmrSytraival,
    transfertSerfim,
    // Formatage manuel des KPI via buildKpiWindow
    bioDechetsTotal: buildKpiWindow(bioMois, bioCumul, bioMoisN1, bioCumulN1),
    parcBacsParticuliers: buildKpiWindow(parcBacs, parcBacs, parcBacs, parcBacs),
    parcCartesPav: buildKpiWindow(parcCartes, parcCartes, parcCartes, parcCartes),
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
  // 1. Définir une fonction pour récupérer le total selon la période
  // On utilise une fonction générique pour ne pas dupliquer la logique
  const sumEcoSol = async (periode: string): Promise<number> => {
    const res = await prisma.dechetterieFlux.aggregate({
      where: { prestataire: "Eco'Sol", periodeReference: periode },
      _sum: { poidsTonnes: true }
    });
    return res._sum.poidsTonnes ?? 0;
  };

  // 2. Récupérer les valeurs pour les 4 fenêtres (Mois, Cumul, N-1, Cumul N-1)
  // Note : pour Eco'Sol qui est TRIMESTRIEL, on utilise la logique trimestrielle
  const [mois, cumul, moisN1, cumulN1] = await Promise.all([
    sumEcoSol(windows.periodeTrimestre),      // Trimestre actuel
    sumEcoSol(windows.periodeAnnee),          // Année actuelle (Cumul)
    sumEcoSol(windows.periodeTrimestreN1),    // Trimestre N-1
    sumEcoSol(windows.periodeAnneeN1),        // Année N-1 (Cumul)
  ]);

  const ecoSolKpi = buildKpiWindow(mois, cumul, moisN1, cumulN1);

  // 3. Appel des autres fonctions existantes
  const [passagesParSite, fluxPayantsParMatiere, egtTotal] = await Promise.all([
    kpiPassagesParSite(windows),
    kpiFluxPayantsParMatiere(windows),
    kpiEgtTotal(windows),
  ]);

  return {
    passagesParSite,
    ecoSol: ecoSolKpi,
    fluxPayantsParMatiere,
    egtTotal
  };
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

async function sumRiValeurs(indicateur: string, periodes: string[]): Promise<number> {
  if (periodes.length === 0) return 0;
  const rows = await prisma.riIndicateur.findMany({
    where: { indicateur, periodeReference: { in: periodes } },
    select: { valeur: true },
  });
  return rows.reduce((acc, r) => acc + r.valeur, 0);
}

async function getRiValeur(indicateur: string, periode: string): Promise<number> {
  const row = await prisma.riIndicateur.findUnique({
    where: { periodeReference_indicateur: { periodeReference: periode, indicateur } },
  });
  return row?.valeur ?? 0;
}

// 1. Pour les flux (Mouvements) : utilisation de windows.periodeAnnee
async function riFlowWindow(indicateur: string, windows: FourWindows): Promise<KpiWindow> {
  // Les mouvements sont annuels, on interroge l'année
  const [valeur, n1] = await Promise.all([
    getRiValeur(indicateur, windows.periodeAnnee),
    getRiValeur(indicateur, windows.periodeAnneeN1)
  ]);
  return buildKpiWindow(valeur, valeur, n1, n1);
}

// 2. Pour les Snapshots (Parcs, Redevables) : utilisation de windows.periodeGlobale
async function riSnapshotWindow(indicateur: string, windows: FourWindows): Promise<KpiWindow> {
  const valeur = await getRiValeur(indicateur, windows.periodeGlobale);
  // Pour le snapshot, on n'a pas toujours de N-1 historique,
  // on peut renvoyer la valeur courante en attendant.
  return buildKpiWindow(valeur, valeur, valeur, valeur);
}

// 3. Pour les Anomalies (Trimestrielles) : utilisation de windows.periodeTrimestre
async function riTrimestrielWindow(indicateur: string, windows: FourWindows): Promise<KpiWindow> {
  const [valeur, n1] = await Promise.all([
    getRiValeur(indicateur, windows.periodeTrimestre),
    getRiValeur(indicateur, windows.periodeTrimestreN1)
  ]);
  return buildKpiWindow(valeur, valeur, n1, n1);
}

async function computeRiIndicator(indicateur: string, kind: RiIndicatorKind, windows: FourWindows): Promise<KpiWindow> {
  return kind === "FLOW" ? riFlowWindow(indicateur, windows) : riSnapshotWindow(indicateur, windows);
}

export async function getRiTab(windows: FourWindows) {
  const [arrivees, departs, redevablesPart, redevablesPro, redevablesAdmin, clientsBac, clientsSac, clientsConvention, clientsPav, anomalie0Levee, anomalie0Depot, sansDotation, dossiersEnCours] =
      await Promise.all([
        riFlowWindow("ARRIVEES_CLIENTS", windows),          // Annuel
        riFlowWindow("DEPARTS_CLIENTS", windows),           // Annuel
        riSnapshotWindow("REDEVABLES_PART", windows),       // Global
        riSnapshotWindow("REDEVABLES_PRO", windows),        // Global
        riSnapshotWindow("REDEVABLES_ADMIN", windows),      // Global
        riSnapshotWindow("CLIENTS_BAC", windows),           // Global
        riSnapshotWindow("CLIENTS_SAC", windows),           // Global
        riTrimestrielWindow("CLIENTS_CONVENTION", windows), // Trimestriel
        riSnapshotWindow("CLIENTS_PAV", windows),           // Global
        riTrimestrielWindow("ANOMALIE_0_LEVEE", windows),   // Trimestriel
        riTrimestrielWindow("ANOMALIE_0_DEPOT", windows),   // Trimestriel
        riTrimestrielWindow("CLIENTS_SANS_DOTATION", windows), // Trimestriel
        riTrimestrielWindow("DOSSIERS_EN_COURS", windows),     // Trimestriel
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

// NOUVEAU CODE : On utilise `periodeReference` au lieu de `moisReference`

async function sumCsValeurs(indicateur: string, moisReferences: string[]): Promise<number> {
  if (moisReferences.length === 0) return 0;
  const rows = await prisma.csIndicateur.findMany({
    where: {
      indicateur,
      periodeReference: { in: moisReferences }
    },
    select: { valeur: true },
  });
  return rows.reduce((acc, r) => acc + r.valeur, 0);
}

async function getCsValeur(indicateur: string, moisReference: string): Promise<number> {
  const row = await prisma.csIndicateur.findUnique({
    where: {
      periodeReference_indicateur: {
        periodeReference: moisReference,
        indicateur
      }
    },
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
