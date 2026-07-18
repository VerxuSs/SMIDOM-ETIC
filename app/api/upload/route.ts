import { NextRequest, NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { prisma } from "@/lib/prisma";
import { cleanPlaque } from "@/lib/cleanPlaque";
import { parseExcelDate, findHeaderRowIndex } from "@/lib/parseExcelDate";
import { parseTargetMonth, FR_MONTH_ABBR } from "@/lib/targetMonth";
import { normalizeSiteName, resolveTerritoireSite } from "@/lib/sites";

// La lecture de fichiers avec `xlsx` nécessite le runtime Node.js
// (non compatible avec le runtime "edge").
export const runtime = "nodejs";

type WorkflowId =
// Module OMR / Collecte
    | "referentiel"
    | "sytraival"
    | "kilometres"
    | "carburant"
    | "biodechets"
    | "serfim"
    // Module Déchèteries
    | "passages"
    | "egt"
    | "d3e"
    | "piles"
    | "chimirec"
    | "ecodds"
    | "ecosol"
    | "parc_bacs_particuliers"
    | "parc_cartes_pav";

type ImportResult = {
  inserted: number;
  skipped: number;
  total: number;
  details?: string[];
};

/* -----------------------------------------------------------------------
 * Helpers génériques
 * --------------------------------------------------------------------- */

function toNumber(value: unknown): number {
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    // Gère les nombres formatés à la française ("1 234,56")
    const normalized = value.trim().replace(/\s/g, "").replace(",", ".");
    return Number(normalized);
  }
  return NaN;
}

function firstSheet(workbook: XLSX.WorkBook): XLSX.WorkSheet {
  const name = workbook.SheetNames[0];
  return workbook.Sheets[name];
}

/* -----------------------------------------------------------------------
 * Workflow "Référentiel" — fichier Immatriculations
 * Colonnes : IMMATRICULATION, FONCTION -> table Vehicule
 * --------------------------------------------------------------------- */
async function handleReferentiel(workbook: XLSX.WorkBook, targetMonth: unknown): Promise<ImportResult> {
  const sheet = firstSheet(workbook);
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: null });

  let inserted = 0;
  let skipped = 0;

  for (const row of rows) {
    const immatriculation = cleanPlaque(row["IMMATRICULATION"]);
    const fonctionRaw = row["FONCTION"];
    const fonction = typeof fonctionRaw === "string" ? fonctionRaw.trim() : null;

    if (!immatriculation || !fonction) {
      skipped++;
      continue;
    }

    // upsert : un même véhicule peut apparaître dans plusieurs imports
    // successifs du référentiel (mise à jour de fonction sans doublon).
    await prisma.vehicule.upsert({
      where: { immatriculation },
      update: { fonction },
      create: { immatriculation, fonction },
    });
    inserted++;
  }

  return { inserted, skipped, total: rows.length };
}

/* -----------------------------------------------------------------------
 * Workflow "Sytraival" — fichier EXPORT STETIENNE OM ET VERRE
 * Colonnes : Date du poids de sortie, Plaque, Libellé produit, Net -> Pesee
 * --------------------------------------------------------------------- */
async function handleSytraival(workbook: XLSX.WorkBook, targetMonth: unknown): Promise<ImportResult> {
  const sheet = firstSheet(workbook);
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: null });
  const monthInfo = parseTargetMonth(targetMonth);

  const toInsert: { date: Date; immatriculation: string; produit: string; poidsNet: number; }[] = [];
  let skipped = 0;

  for (const row of rows) {
    const date = parseExcelDate(row["Date du poids de sortie"]) ?? monthInfo?.refDate ?? null;
    const immatriculation = cleanPlaque(row["Plaque"]);
    const produitRaw = row["Libellé produit"];
    const produit = typeof produitRaw === "string" ? produitRaw.trim() : null;
    const poidsNet = toNumber(row["Net"]);

    if (!date || !immatriculation || !produit || Number.isNaN(poidsNet)) {
      skipped++;
      continue;
    }

    toInsert.push({ date, immatriculation, produit, poidsNet });
  }

  if (toInsert.length > 0) {
    await prisma.pesee.createMany({ data: toInsert });
  }

  return { inserted: toInsert.length, skipped, total: rows.length };
}

/* -----------------------------------------------------------------------
 * Workflow "Kilomètres" — fichier Kilomètres camions
 * Colonnes : Date, Véhicule, Distance totale -> SuiviVehicule (litresCarburant = null)
 * --------------------------------------------------------------------- */
