import * as XLSX from "xlsx";

/**
 * Convertit une valeur de cellule Excel hétérogène en `Date` JavaScript.
 *
 * Les fichiers réels rencontrés dans ce projet mélangent plusieurs formats :
 *  - des `Date` déjà correctement typées par `xlsx` (cellDates: true)
 *  - des numéros de série Excel (jours depuis 1899-12-30)
 *  - des entiers au format YYYYMMDD (ex: 20260526, fichier "Alxlvnet")
 *  - des chaînes "dd/mm/yyyy" ou "yyyy-mm-dd"
 *
 * @returns une `Date` valide, ou `null` si la valeur est vide/illisible.
 */
export function parseExcelDate(value: unknown): Date | null {
  if (value === null || value === undefined || value === "") return null;

  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }

  if (typeof value === "number") {
    // Entier YYYYMMDD (ex: 20260526) — format observé dans l'export carburant
    if (Number.isInteger(value) && value >= 19000101 && value <= 21001231) {
      const str = String(value);
      const year = Number(str.slice(0, 4));
      const month = Number(str.slice(4, 6));
      const day = Number(str.slice(6, 8));
      const date = new Date(Date.UTC(year, month - 1, day));
      return Number.isNaN(date.getTime()) ? null : date;
    }

    // Sinon, on traite la valeur comme un numéro de série Excel standard
    const parsed = XLSX.SSF.parse_date_code(value);
    if (!parsed) return null;
    const date = new Date(
      Date.UTC(parsed.y, parsed.m - 1, parsed.d, parsed.H ?? 0, parsed.M ?? 0, Math.floor(parsed.S ?? 0))
    );
    return Number.isNaN(date.getTime()) ? null : date;
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;

    // dd/mm/yyyy ou dd-mm-yyyy ou dd.mm.yyyy
    const frMatch = trimmed.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/);
    if (frMatch) {
      const [, d, m, y] = frMatch;
      const year = y.length === 2 ? 2000 + Number(y) : Number(y);
      const date = new Date(Date.UTC(year, Number(m) - 1, Number(d)));
      return Number.isNaN(date.getTime()) ? null : date;
    }

    // yyyy-mm-dd (ISO)
    const isoMatch = trimmed.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (isoMatch) {
      const [, y, m, d] = isoMatch;
      const date = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)));
      return Number.isNaN(date.getTime()) ? null : date;
    }

    // Dernier recours : on laisse le moteur JS tenter de comprendre la chaîne
    const fallback = new Date(trimmed);
    return Number.isNaN(fallback.getTime()) ? null : fallback;
  }

  return null;
}

/**
 * Repère l'index de la première ligne d'en-têtes dans une feuille dont les
 * premières lignes peuvent être vides ou décoratives (ex: fichiers SERFIM,
 * où l'offset varie même d'une année/feuille à l'autre : 1 ou 2 lignes).
 *
 * @param matrix   feuille lue en mode `header: 1` (tableau de tableaux)
 * @param mustHave libellé (insensible à la casse) attendu dans la ligne d'en-tête
 * @param maxScan  nombre de lignes maximum à inspecter avant d'abandonner
 */
export function findHeaderRowIndex(matrix: unknown[][], mustHave: string, maxScan = 6): number {
  const needle = mustHave.trim().toLowerCase();
  for (let i = 0; i < Math.min(maxScan, matrix.length); i++) {
    const row = matrix[i] ?? [];
    const hasHeader = row.some(
      (cell) => typeof cell === "string" && cell.trim().toLowerCase() === needle
    );
    if (hasHeader) return i;
  }
  return 0; // repli : on suppose que les en-têtes sont en première ligne
}
