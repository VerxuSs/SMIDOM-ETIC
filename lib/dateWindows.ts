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
 *   "AAAA-MM" pour les tables déjà pré-agrégées par mois (RiIndicateur,
 *   CsIndicateur), filtrées avec `moisReference: { in: [...] }`.
 *
 * Toute la logique de calendrier vit ICI et nulle part ailleurs : chaque
 * requête KPI se contente de fournir un "sumFn(range)" ou de consommer les
 * listes de moisReference, sans jamais recalculer une borne de date.
 */

export type DateRange = { start: Date; end: Date };

export type FourWindows = {
  mois: DateRange;
  cumul: DateRange;
  moisN1: DateRange;
  cumulN1: DateRange;

  /** Pour les tables pré-agrégées (RiIndicateur, CsIndicateur). */
  moisReferenceList: string[];
  cumulReferenceList: string[];
  moisReferenceN1: string;
  cumulReferenceN1List: string[];

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

  // Bornes en fin exclusive (`lt`) : le 1er jour du mois suivant, jamais un
  // "23:59:59" fragile face aux dates stockées en UTC minuit.
  const monthStart = new Date(Date.UTC(year, monthIndex, 1));
  const monthEnd = new Date(Date.UTC(year, monthIndex + 1, 1));

  const yearStart = new Date(Date.UTC(year, 0, 1));
  const cumulEnd = monthEnd;

  const monthStartN1 = new Date(Date.UTC(yearN1, monthIndex, 1));
  const monthEndN1 = new Date(Date.UTC(yearN1, monthIndex + 1, 1));

  const yearStartN1 = new Date(Date.UTC(yearN1, 0, 1));
  const cumulEndN1 = monthEndN1;

  const pad = (n: number) => String(n).padStart(2, "0");
  const moisReferenceList = [`${year}-${pad(monthIndex + 1)}`];
  const cumulReferenceList = Array.from({ length: monthIndex + 1 }, (_, i) => `${year}-${pad(i + 1)}`);
  const moisReferenceN1 = `${yearN1}-${pad(monthIndex + 1)}`;
  const cumulReferenceN1List = Array.from({ length: monthIndex + 1 }, (_, i) => `${yearN1}-${pad(i + 1)}`);

  return {
    mois: { start: monthStart, end: monthEnd },
    cumul: { start: yearStart, end: cumulEnd },
    moisN1: { start: monthStartN1, end: monthEndN1 },
    cumulN1: { start: yearStartN1, end: cumulEndN1 },
    moisReferenceList,
    cumulReferenceList,
    moisReferenceN1,
    cumulReferenceN1List,
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
  moisN1: number;
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
 * Chaque KPI "à grain fin" (Pesee, BioDechet, DechetterieFlux, Passage…)
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