async function handleKilometres(workbook: XLSX.WorkBook, targetMonth: unknown): Promise<ImportResult> {
  const sheet = firstSheet(workbook);
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: null });
  const monthInfo = parseTargetMonth(targetMonth);

  const toInsert: { date: Date; immatriculation: string; distanceKm: number; litresCarburant: null }[] = [];
  let skipped = 0;

  for (const row of rows) {
    const date = parseExcelDate(row["Date"]) ?? monthInfo?.refDate ?? null;
    const immatriculation = cleanPlaque(row["Véhicule"]);
    const distanceRaw = row["Distance totale"];
    const distanceKm = toNumber(distanceRaw);

    // Beaucoup de lignes du fichier source sont des trajets sans relevé
    // d'odomètre (Distance totale vide) : on les ignore proprement plutôt
    // que d'insérer un 0 qui fausserait les cumuls kilométriques.
    if (!date || !immatriculation || distanceRaw === null || Number.isNaN(distanceKm)) {
      skipped++;
      continue;
    }

    toInsert.push({ date, immatriculation, distanceKm, litresCarburant: null });
  }

  if (toInsert.length > 0) {
    await prisma.suiviVehicule.createMany({ data: toInsert });
  }

  return { inserted: toInsert.length, skipped, total: rows.length };
}

/* -----------------------------------------------------------------------
 * Workflow "Carburant" — fichier Excel Alxlvnet
 * ⚠️ En-têtes mal encodés dans le fichier source lui-même :
 * "JournÃ©e", "VÃ©hicule", "QuantitÃ©"
 * -> SuiviVehicule (distanceKm = null)
 * --------------------------------------------------------------------- */
const ALXLVNET_KEYS = {
  date: "JournÃ©e",
  vehicule: "VÃ©hicule",
  quantite: "QuantitÃ©",
} as const;

// Repli par position si jamais l'encodage venait à être corrigé en amont
const ALXLVNET_FALLBACK_INDEX = { date: 0, vehicule: 3, quantite: 7 };

async function handleCarburant(workbook: XLSX.WorkBook, targetMonth: unknown): Promise<ImportResult> {
  const sheet = firstSheet(workbook);
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: null });
  const monthInfo = parseTargetMonth(targetMonth);

  const toInsert: { date: Date; immatriculation: string; distanceKm: null; litresCarburant: number }[] = [];
  let skipped = 0;

  for (const row of rows) {
    const values = Object.values(row);

    const dateRaw = row[ALXLVNET_KEYS.date] ?? values[ALXLVNET_FALLBACK_INDEX.date];
    const vehiculeRaw = row[ALXLVNET_KEYS.vehicule] ?? values[ALXLVNET_FALLBACK_INDEX.vehicule];
    const quantiteRaw = row[ALXLVNET_KEYS.quantite] ?? values[ALXLVNET_FALLBACK_INDEX.quantite];

    const date = parseExcelDate(dateRaw) ?? monthInfo?.refDate ?? null;
    const immatriculation = cleanPlaque(vehiculeRaw);
    const litresCarburant = toNumber(quantiteRaw);

    if (!date || !immatriculation || Number.isNaN(litresCarburant)) {
      skipped++;
      continue;
    }

    toInsert.push({ date, immatriculation, distanceKm: null, litresCarburant });
  }

  if (toInsert.length > 0) {
    await prisma.suiviVehicule.createMany({ data: toInsert });
  }

  return { inserted: toInsert.length, skipped, total: rows.length };
}

/* -----------------------------------------------------------------------
 * Workflow "Bio-déchets" — fichier Tableau récap BD Ecovalim
 * NOUVEAU COMPORTEMENT : On cherche le récapitulatif mensuel en bas du fichier
 * et on le stocke dans OmrIndicateur.
 * --------------------------------------------------------------------- */
