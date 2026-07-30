import { parseTargetMonth } from "@/lib/targetMonth";

/**
 * Le cœur générique du Dashboard : à partir d'un seul mois de référence,
 * calcule les bornes des 4 fenêtres temporelles utilisées par TOUS les
 * indicateurs, quel que soit le module (OMR, Déchèteries, RI, CS).
 *
 * - `mois` / `cumul` / `moisN1` / `cumulN1` : bornes [start, end) pour les
 *   tables à grain fin (Pesee, SuiviVehicule, BioDechet, DechetteriePassage,
 *   DechetterieFlux), filtrées avec `date: { gte: start, lt: end }`.
 * - `moisReferenceList` / `cumulReferenceList` / … : listes de chaînes
 *   "AAAA-MM" pour les tables déjà pré-agrégées par mois (désormais via le
 *   champ `periodeReference`).
 * - `periodeTrimestre` / `periodeAnnee` / `periodeGlobale` : nouvelles clés
 *   qui permettent de requêter directement les indicateurs trimestriels,
 *   annuels ou à l'instant T dans la BDD.
 */

export type DateRange = { start: Date; end: Date };

export type FourWindows = {
  mois: DateRange;
  cumul: DateRange;

  // ⚠️ ATTENTION : Suite au changement de règle métier, "moisN1" contient désormais
  // les données du MOIS PRÉCÉDENT (M-1) et non plus de l'année précédente.
  // Le nom de la variable est conservé pour la rétrocompatibilité avec le reste du code.
  moisN1: DateRange;

  // Le cumulN1, lui, reste sur l'année précédente (Year-To-Date N-1)
  cumulN1: DateRange;

  /** Pour les tables pré-agrégées (RiIndicateur, CsIndicateur, OmrIndicateur) au format mensuel. */
  moisReferenceList: string[];
  cumulReferenceList: string[];
  moisReferenceN1: string; // <-- Contient désormais la chaîne du mois précédent (ex: "2026-04" si mois = "2026-05")
  cumulReferenceN1List: string[];

  // NOUVEAUX CHAMPS TEMPORELS POUR LA BDD (champ `periodeReference`) :
  periodeMois: string;       // ex: "2026-05"
  periodeTrimestre: string;  // ex: "2026-T2"
  periodeAnnee: string;      // ex: "2026-ANNUEL"
  periodeGlobale: string;    // Toujours "GLOBALE"

  // Historique des nouvelles périodes :
  periodeTrimestreN1: string; // ex: "2025-T2"
  periodeAnneeN1: string;     // ex: "2025-ANNUEL"

  /** Utile pour l'affichage ("Mai 2026", "Janv. - Mai 2026"…). */
  label: { mois: string; moisN1: string; year: number; yearN1: number; monthIndex: number };
};

