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
  const sumFn = async (range: DateRange): Promise<number> => {
    const result = await prisma.pesee.aggregate({
      _sum: { poidsNet: true },
      where: { date: { gte: range.start, lt: range.end } },
    });
    return result._sum.poidsNet ?? 0;
  };
  return sumFourWindows(windows, sumFn);
}

// Transfert Serfim (identifié par l'immatriculation factice "SERFIM" lors de l'import)
async function kpiTransfertSerfim(windows: FourWindows): Promise<KpiWindow> {
  const [mois, cumul, moisN1, cumulN1] = await Promise.all([
    sumOmrValeurs("TRANSFERT_SERFIM", windows.moisReferenceList),
    sumOmrValeurs("TRANSFERT_SERFIM", windows.cumulReferenceList),
    sumOmrValeurs("TRANSFERT_SERFIM", [windows.moisReferenceN1]),
    sumOmrValeurs("TRANSFERT_SERFIM", windows.cumulReferenceN1List),
  ]);
  return buildKpiWindow(mois, cumul, moisN1, cumulN1);
}

// --- Helpers pour la table OmrIndicateur ---
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

async function kpiEfficienceFlotteOmr(windows: FourWindows) {
  // 1. On cherche les camions BOM (Adapte le nom exact si besoin)
  const immats = await getImmatriculationsByFonction(["Collecte BOM", "BOM"]);

  // Fonction interne pour additionner KMS et LITRES sur un mois donné
  const getStatsForMonth = async (monthStr: string) => {
    if (immats.length === 0) return { km: 0, litres: 0 };
    const [year, month] = monthStr.split("-").map(Number);
    const startDate = new Date(year, month - 1, 1);
    const endDate = new Date(year, month, 1); // 1er du mois suivant

    // Prisma additionne toutes les lignes qui tombent dans ce mois
    const result = await prisma.suiviVehicule.aggregate({
      _sum: { distanceKm: true, litresCarburant: true },
      where: {
        immatriculation: { in: immats },
        date: { gte: startDate, lt: endDate }
      }
    });
    return {
      km: result._sum.distanceKm ?? 0,
      litres: result._sum.litresCarburant ?? 0
    };
  };

  // Récupère la chaîne de caractères du mois en cours
  const currentMonthStr = windows.moisReferenceList[0];

  // Calcule la chaîne du mois précédent (M-1)
  const [year, month] = currentMonthStr.split("-").map(Number);
  let prevYear = year; let prevMonth = month - 1;
  if (prevMonth === 0) { prevMonth = 12; prevYear -= 1; }
  const prevMonthStr = `${prevYear}-${String(prevMonth).padStart(2, "0")}`;

  // Récupère les totaux
  const current = await getStatsForMonth(currentMonthStr);
  console.log(current);
  const prev = await getStatsForMonth(prevMonthStr);

  // Calcule le ratio L/100km
  const conso100 = current.km > 0 ? Math.round((current.litres / current.km) * 10000) / 100 : null;
  const conso100M1 = prev.km > 0 ? Math.round((prev.litres / prev.km) * 10000) / 100 : null;
  const evolutionPct = conso100 !== null && conso100M1 !== null ? computeEvolutionPct(conso100, conso100M1) : null;

  return {
    vehicule: "Flotte BOM",
    kmMois: current.km,
    litresMois: current.litres,
    conso100KmMois: conso100,
    conso100KmMoisN1: conso100M1,
    evolutionPct,
    ameliore: evolutionPct !== null ? evolutionPct < 0 : null,
  };
}