async function handleBioDechets(workbook: XLSX.WorkBook, targetMonth: unknown): Promise<ImportResult> {
  const monthInfo = parseTargetMonth(targetMonth);
  if (!monthInfo) {
    throw new Error("Mois cible manquant ou invalide.");
  }

  // 1. Déterminer l'année et le nom du mois qu'on cherche
  const targetYearStr = String(monthInfo.year); // ex: "2026"
  const moisCherche = monthInfo.fullLabel.toLowerCase(); // ex: "mai"
  const moisChercheAbbr = monthInfo.abbrLabel.toLowerCase(); // ex: "mai", "janv", "fév"

  // 2. Trouver l'onglet qui correspond à l'année cible (ex: l'onglet nommé "2026")
  let targetSheetName = workbook.SheetNames.find(name => name.includes(targetYearStr));

  // Si on ne trouve pas l'onglet exact de l'année, on prend le premier par défaut (pour être tolérant)
  if (!targetSheetName) {
    targetSheetName = workbook.SheetNames[0];
  }

  const sheet = workbook.Sheets[targetSheetName];
  // On lit la feuille en mode matrice pour naviguer librement
  const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: true, defval: null });

  let totalKg = 0;
  let found = false;
  let details = "";

  // 3. Recherche du bloc récapitulatif
  // On cherche une ligne qui contient le mois qu'on veut.
  for (let r = 0; r < matrix.length; r++) {
    const row = matrix[r] ?? [];

    // On scanne les colonnes de la ligne (on regarde large : jusqu'à la colonne 10/J)
    for (let c = 0; c < 10; c++) {
      const cellVal = String(row[c] || "").trim().toLowerCase();

      // Si la cellule correspond à notre mois (ex: "mai" ou "janv")
      if (cellVal && (moisCherche.startsWith(cellVal) || cellVal.startsWith(moisChercheAbbr))) {

        // La valeur est TOUJOURS dans la colonne juste à droite (c + 1)
        const valRaw = row[c + 1];
        const val = toNumber(valRaw);

        if (!Number.isNaN(val) && val > 0) {
          totalKg = val;
          found = true;
          details = `${val} kg trouvés pour ${cellVal} dans l'onglet "${targetSheetName}" (Col: ${c}, Ligne: ${r + 1})`;
          break; // On a trouvé la valeur, on arrête de chercher sur cette ligne
        }
      }
    }
    if (found) break; // On a trouvé la valeur, on arrête de scanner les lignes
  }

  // 4. Upsert en base de données si on a trouvé
  if (found) {
    const periodeReference = `${monthInfo.year}-${String(monthInfo.monthIndex + 1).padStart(2, "0")}`; // ex: "2026-05"

    await prisma.omrIndicateur.upsert({
      where: {
        periodeReference_indicateur: {
          periodeReference: periodeReference,
          indicateur: "TOTAL_BIODECHETS",
        }
      },
      update: { valeur: totalKg / 1000 }, // Conversion en Tonnes
      create: {
        periodeReference: periodeReference,
        indicateur: "TOTAL_BIODECHETS",
        valeur: totalKg / 1000,
      },
    });

    return {
      inserted: 1,
      skipped: 0,
      total: 1,
      details: [details]
    };
  } else {
    return {
      inserted: 0,
      skipped: 1,
      total: 1,
      details: [`Impossible de trouver le total pour le mois de "${moisCherche}" dans l'onglet "${targetSheetName}".`]
    };
  }
}

/* -----------------------------------------------------------------------
 * Workflow "Parc Bacs Particuliers"
 * Donnée globale / instant T (Upsert sans temporalité)
 * --------------------------------------------------------------------- */
async function handleParcBacsParticuliers(workbook: XLSX.WorkBook): Promise<ImportResult> {
  const sheet = firstSheet(workbook);
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: null });

  let count = 0;
  for (const row of rows) {
    const usagerModele = String(row["USAGER MODELE"] || row["CLIENT_MODELE"] || "").toUpperCase();
    if (usagerModele.includes("PARTICULIER")) {
      count++;
    }
  }

  await prisma.omrIndicateur.upsert({
    where: {
      periodeReference_indicateur: {
        periodeReference: "GLOBALE",
        indicateur: "PARC_BACS_PARTICULIERS",
      }
    },
    update: { valeur: count },
    create: {
      periodeReference: "GLOBALE",
      indicateur: "PARC_BACS_PARTICULIERS",
      valeur: count,
    },
  });

  return {
    inserted: 1,
    skipped: 0,
    total: rows.length,
    details: [`${count} bacs particuliers comptabilisés et mis à jour.`]
  };
}

/* -----------------------------------------------------------------------
 * Workflow "Parc Cartes PAV OMR"
 * Donnée globale / instant T
 * Filtres : PAV + PARTICULIER + AVEC_SUPPORT=1 + CLIENT ACTIF=O
 * --------------------------------------------------------------------- */