export function computeFourWindows(targetMonth: string): FourWindows {
  const info = parseTargetMonth(targetMonth);
  if (!info) {
    throw new Error(`Mois de référence invalide : "${targetMonth}" (format attendu : AAAA-MM).`);
  }
  const { year, monthIndex } = info;
  const yearN1 = year - 1;

  // 1. Bornes du mois en cours
  const monthStart = new Date(Date.UTC(year, monthIndex, 1));
  const monthEnd = new Date(Date.UTC(year, monthIndex + 1, 1));

  // 2. Bornes du cumul de l'année en cours (YTD)
  const yearStart = new Date(Date.UTC(year, 0, 1));
  const cumulEnd = monthEnd;

  // 3. NOUVEAU : Bornes du MOIS PRÉCÉDENT (M-1)
  // L'objet Date de JavaScript recule automatiquement au mois de décembre de l'année précédente si (monthIndex - 1) < 0
  const monthStartM1 = new Date(Date.UTC(year, monthIndex - 1, 1));
  const monthEndM1 = new Date(Date.UTC(year, monthIndex, 1));

  // 4. Bornes du cumul de l'année précédente (YTD N-1)
  const yearStartN1 = new Date(Date.UTC(yearN1, 0, 1));
  const cumulEndN1 = new Date(Date.UTC(yearN1, monthIndex + 1, 1));

  // Listes de références mensuelles
  const pad = (n: number) => String(n).padStart(2, "0");
  const moisReferenceList = [`${year}-${pad(monthIndex + 1)}`];
  const cumulReferenceList = Array.from({ length: monthIndex + 1 }, (_, i) => `${year}-${pad(i + 1)}`);

  // NOUVEAU : Calcul exact de la chaîne "AAAA-MM" pour le mois précédent
  let prevYear = year;
  let prevMonthIndex = monthIndex - 1;
  if (prevMonthIndex < 0) {
    prevMonthIndex = 11; // 11 = Décembre
    prevYear -= 1;
  }
  const moisReferenceM1 = `${prevYear}-${pad(prevMonthIndex + 1)}`;

  const cumulReferenceN1List = Array.from({ length: monthIndex + 1 }, (_, i) => `${yearN1}-${pad(i + 1)}`);

  // Calcul du trimestre (1 à 4)
  const quarter = Math.ceil((monthIndex + 1) / 3);

  return {
    mois: { start: monthStart, end: monthEnd },
    cumul: { start: yearStart, end: cumulEnd },
    moisN1: { start: monthStartM1, end: monthEndM1 }, // Alimenté avec le mois précédent !
    cumulN1: { start: yearStartN1, end: cumulEndN1 },

    moisReferenceList,
    cumulReferenceList,
    moisReferenceN1: moisReferenceM1, // Alimenté avec le mois précédent !
    cumulReferenceN1List,

    // Les clés exactes qui serviront à interroger le champ `periodeReference` de Prisma
    periodeMois: targetMonth,
    periodeTrimestre: `${year}-T${quarter}`,
    periodeAnnee: `${year}-ANNUEL`,
    periodeGlobale: "GLOBALE",

    // Historique
    periodeTrimestreN1: `${yearN1}-T${quarter}`,
    periodeAnneeN1: `${yearN1}-ANNUEL`,

    label: { mois: info.fullLabel, moisN1: info.fullLabel, year, yearN1, monthIndex },
  };
}

/* -------------------------------------------------------------------------
 * KpiWindow — le "contrat" générique consommé par tous les composants
 * graphiques du Dashboard (DuoChart, StatCard, AlertCard…).
 * ---------------------------------------------------------------------- */

export type KpiWindow = {
  mois: number;
  cumul: number;
  moisN1: number; // Correspond désormais au mois précédent
  cumulN1: number;
  /** Évolution en % (1 décimale), `null` si moisN1 vaut 0 (division impossible). */
  evolMois: number | null;
  evolCumul: number | null;
};

export function computeEvolutionPct(current: number, previous: number): number | null {
  if (!previous) return null;
  return Math.round(((current - previous) / previous) * 1000) / 10;
}

export function buildKpiWindow(mois: number, cumul: number, moisN1: number, cumulN1: number): KpiWindow {
  return {
    mois,
    cumul,
    moisN1,
    cumulN1,
    evolMois: computeEvolutionPct(mois, moisN1),
    evolCumul: computeEvolutionPct(cumul, cumulN1),
  };
}

/**
 * LE mécanisme générique anti-duplication : prend une simple fonction
 * `sumFn(range) => Promise<number>` (typiquement un `prisma.xxx.aggregate`
 * ou `.count` sur UNE table) et l'exécute en parallèle sur les 4 fenêtres.
 * Chaque KPI "à grain fin" (Pesee, DechetterieFlux, Passage…)
 * se résume donc à UNE fonction d'une ligne + un appel à `sumFourWindows`.
 */
export async function sumFourWindows(
    windows: FourWindows,
    sumFn: (range: DateRange) => Promise<number>
): Promise<KpiWindow> {
  const [mois, cumul, moisN1, cumulN1] = await Promise.all([
    sumFn(windows.mois),
    sumFn(windows.cumul),
    sumFn(windows.moisN1),
    sumFn(windows.cumulN1),
  ]);
  return buildKpiWindow(mois, cumul, moisN1, cumulN1);
}