export async function getOmrTab(windows: FourWindows) {
  const [
    collecteBOM,
    collectePAV,
    collecteEntretienPAV,
    totalOmrSytraival,
    transfertSerfim,
    bioMois, bioCumul, bioMoisN1, bioCumulN1,
    parcBacs,
    parcCartes,
    efficienceFlotteBOM
  ] = await Promise.all([
    kpiCollecteParFonction("Collecte BOM", windows),
    kpiCollecteParFonction("Collecte PAV", windows),
    kpiCollecteParFonction("Collecte entretien PAV", windows),
    kpiTotalOmrSytraival(windows),
    kpiTransfertSerfim(windows),
    sumOmrValeurs("TOTAL_BIODECHETS", windows.moisReferenceList),
    sumOmrValeurs("TOTAL_BIODECHETS", windows.cumulReferenceList),
    sumOmrValeurs("TOTAL_BIODECHETS", [windows.moisReferenceN1]),
    sumOmrValeurs("TOTAL_BIODECHETS", windows.cumulReferenceN1List),
    getOmrValeur("PARC_BACS_PARTICULIERS", windows.periodeGlobale),
    getOmrValeur("PARC_CARTES_PAV", windows.periodeGlobale),
    kpiEfficienceFlotteOmr(windows),
  ]);

  return {
    collecteBOM,
    collectePAV,
    collecteEntretienPAV,
    totalOmrSytraival,
    transfertSerfim,
    bioDechetsTotal: buildKpiWindow(bioMois, bioCumul, bioMoisN1, bioCumulN1),
    parcBacsParticuliers: buildKpiWindow(parcBacs, parcBacs, parcBacs, parcBacs),
    parcCartesPav: buildKpiWindow(parcCartes, parcCartes, parcCartes, parcCartes),
    efficienceFlotteBOM
  };
}

/* =========================================================================
 * Onglet 2 — Déchèteries
 * ======================================================================= */

async function kpiPassagesParSite(windows: FourWindows) {
  // Optimisation : Promise.all pour exécuter les requêtes en parallèle
  const promises = TERRITOIRE_SITES.map(({ canon }) => {
    const sumFn = (range: DateRange) =>
        prisma.dechetteriePassage.count({
          where: { site: canon, datePassage: { gte: range.start, lt: range.end } },
        });
    return sumFourWindows(windows, sumFn).then(kpi => ({ site: canon, kpi }));
  });
  return Promise.all(promises);
}

// Helper 1 : Calcule le Total par site pour un ou plusieurs prestataires
async function kpiProviderTotalBySite(prestataires: string | string[], windows: FourWindows) {
  const prestatairesArray = Array.isArray(prestataires) ? prestataires : [prestataires];

  const promises = TERRITOIRE_SITES.map(({ canon }) => {
    const sumFn = async (range: DateRange): Promise<number> => {
      const result = await prisma.dechetterieFlux.aggregate({
        _sum: { poidsTonnes: true },
        where: {
          prestataire: { in: prestatairesArray },
          site: canon,
          dateCollecte: { gte: range.start, lt: range.end }
        },
      });
      return result._sum.poidsTonnes ?? 0;
    };
    return sumFourWindows(windows, sumFn).then(kpi => ({ site: canon, kpi }));
  });
  return Promise.all(promises);
}

// Helper 2 : Extrait les matières d'un prestataire et calcule le Total + le détail
async function kpiProviderBySiteAndMatiere(prestataire: string, windows: FourWindows) {
  const matieresRows = await prisma.dechetterieFlux.findMany({
    where: { prestataire },
    select: { matiere: true },
    distinct: ["matiere"],
    orderBy: { matiere: "asc" },
  });
  const matieres = matieresRows.map((r) => r.matiere).filter(Boolean);

  const totalParSite = await kpiProviderTotalBySite(prestataire, windows);

  // Optimisation majeure : on lance toutes les requêtes croisées en parallèle
  const promises = [];
  for (const { canon } of TERRITOIRE_SITES) {
    for (const matiere of matieres) {
      const sumFn = async (range: DateRange): Promise<number> => {
        const result = await prisma.dechetterieFlux.aggregate({
          _sum: { poidsTonnes: true },
          where: {
            prestataire,
            site: canon,
            matiere,
            dateCollecte: { gte: range.start, lt: range.end }
          },
        });
        return result._sum.poidsTonnes ?? 0;
      };
      promises.push(sumFourWindows(windows, sumFn).then(kpi => ({ site: canon, matiere, kpi })));
    }
  }
  const parSiteEtMatiere = await Promise.all(promises);

  return { matieres, totalParSite, parSiteEtMatiere };
}