async function handleParcCartesPav(workbook: XLSX.WorkBook): Promise<ImportResult> {
  const sheet = firstSheet(workbook);
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: null });

  let count = 0;
  for (const row of rows) {
    const usagerModele = String(row["USAGER MODELE"] || "").toUpperCase();
    const avecSupport = toNumber(row["AVEC_SUPPORT"]);
    const clientActif = String(row["CLIENT ACTIF"] || "").toUpperCase();

    // Check if it's a PAV client. We assume it's implicit in this file, or we check if USAGER MODELE has PAV
    // The prompt says "filtrer sur client PAV ET PARTICULIER".
    // In the "liste déposants et supports", everyone is usually a PAV deposant.
    // Let's apply the strict rules requested:
    if (
        usagerModele.includes("PARTICULIER") &&
        avecSupport === 1 &&
        clientActif === "O"
    ) {
      count++;
    }
  }

  await prisma.omrIndicateur.upsert({
    where: {
      periodeReference_indicateur: {
        periodeReference: "GLOBALE",
        indicateur: "PARC_CARTES_PAV",
      }
    },
    update: { valeur: count },
    create: {
      periodeReference: "GLOBALE",
      indicateur: "PARC_CARTES_PAV",
      valeur: count,
    },
  });

  return {
    inserted: 1,
    skipped: 0,
    total: rows.length,
    details: [`${count} cartes PAV comptabilisées et mises à jour.`]
  };
}

/* -----------------------------------------------------------------------
 * Workflow "Serfim" — fichier SERFIM TABLEAU SMIDOM
 * --------------------------------------------------------------------- */
/* -----------------------------------------------------------------------
 * Workflow "Serfim" — NOUVELLE VERSION (Extraction des Totaux Mensuels)
 * --------------------------------------------------------------------- */
async function handleSerfim(workbook: XLSX.WorkBook, targetMonth: unknown): Promise<ImportResult> {
  const monthInfo = parseTargetMonth(targetMonth);
  if (!monthInfo) {
    throw new Error("Mois cible manquant ou invalide.");
  }

  let inserted = 0;
  let skipped = 0;
  const details: string[] = [];

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    // Lecture brute en matrice pour avoir les vrais index de colonnes (0 = A, 3 = D)
    const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: true, defval: null });
    if (matrix.length === 0) continue;

    const headerIndex = findHeaderRowIndex(matrix, "DATE");
    if (headerIndex === -1) {
      skipped++;
      continue;
    }

    let sheetTotalsFound = 0;

    // On boucle sur les données après l'en-tête
    for (let r = headerIndex + 1; r < matrix.length; r++) {
      const row = matrix[r] ?? [];
      if (row.length === 0) continue;

      // Colonne A = DATE (index 0), Colonne D = Total Mois (index 3)
      const dateRaw = row[0];
      const totalMoisRaw = row[3];

      const totalMoisValeur = toNumber(totalMoisRaw);

      // On ne s'intéresse QU'AUX LIGNES où la colonne D contient une valeur
      if (totalMoisRaw !== null && !Number.isNaN(totalMoisValeur) && totalMoisValeur > 0) {
        const dateExacte = parseExcelDate(dateRaw);
        if (!dateExacte) continue;

        // On extrait l'année et le mois réel depuis la date pour construire "2026-07"
        const anneeReal = dateExacte.getFullYear();
        const moisReal = String(dateExacte.getMonth() + 1).padStart(2, "0");
        const periodeReference = `${anneeReal}-${moisReal}`;

        // Upsert direct dans OmrIndicateur (table des compteurs mensuels/globaux)
        // ⚠️ Il n'y a plus aucun appel à prisma.pesee ici !
        await prisma.omrIndicateur.upsert({
          where: {
            periodeReference_indicateur: {
              periodeReference: periodeReference,
              indicateur: "TRANSFERT_SERFIM",
            },
          },
          update: { valeur: totalMoisValeur },
          create: {
            periodeReference: periodeReference,
            indicateur: "TRANSFERT_SERFIM",
            valeur: totalMoisValeur,
          },
        });

        sheetTotalsFound++;
        inserted++;
      }
    }

    if (sheetTotalsFound > 0) {
      details.push(`${sheetName} : ${sheetTotalsFound} total(totaux) mensuel(s) extrait(s) avec succès.`);
    }
  }

  return { inserted, skipped, total: inserted + skipped, details };
}

/* =========================================================================
 * MODULE DÉCHÈTERIES
 * ======================================================================= */

/* -----------------------------------------------------------------------
 * Workflow "Passages"
 * --------------------------------------------------------------------- */
