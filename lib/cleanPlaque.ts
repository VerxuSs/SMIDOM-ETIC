/**
 * Nettoie une chaîne représentant une plaque d'immatriculation et en extrait
 * le format standard français XX999XX (2 lettres / 3 chiffres / 2 lettres),
 * quel que soit le bruit environnant.
 *
 * Gère notamment :
 *  - les doublons collés par un séparateur : "GQ-876-VK:GQ-876-VK"
 *  - le texte parasite accolé au véhicule  : "EW 212 JY BOM 19T"
 *  - les tirets, espaces multiples, casse variable, etc.
 *
 * @returns la plaque nettoyée (ex: "GQ876VK"), ou `null` si aucun motif
 *          valide n'a pu être trouvé dans la chaîne fournie.
 */
export function cleanPlaque(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;

  const str = String(raw).toUpperCase();

  // On uppercase d'abord, puis on recherche directement le motif
  // "2 lettres [séparateurs] 3 chiffres [séparateurs] 2 lettres" dans la
  // chaîne brute plutôt que de tout nettoyer en amont : cela permet de
  // s'arrêter sur la première occurrence valide même si la chaîne contient
  // du texte parasite avant/après (numéro de flotte, gabarit du véhicule…).
  const match = str.match(/([A-Z]{2})[\s\-]*(\d{3})[\s\-]*([A-Z]{2})/);
  if (!match) return null;

  const [, p1, p2, p3] = match;
  return `${p1}${p2}${p3}`;
}