// Helper pour calculer le trimestre précédent (ex: "2026-T1" -> "2025-T4")
function getPreviousQuarter(quarterStr: string): string {
  const parts = quarterStr.split("-T");
  if (parts.length !== 2) return quarterStr;
  let y = parseInt(parts[0], 10);
  let q = parseInt(parts[1], 10);

  q -= 1;
  if (q === 0) {
    q = 4;
    y -= 1;
  }
  return `${y}-T${q}`;
}

export async function getDecheteriesTab(windows: FourWindows) {
  const currentYearStr = windows.periodeTrimestre.split("-")[0];
  const lastYearStr = windows.periodeTrimestreN1.split("-")[0];

  const quartersCurrentYear = [`${currentYearStr}-T1`, `${currentYearStr}-T2`, `${currentYearStr}-T3`, `${currentYearStr}-T4`];
  const quartersLastYear = [`${lastYearStr}-T1`, `${lastYearStr}-T2`, `${lastYearStr}-T3`, `${lastYearStr}-T4`];

  // Calcul du trimestre précédent (Q-1)
  const prevQuarterStr = getPreviousQuarter(windows.periodeTrimestre);

  const sumFnEcoSol = async (periodes: string[]): Promise<number> => {
    const result = await prisma.dechetterieFlux.aggregate({
      _sum: { poidsTonnes: true },
      where: { prestataire: "Eco'Sol", periodeReference: { in: periodes } },
    });
    return result._sum.poidsTonnes ?? 0;
  };

  const sumFnMatiere = async (matiere: string, periodes: string[]): Promise<number> => {
    const result = await prisma.dechetterieFlux.aggregate({
      _sum: { poidsTonnes: true },
      where: { matiere: matiere, periodeReference: { in: periodes } },
    });
    return result._sum.poidsTonnes ?? 0;
  };

  const getKpiMatiere = async (matiere: string) => {
    const [mois, cumul, moisN1, cumulN1] = await Promise.all([
      sumFnMatiere(matiere, windows.moisReferenceList),
      sumFnMatiere(matiere, windows.cumulReferenceList),
      sumFnMatiere(matiere, [windows.moisReferenceN1]),
      sumFnMatiere(matiere, windows.cumulReferenceN1List),
    ]);
    return buildKpiWindow(mois, cumul, moisN1, cumulN1);
  };

  const [
    passagesParSite,
    ecoSolMois, ecoSolCumul, ecoSolMoisN1, ecoSolCumulN1,
    egt, chimirec, ecodds, chimirecEcoddsTotal,

    d3e,

    // NOUVEAUX FLUX MANUELS
    pneus, ecoMaison, ecoLogic, radiographies, huileVegetale
  ] = await Promise.all([
    kpiPassagesParSite(windows),

    sumFnEcoSol([windows.periodeTrimestre]),
    sumFnEcoSol(quartersCurrentYear),
    sumFnEcoSol([prevQuarterStr]),
    sumFnEcoSol(quartersLastYear),

    kpiProviderBySiteAndMatiere("EGT", windows),
    kpiProviderBySiteAndMatiere("Chimirec", windows),
    kpiProviderBySiteAndMatiere("EcoDDS", windows),
    kpiProviderTotalBySite(["Chimirec", "EcoDDS"], windows),

    kpiProviderBySiteAndMatiere("D3E", windows),

    getKpiMatiere("Pneus"),
    getKpiMatiere("Eco maison"),
    getKpiMatiere("Eco logic"),
    getKpiMatiere("Radiographies"),
    getKpiMatiere("Huile végétale"),
  ]);

  const ecoSolKpi = buildKpiWindow(ecoSolMois, ecoSolCumul, ecoSolMoisN1, ecoSolCumulN1);

  return {
    passagesParSite,
    ecoSol: ecoSolKpi,
    egt,
    chimirec,
    ecodds,
    chimirecEcoddsTotal,
    d3e,
    pneus,
    ecoMaison,
    ecoLogic,
    radiographies,
    huileVegetale
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

// 3. Pour les Anomalies et Convention (Trimestrielles)
async function riTrimestrielWindow(indicateur: string, windows: FourWindows): Promise<KpiWindow> {
  const currentYearStr = windows.periodeTrimestre.split("-")[0];
  const lastYearStr = windows.periodeTrimestreN1.split("-")[0];

  const quartersCurrentYear = [`${currentYearStr}-T1`, `${currentYearStr}-T2`, `${currentYearStr}-T3`, `${currentYearStr}-T4`];
  const quartersLastYear = [`${lastYearStr}-T1`, `${lastYearStr}-T2`, `${lastYearStr}-T3`, `${lastYearStr}-T4`];

  // Calcul du trimestre précédent (Q-1)
  const prevQuarterStr = getPreviousQuarter(windows.periodeTrimestre);

  const [valeurTrimestre, valeurCumul, n1Trimestre, n1Cumul] = await Promise.all([
    getRiValeur(indicateur, windows.periodeTrimestre),
    sumRiValeurs(indicateur, quartersCurrentYear),
    getRiValeur(indicateur, prevQuarterStr),
    sumRiValeurs(indicateur, quartersLastYear)
  ]);

  return buildKpiWindow(valeurTrimestre, valeurCumul, n1Trimestre, n1Cumul);
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
  // 1. On récupère les plaques d'immatriculation des véhicules affectés au verre
  // ⚠️ ATTENTION : Vérifie le texte exact dans ta base de données pour la fonction
  // (ex: "VERRE", "Collecte Verre", "PAV Verre", etc.) et modifie la chaîne ci-dessous si besoin.
  const immats = await getImmatriculationsByFonction("VERRE");

  const sumFn = async (range: DateRange): Promise<number> => {
    // Si on ne trouve aucun camion avec cette fonction, on renvoie 0 direct
    if (immats.length === 0) return 0;

    // 2. On fait la somme des pesées uniquement pour ces camions
    const result = await prisma.pesee.aggregate({
      _sum: { poidsNet: true },
      where: {
        immatriculation: { in: immats },
        date: { gte: range.start, lt: range.end }
      },
    });
    return result._sum.poidsNet ?? 0;
  };

  return sumFourWindows(windows, sumFn);
}

async function kpiEfficienceFlotte(vehiculeLabel: string, consoKey: string, kmKey: string, windows: FourWindows) {
  // 1. Récupération du mois actuel depuis la fenêtre globale
  const currentMonthStr = windows.moisReferenceList[0]; // ex: "2026-05"

  // 2. Calcul du mois précédent (M-1)
  const [year, month] = currentMonthStr.split("-").map(Number);
  let prevYear = year;
  let prevMonth = month - 1;
  if (prevMonth === 0) {
    prevMonth = 12;
    prevYear -= 1;
  }
  const prevMonthStr = `${prevYear}-${String(prevMonth).padStart(2, "0")}`; // ex: "2026-04"

  // 3. Appel à la BDD avec le mois actuel et le mois M-1
  const [conso, km, consoM1, kmM1] = await Promise.all([
    getCsValeur(consoKey, currentMonthStr),
    getCsValeur(kmKey, currentMonthStr),
    getCsValeur(consoKey, prevMonthStr), // <-- Mois précédent
    getCsValeur(kmKey, prevMonthStr),    // <-- Mois précédent
  ]);

  const conso100 = km > 0 ? Math.round((conso / km) * 100 * 100) / 100 : null;
  const conso100M1 = kmM1 > 0 ? Math.round((consoM1 / kmM1) * 100 * 100) / 100 : null;
  const evolutionPct = conso100 !== null && conso100M1 !== null ? computeEvolutionPct(conso100, conso100M1) : null;

  return {
    vehicule: vehiculeLabel,
    kmMois: km,
    litresMois: conso,
    conso100KmMois: conso100,
    conso100KmMoisN1: conso100M1,
    evolutionPct,
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