async function handlePassages(workbook: XLSX.WorkBook, targetMonth: unknown): Promise<ImportResult> {
  const sheet = firstSheet(workbook);
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: null });
  const monthInfo = parseTargetMonth(targetMonth);

  // Attention : Assure-toi que periodeReference existe bien dans ton schéma Prisma,
  // sinon retire-le de ce type et du toInsert.push()
  const toInsert: { datePassage: Date; site: string; typeUsager: string | null; periodeReference: string; }[] = [];
  let skipped = 0;

  for (const row of rows) {
    const comptabilise = String(row["COMPTABILISE"] || "").toUpperCase();
    if (comptabilise !== "OUI") {
      skipped++;
      continue;
    }

    const datePassage = parseExcelDate(row["DATE_PASS"]) ?? monthInfo?.refDate ?? null;
    const siteRaw = row["NOM_SITE"];
    const site = typeof siteRaw === "string" ? siteRaw.trim() : null;
    const typeUsagerRaw = row["TYPE_USAGER"];
    const typeUsager = typeof typeUsagerRaw === "string" ? typeUsagerRaw.trim() : null;

    if (!datePassage || !site) {
      skipped++;
      continue;
    }

    if (monthInfo?.refDate) {
      const isSameMonth = datePassage.getMonth() === monthInfo.refDate.getMonth();
      const isSameYear = datePassage.getFullYear() === monthInfo.refDate.getFullYear();

      if (!isSameMonth || !isSameYear) {
        skipped++;
        continue; // On ignore les lignes qui ne sont pas du bon mois/année
      }
    }

    toInsert.push({ datePassage, site, typeUsager, periodeReference: targetMonth as string });
  }

  if (toInsert.length > 0) {
    await prisma.dechetteriePassage.createMany({ data: toInsert });
  }

  return { inserted: toInsert.length, skipped, total: rows.length };
}

/* -----------------------------------------------------------------------
 * Workflow "Flux EGT"
 * --------------------------------------------------------------------- */
async function handleEgt(workbook: XLSX.WorkBook, targetMonth: unknown): Promise<ImportResult> {
  const sheet = firstSheet(workbook);
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: null });
  const monthInfo = parseTargetMonth(targetMonth);

  const toInsert: { dateCollecte: Date; site: string; categorieFlux: string; prestataire: string; matiere: string; poidsTonnes: number; periodeReference: string; }[] = [];
  let skipped = 0;

  for (const row of rows) {
    const dateCollecte = parseExcelDate(row["Date"]) ?? monthInfo?.refDate ?? null;
    const site = normalizeSiteName(row["Chantier"]);
    const matiereRaw = row["Matière"];
    const matiere = typeof matiereRaw === "string" ? matiereRaw.trim() : null;
    const poidsTonnes = toNumber(row["Poids (tonnes)"]);

    if (!dateCollecte || !site || !matiere || Number.isNaN(poidsTonnes)) {
      skipped++;
      continue;
    }

    if (monthInfo?.refDate) {
      const isSameMonth = dateCollecte.getMonth() === monthInfo.refDate.getMonth();
      const isSameYear = dateCollecte.getFullYear() === monthInfo.refDate.getFullYear();

      if (!isSameMonth || !isSameYear) {
        skipped++;
        continue; // On ignore les lignes qui ne sont pas du bon mois/année
      }
    }

    toInsert.push({ dateCollecte, site, categorieFlux: "PAYANT", prestataire: "EGT", matiere, poidsTonnes, periodeReference: targetMonth as string });
  }

  if (toInsert.length > 0) {
    await prisma.dechetterieFlux.createMany({ data: toInsert });
  }

  return { inserted: toInsert.length, skipped, total: rows.length };
}

/* -----------------------------------------------------------------------
 * Workflow "D3E"
 * --------------------------------------------------------------------- */
const D3E_MATIERES: { matiere: string; col: number }[] = [
  // --- Flux Ménagers classiques ---
  { matiere: "GEMF", col: 8 },
  { matiere: "GEMHF", col: 10 },
  { matiere: "PAM", col: 12 },
  { matiere: "ECRANS", col: 14 },

  // --- Flux Professionnels (GEP) ---
  { matiere: "GEP F", col: 18 },
  { matiere: "GEP HF", col: 20 },

  // --- Lampes, Tubes et Autres ---
  { matiere: "Lampes et Mixtes", col: 24 },
  { matiere: "Tubes", col: 26 },
  { matiere: "Article Culinaire Usagé", col: 30 },
];

