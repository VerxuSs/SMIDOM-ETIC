/**
 * Le sélecteur de mois du front (`<input type="month">`) envoie une chaîne
 * au format "AAAA-MM" (ex: "2026-05"). Ce module centralise son parsing et
 * les libellés français utilisés pour retrouver la bonne colonne/valeur
 * dans les fichiers de type tableau croisé (D3E, Eco'Sol).
 */

export const FR_MONTH_ABBR = [
  "JAN", "FEV", "MAR", "AVR", "MAI", "JUN",
  "JUL", "AOU", "SEP", "OCT", "NOV", "DEC",
] as const;

export const FR_MONTH_FULL = [
  "Janvier", "Février", "Mars", "Avril", "Mai", "Juin",
  "Juillet", "Août", "Septembre", "Octobre", "Novembre", "Décembre",
] as const;

export type TargetMonthInfo = {
  year: number;
  monthIndex: number; // 0-11
  /** Premier jour du mois — sert de date de référence par défaut. */
  refDate: Date;
  /** Libellé "MAI 2026" (utilisé par le fichier D3E : "Mois de ramassage"). */
  abbrLabel: string;
  /** Libellé "Mai" (utilisé pour retrouver la colonne du mois dans Eco'Sol). */
  fullLabel: string;
};

/**
 * Parse la valeur "AAAA-MM" envoyée par le champ `<input type="month">`.
 * Retourne `null` si la valeur est absente ou mal formée (jamais de NaN
 * propagé plus loin dans le pipeline).
 */
export function parseTargetMonth(targetMonth: unknown): TargetMonthInfo | null {
  if (typeof targetMonth !== "string") return null;

  const match = targetMonth.trim().match(/^(\d{4})-(\d{2})$/);
  if (!match) return null;

  const year = Number(match[1]);
  const monthIndex = Number(match[2]) - 1;
  if (monthIndex < 0 || monthIndex > 11 || Number.isNaN(year)) return null;

  return {
    year,
    monthIndex,
    refDate: new Date(Date.UTC(year, monthIndex, 1)),
    abbrLabel: `${FR_MONTH_ABBR[monthIndex]} ${year}`,
    fullLabel: FR_MONTH_FULL[monthIndex],
  };
}
