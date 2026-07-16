/**
 * Les 4 déchèteries du territoire apparaissent sous des libellés différents
 * selon la source (ex: "DECHETERIE DE FRANCHELEINS -" tronqué côté D3E,
 * "DECHETTERIE DES FRANCHELEINS" côté Chimirec, "Francheleins" côté
 * Passages…). Ce module centralise la reconnaissance et la normalisation
 * de ces libellés vers un nom canonique unique par site.
 */

export const TERRITOIRE_SITES: { canon: string; keywords: string[] }[] = [
  { canon: "Saint-Jean-sur-Veyle", keywords: ["ST JEAN", "SAINT JEAN", "SAINT-JEAN"] },
  { canon: "Saint-Etienne-sur-Chalaronne", keywords: ["ST ETIENNE", "SAINT ETIENNE", "SAINT-ETIENNE"] },
  { canon: "Vonnas", keywords: ["VONNAS"] },
  { canon: "Francheleins", keywords: ["FRANCHELEIN"] },
];

/**
 * Normalise un libellé de site brut vers son nom canonique s'il correspond
 * à l'une des 4 déchèteries du territoire ; sinon renvoie le libellé
 * d'origine (nettoyé), pour ne pas perdre silencieusement une donnée
 * provenant d'un site non répertorié.
 *
 * @returns `null` uniquement si `raw` est vide/absent.
 */
export function normalizeSiteName(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;
  const str = String(raw).trim();
  if (!str) return null;

  const upper = str.toUpperCase();
  for (const { canon, keywords } of TERRITOIRE_SITES) {
    if (keywords.some((k) => upper.includes(k))) return canon;
  }
  return str;
}

/**
 * Identique à `normalizeSiteName`, mais renvoie `null` si le libellé ne
 * correspond à AUCUNE des 4 déchèteries du territoire. Utilisé pour les
 * workflows qui doivent explicitement filtrer sur ce périmètre (ex: D3E,
 * dont le fichier source couvre des dizaines de déchèteries régionales).
 */
export function resolveTerritoireSite(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;
  const upper = String(raw).toUpperCase();

  for (const { canon, keywords } of TERRITOIRE_SITES) {
    if (keywords.some((k) => upper.includes(k))) return canon;
  }
  return null;
}