async function handleD3E(workbook: XLSX.WorkBook, targetMonth: unknown): Promise<ImportResult> {
  const monthInfo = parseTargetMonth(targetMonth);
  if (!monthInfo) {
    throw new Error(
        "Le mois cible (targetMonth, format AAAA-MM) est obligatoire pour le workflow D3E : il sert à filtrer le fichier 12 mois glissants."
    );
  }

  const sheet = firstSheet(workbook);
  const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: true, defval: null });

  let dataStartIndex = 6;
  for (let i = 0; i < Math.min(matrix.length, 12); i++) {
    const cell = matrix[i]?.[0];
    if (typeof cell === "string" && cell.trim().toLowerCase() === "compte parent") {
      dataStartIndex = i + 1;
      break;
    }
  }

  const toInsert: { dateCollecte: Date; site: string; categorieFlux: string; prestataire: string; matiere: string; poidsTonnes: number; periodeReference: string; }[] = [];
  let skipped = 0;
  let matched = 0;

  for (let r = dataStartIndex; r < matrix.length; r++) {
    const row = matrix[r];
    if (!row || row.every((c) => c === null || c === undefined || c === "")) continue;

    const site = resolveTerritoireSite(row[1]);
    if (!site) continue;

    const moisRamassage = row[2];
    const moisStr = typeof moisRamassage === "string" ? moisRamassage.trim().toUpperCase() : "";
    if (moisStr !== monthInfo.abbrLabel) continue;

    matched++;

    for (const { matiere, col } of D3E_MATIERES) {
      const raw = row[col];
      if (raw === null || raw === undefined || raw === "") continue;

      const poidsTonnes = toNumber(raw);
      if (Number.isNaN(poidsTonnes)) {
        skipped++;
        continue;
      }

      toInsert.push({
        dateCollecte: monthInfo.refDate,
        site,
        categorieFlux: "REP",
        prestataire: "D3E",
        matiere,
        poidsTonnes,
        periodeReference: targetMonth as string,
      });
    }
  }

  if (toInsert.length > 0) {
    await prisma.dechetterieFlux.createMany({ data: toInsert });
  }

  return {
    inserted: toInsert.length,
    skipped,
    total: matched,
    details: [`${matched} ligne(s) correspondant au mois "${monthInfo.abbrLabel}" et au territoire`],
  };
}

/* -----------------------------------------------------------------------
 * Workflow "Piles"
 * --------------------------------------------------------------------- */
async function handlePiles(workbook: XLSX.WorkBook, targetMonth: unknown): Promise<ImportResult> {
  const sheet = firstSheet(workbook);
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: null });
  const monthInfo = parseTargetMonth(targetMonth);

  const toInsert: { dateCollecte: Date; site: string; categorieFlux: string; prestataire: string; matiere: string; poidsTonnes: number; periodeReference: string; }[] = [];
  let skipped = 0;

  for (const row of rows) {
    const dateCollecte = parseExcelDate(row["Date collecte"]) ?? monthInfo?.refDate ?? null;
    const site = normalizeSiteName(row["Nom commercial"]);
    const poidsKg = toNumber(row["Poids collecté"]);

    if (!dateCollecte || !site || Number.isNaN(poidsKg)) {
      skipped++;
      continue;
    }

    if (monthInfo?.refDate) {
      const isSameMonth = dateCollecte.getMonth() === monthInfo.refDate.getMonth();
      const isSameYear = dateCollecte.getFullYear() === monthInfo.refDate.getFullYear();

      if (!isSameMonth || !isSameYear) {
        skipped++;
        continue; // On ignore les lignes qui ne sont pas du bon mois/année
      }
    }

    toInsert.push({
      dateCollecte,
      site,
      categorieFlux: "REP",
      prestataire: "Piles",
      matiere: "PILES",
      poidsTonnes: poidsKg / 1000,
      periodeReference: targetMonth as string,
    });
  }

  if (toInsert.length > 0) {
    await prisma.dechetterieFlux.createMany({ data: toInsert });
  }

  return { inserted: toInsert.length, skipped, total: rows.length };
}

/* -----------------------------------------------------------------------
 * Workflow "Chimirec"
 * --------------------------------------------------------------------- */
async function handleChimirec(workbook: XLSX.WorkBook, targetMonth: unknown): Promise<ImportResult> {
  const sheet = firstSheet(workbook);
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: null });
  const monthInfo = parseTargetMonth(targetMonth);

  const toInsert: { dateCollecte: Date; site: string; categorieFlux: string; prestataire: string; matiere: string; poidsTonnes: number; periodeReference: string; }[] = [];
  let skipped = 0;

  for (const row of rows) {
    const dateCollecte = parseExcelDate(row["DATE ENLEVEMENT"]) ?? monthInfo?.refDate ?? null;
    const site = normalizeSiteName(row["PRODUCTEUR"]);
    const matiereRaw = row["NOM USUEL DECHET"];
    const matiere = typeof matiereRaw === "string" ? matiereRaw.trim() : null;
    const poidsTonnes = toNumber(row["TONNAGE"]);

    if (!dateCollecte || !site || !matiere || Number.isNaN(poidsTonnes)) {
      skipped++;
      continue;
    }

    if (monthInfo?.refDate) {
      const isSameMonth = dateCollecte.getMonth() === monthInfo.refDate.getMonth();
      const isSameYear = dateCollecte.getFullYear() === monthInfo.refDate.getFullYear();

      if (!isSameMonth || !isSameYear) {
        skipped++;
        continue; // On ignore les lignes qui ne sont pas du bon mois/année
      }
    }

    toInsert.push({ dateCollecte, site, categorieFlux: "PAYANT", prestataire: "Chimirec", matiere, poidsTonnes, periodeReference: targetMonth as string });
  }

  if (toInsert.length > 0) {
    await prisma.dechetterieFlux.createMany({ data: toInsert });
  }

  return { inserted: toInsert.length, skipped, total: rows.length };
}

/* -----------------------------------------------------------------------
 * Workflow "EcoDDS"
 * --------------------------------------------------------------------- */
async function handleEcoDDS(workbook: XLSX.WorkBook, targetMonth: unknown): Promise<ImportResult> {
  const sheet = firstSheet(workbook);
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: null });
  const monthInfo = parseTargetMonth(targetMonth);

  const toInsert: { dateCollecte: Date; site: string; categorieFlux: string; prestataire: string; matiere: string; poidsTonnes: number; periodeReference: string; }[] = [];
  let skipped = 0;

  for (const row of rows) {
    const dateCollecte = parseExcelDate(row["Date de prise en charge"]) ?? monthInfo?.refDate ?? null;
    const site = normalizeSiteName(row["Point de collecte"]);
    const matiereRaw = row["Dénomination déchet"];
    const matiere = typeof matiereRaw === "string" ? matiereRaw.trim() : null;
    const poidsTonnes = toNumber(row["Quantité réelle"]);

    if (!dateCollecte || !site || !matiere || Number.isNaN(poidsTonnes)) {
      skipped++;
      continue;
    }

    if (monthInfo?.refDate) {
      const isSameMonth = dateCollecte.getMonth() === monthInfo.refDate.getMonth();
      const isSameYear = dateCollecte.getFullYear() === monthInfo.refDate.getFullYear();

      if (!isSameMonth || !isSameYear) {
        skipped++;
        continue; // On ignore les lignes qui ne sont pas du bon mois/année
      }
    }

    toInsert.push({ dateCollecte, site, categorieFlux: "REP", prestataire: "EcoDDS", matiere, poidsTonnes, periodeReference: targetMonth as string });
  }

  if (toInsert.length > 0) {
    await prisma.dechetterieFlux.createMany({ data: toInsert });
  }

  return { inserted: toInsert.length, skipped, total: rows.length };
}

/* -----------------------------------------------------------------------
 * Workflow "Eco'Sol"
 * --------------------------------------------------------------------- */
const ECOSOL_TARGET_ROW_INDEX = 28;

async function handleEcoSol(workbook: XLSX.WorkBook, targetMonth: unknown): Promise<ImportResult> {
  // 1. Validation et parsing du nouveau format (ex: "2026-T1")
  const periodStr = String(targetMonth).trim();
  const match = periodStr.match(/^(\d{4})-T([1-4])$/);

  if (!match) {
    throw new Error(
        `Le format de la période est invalide pour Eco'Sol. Reçu : "${periodStr}". Attendu : AAAA-TX (ex: 2026-T1).`
    );
  }

  const year = parseInt(match[1], 10);
  const quarter = parseInt(match[2], 10); // 1, 2, 3 ou 4
  const periodeReference = periodStr; // "2026-T1"

  // Création d'une date pivot pour Prisma (1er jour du premier mois du trimestre)
  // T1 = Janvier (0), T2 = Avril (3), T3 = Juillet (6), T4 = Octobre (9)
  const pivotMonthIndex = (quarter - 1) * 3;
  const dateCollecte = new Date(year, pivotMonthIndex, 1);

  const toInsert: {
    dateCollecte: Date;
    periodeReference: string;
    site: string;
    categorieFlux: string;
    prestataire: string;
    matiere: string;
    poidsTonnes: number;
  }[] = [];

  let skipped = 0;
  const details: string[] = [];

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: true, defval: null });

    // 2. On cible la colonne "Total T[x]" en cherchant dans l'en-tête (ligne 6)
    const headerRow = matrix[6] ?? [];
    const targetHeader = `Total T${quarter}`; // ex: "Total T1"

    const monthCol = headerRow.findIndex(
        (c) => typeof c === "string" && c.trim().toLowerCase() === targetHeader.toLowerCase()
    );

    if (monthCol === -1) {
      skipped++;
      details.push(`${sheetName} : colonne "${targetHeader}" introuvable, ignorée`);
      continue;
    }

    // 3. Récupération de la donnée à la ligne 29 (index 28)
    // Assure-toi que ECOSOL_TARGET_ROW_INDEX est bien défini dans ton fichier (ex: const ECOSOL_TARGET_ROW_INDEX = 28;)
    const targetRow = matrix[ECOSOL_TARGET_ROW_INDEX] ?? [];
    const raw = targetRow[monthCol];
    const poidsKg = toNumber(raw);

    if (raw === null || raw === undefined || raw === "" || Number.isNaN(poidsKg)) {
      skipped++;
      details.push(`${sheetName} : aucune valeur exploitable à la ligne 29, colonne ${monthCol}`);
      continue;
    }

    // 4. Insertion avec la periodeReference reçue du frontend
    toInsert.push({
      dateCollecte: dateCollecte,
      periodeReference: periodeReference,
      site: sheetName.trim(),
      categorieFlux: "REP",
      prestataire: "Eco'Sol",
      matiere: "Détournement",
      poidsTonnes: poidsKg / 1000,
    });
    details.push(`${sheetName} : ${poidsKg} kg détectés pour ${periodeReference}`);
  }

  if (toInsert.length > 0) {
    await prisma.dechetterieFlux.createMany({ data: toInsert });
  }

  return {
    inserted: toInsert.length,
    skipped,
    total: workbook.SheetNames.length,
    details,
  };
}

/* -----------------------------------------------------------------------
 * Handler HTTP
 * --------------------------------------------------------------------- */
export async function POST(req: NextRequest) {
  let workflow: string | null = null;

  try {
    const formData = await req.formData();
    const file = formData.get("file");
    workflow = formData.get("workflow") as string | null;

    // Envoyé par le champ <input type="month"> du front (format "AAAA-MM").
    const targetMonth = formData.get("targetMonth") as string | null;

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "Aucun fichier reçu." }, { status: 400 });
    }
    if (!workflow) {
      return NextResponse.json({ error: "Aucun workflow sélectionné." }, { status: 400 });
    }

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    let workbook: XLSX.WorkBook;
    try {
      workbook = XLSX.read(buffer, { type: "buffer", cellDates: true });
    } catch {
      return NextResponse.json(
          { error: "Fichier illisible : vérifiez qu'il s'agit bien d'un classeur Excel (.xlsx/.xls)." },
          { status: 400 }
      );
    }

    if (workbook.SheetNames.length === 0) {
      return NextResponse.json({ error: "Le classeur ne contient aucune feuille." }, { status: 400 });
    }

    let result: ImportResult;

    switch (workflow as WorkflowId) {
      case "referentiel":
        result = await handleReferentiel(workbook, targetMonth);
        break;
      case "sytraival":
        result = await handleSytraival(workbook, targetMonth);
        break;
      case "kilometres":
        result = await handleKilometres(workbook, targetMonth);
        break;
      case "carburant":
        result = await handleCarburant(workbook, targetMonth);
        break;
      case "biodechets":
        result = await handleBioDechets(workbook, targetMonth);
        break;
      case "serfim":
        result = await handleSerfim(workbook, targetMonth);
        break;
      case "passages":
        result = await handlePassages(workbook, targetMonth);
        break;
      case "egt":
        result = await handleEgt(workbook, targetMonth);
        break;
      case "d3e":
        result = await handleD3E(workbook, targetMonth);
        break;
      case "piles":
        result = await handlePiles(workbook, targetMonth);
        break;
      case "chimirec":
        result = await handleChimirec(workbook, targetMonth);
        break;
      case "ecodds":
        result = await handleEcoDDS(workbook, targetMonth);
        break;
      case "ecosol":
        result = await handleEcoSol(workbook, targetMonth);
        break;
      case "parc_bacs_particuliers":
        result = await handleParcBacsParticuliers(workbook);
        break;
      case "parc_cartes_pav":
        result = await handleParcCartesPav(workbook);
        break;
      default:
        return NextResponse.json({ error: `Workflow inconnu : "${workflow}".` }, { status: 400 });
    }

    return NextResponse.json({
      success: true,
      workflow,
      fileName: file.name,
      targetMonth: targetMonth ?? null,
      ...result,
    });
  } catch (err) {
    console.error(`[api/upload] Échec du traitement (workflow="${workflow}") :`, err);
    return NextResponse.json(
        {
          error:
              err instanceof Error
                  ? err.message
                  : "Erreur interne lors du traitement du fichier.",
        },
        { status: 500 }
    );
  }
}
