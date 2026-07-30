import { NextRequest, NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { prisma } from "@/lib/prisma";
import { cleanPlaque } from "@/lib/cleanPlaque";
import { parseExcelDate, findHeaderRowIndex } from "@/lib/parseExcelDate";
import { parseTargetMonth, FR_MONTH_ABBR } from "@/lib/targetMonth";
import { normalizeSiteName, resolveTerritoireSite } from "@/lib/sites";

export const runtime = "nodejs";

type WorkflowId =
    | "referentiel"
    | "sytraival"
    | "kilometres"
    | "carburant"
    | "biodechets"
    | "serfim"
    | "passages"
    | "egt"
    | "d3e"
    | "piles"
    | "chimirec"
    | "ecodds"
    | "ecosol"
    | "parc_bacs_particuliers"
    | "parc_cartes_pav"
    | "manual_saisie";

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
    if (!date || !immatriculation || !produit || Number.isNaN(poidsNet)) { skipped++; continue; }
    toInsert.push({ date, immatriculation, produit, poidsNet });
  }

  if (toInsert.length > 0) await prisma.pesee.createMany({ data: toInsert });
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
    if (!date || !immatriculation || distanceRaw === null || Number.isNaN(distanceKm)) { skipped++; continue; }
    toInsert.push({ date, immatriculation, distanceKm, litresCarburant: null });
  }

  if (toInsert.length > 0) await prisma.suiviVehicule.createMany({ data: toInsert });
  return { inserted: toInsert.length, skipped, total: rows.length };
}

const ALXLVNET_KEYS = { date: "JournÃ©e", vehicule: "VÃ©hicule", quantite: "QuantitÃ©" } as const;
const ALXLVNET_FALLBACK_INDEX = { date: 0, vehicule: 3, quantite: 7 };

async function handleCarburant(workbook: XLSX.WorkBook, targetMonth: unknown): Promise<ImportResult> {
  const sheet = firstSheet(workbook);
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: null });
  const monthInfo = parseTargetMonth(targetMonth);

  if (!monthInfo) {
    throw new Error("Mois cible invalide.");
  }

  const toInsert: { date: Date; immatriculation: string; distanceKm: null; litresCarburant: number }[] = [];
  let skipped = 0;

  for (const row of rows) {
    const values = Object.values(row);

    const dateRaw = row[ALXLVNET_KEYS.date] ?? values[ALXLVNET_FALLBACK_INDEX.date];
    const vehiculeRaw = row[ALXLVNET_KEYS.vehicule] ?? values[ALXLVNET_FALLBACK_INDEX.vehicule];
    const quantiteRaw = row[ALXLVNET_KEYS.quantite] ?? values[ALXLVNET_FALLBACK_INDEX.quantite];

    let date = null;
    const dateStr = String(dateRaw).trim();
    if (dateStr.length === 8 && !dateStr.includes("-") && !dateStr.includes("/")) {
      const y = parseInt(dateStr.slice(0, 4), 10);
      const m = parseInt(dateStr.slice(4, 6), 10) - 1;
      const d = parseInt(dateStr.slice(6, 8), 10);
      date = new Date(y, m, d);
    } else {
      date = parseExcelDate(dateRaw);
    }
    date = date ?? monthInfo.refDate ?? null;

    const immatriculation = cleanPlaque(vehiculeRaw);
    const litresCarburant = toNumber(quantiteRaw);

    if (!date || !immatriculation || Number.isNaN(litresCarburant)) {
      skipped++;
      continue;
    }

    // Filtre sur le mois cible
    const isSameMonth = date.getMonth() === monthInfo.refDate.getMonth();
    const isSameYear = date.getFullYear() === monthInfo.refDate.getFullYear();

    if (!isSameMonth || !isSameYear) {
      skipped++;
      continue;
    }

    toInsert.push({ date, immatriculation, distanceKm: null, litresCarburant });
  }

  if (toInsert.length > 0) {
    // 1. Définition de la période du mois cible (du 1er au dernier jour)
    const startDate = new Date(monthInfo.year, monthInfo.monthIndex, 1);
    const endDate = new Date(monthInfo.year, monthInfo.monthIndex + 1, 1);

    // 2. SUPPRESSION : On écrase UNIQUEMENT le carburant de ce mois-ci
    await prisma.suiviVehicule.deleteMany({
      where: {
        date: { gte: startDate, lt: endDate },
        litresCarburant: { not: null } // ⚠️ Ne supprime PAS les lignes de distanceKm !
      }
    });

    // 3. INSERTION : On insère le nouveau fichier propre
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
  if (!monthInfo) throw new Error("Mois cible manquant ou invalide.");

  const targetYearStr = String(monthInfo.year);
  const moisCherche = monthInfo.fullLabel.toLowerCase();
  const moisChercheAbbr = monthInfo.abbrLabel.toLowerCase();
  let targetSheetName = workbook.SheetNames.find(name => name.includes(targetYearStr)) || workbook.SheetNames[0];

  const sheet = workbook.Sheets[targetSheetName];
  const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: true, defval: null });

  let totalKg = 0; let found = false; let details = "";
  for (let r = 0; r < matrix.length; r++) {
    const row = matrix[r] ?? [];
    for (let c = 0; c < 10; c++) {
      const cellVal = String(row[c] || "").trim().toLowerCase();
      if (cellVal && (moisCherche.startsWith(cellVal) || cellVal.startsWith(moisChercheAbbr))) {
        const val = toNumber(row[c + 1]);
        if (!Number.isNaN(val) && val > 0) {
          totalKg = val; found = true;
          details = `${val} kg trouvés pour ${cellVal} dans l'onglet "${targetSheetName}" (Col: ${c}, Ligne: ${r + 1})`;
          break;
        }
      }
    }
    if (found) break;
  }

  if (found) {
    const periodeReference = `${monthInfo.year}-${String(monthInfo.monthIndex + 1).padStart(2, "0")}`;
    await prisma.omrIndicateur.upsert({
      where: { periodeReference_indicateur: { periodeReference, indicateur: "TOTAL_BIODECHETS" } },
      update: { valeur: totalKg / 1000 },
      create: { periodeReference, indicateur: "TOTAL_BIODECHETS", valeur: totalKg / 1000 },
    });
    return { inserted: 1, skipped: 0, total: 1, details: [details] };
  } else {
    return { inserted: 0, skipped: 1, total: 1, details: [`Impossible de trouver le total pour le mois de "${moisCherche}" dans l'onglet "${targetSheetName}".`] };
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
    const usagerModele = String(row["CLIENT MODELE"] || row["USAGER MODELE"] || "").toUpperCase();
    const avecSupport = toNumber(row["AVEC SUPPORT"] || row["AVEC_SUPPORT"]);
    const clientActif = String(row["CLIENT ACTIF"] || row["ACTIF"] || "").toUpperCase();
    if (usagerModele.includes("PARTICULIER") && avecSupport === 1 && clientActif === "O") count++;
  }
  await prisma.omrIndicateur.upsert({
    where: { periodeReference_indicateur: { periodeReference: "GLOBALE", indicateur: "PARC_CARTES_PAV" } },
    update: { valeur: count },
    create: { periodeReference: "GLOBALE", indicateur: "PARC_CARTES_PAV", valeur: count },
  });
  return { inserted: 1, skipped: 0, total: rows.length, details: [`${count} cartes PAV comptabilisées.`] };
}

/* -----------------------------------------------------------------------
 * Workflow "Serfim" — fichier SERFIM TABLEAU SMIDOM
 * --------------------------------------------------------------------- */
async function handleSerfim(workbook: XLSX.WorkBook, targetMonth: unknown): Promise<ImportResult> {
  const monthInfo = parseTargetMonth(targetMonth);
  if (!monthInfo) throw new Error("Mois cible manquant ou invalide.");
  let inserted = 0; let skipped = 0; const details: string[] = [];

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    // Lecture brute en matrice pour avoir les vrais index de colonnes (0 = A, 3 = D)
    const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: true, defval: null });
    if (matrix.length === 0) continue;

    const headerIndex = findHeaderRowIndex(matrix, "DATE");
    if (headerIndex === -1) { skipped++; continue; }

    let sheetTotalsFound = 0;

    // On boucle sur les données après l'en-tête
    for (let r = headerIndex + 1; r < matrix.length; r++) {
      const row = matrix[r] ?? [];
      if (row.length === 0) continue;
      const dateRaw = row[0]; const totalMoisRaw = row[3];
      const totalMoisValeur = toNumber(totalMoisRaw);

      // On ne s'intéresse QU'AUX LIGNES où la colonne D contient une valeur
      if (totalMoisRaw !== null && !Number.isNaN(totalMoisValeur) && totalMoisValeur > 0) {
        const dateExacte = parseExcelDate(dateRaw);
        if (!dateExacte) continue;

        // On extrait l'année et le mois réel depuis la date pour construire "2026-07"
        const anneeReal = dateExacte.getFullYear();
        const moisReal = String(dateExacte.getMonth() + 1).padStart(2, "0");
        const periodeReference = `${anneeReal}-${moisReal}`;

        await prisma.omrIndicateur.upsert({
          where: { periodeReference_indicateur: { periodeReference, indicateur: "TRANSFERT_SERFIM" } },
          update: { valeur: totalMoisValeur },
          create: { periodeReference, indicateur: "TRANSFERT_SERFIM", valeur: totalMoisValeur },
        });
        sheetTotalsFound++; inserted++;
      }
    }
    if (sheetTotalsFound > 0) details.push(`${sheetName} : ${sheetTotalsFound} total mensuel extrait.`);
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

  const toInsert: { datePassage: Date; site: string; typeUsager: string | null; periodeReference: string; }[] = [];
  let skipped = 0;

  for (const row of rows) {
    const comptabilise = String(row["COMPTABILISE"] || "").toUpperCase();
    if (comptabilise !== "OUI") { skipped++; continue; }
    const datePassage = parseExcelDate(row["DATE_PASS"]) ?? monthInfo?.refDate ?? null;
    const siteRaw = row["NOM_SITE"];
    const site = typeof siteRaw === "string" ? siteRaw.trim() : null;
    const typeUsagerRaw = row["TYPE_USAGER"];
    const typeUsager = typeof typeUsagerRaw === "string" ? typeUsagerRaw.trim() : null;
    if (!datePassage || !site) { skipped++; continue; }
    if (monthInfo?.refDate && (datePassage.getMonth() !== monthInfo.refDate.getMonth() || datePassage.getFullYear() !== monthInfo.refDate.getFullYear())) {
      skipped++; continue;
    }
    toInsert.push({ datePassage, site, typeUsager, periodeReference: targetMonth as string });
  }
  if (toInsert.length > 0) await prisma.dechetteriePassage.createMany({ data: toInsert });
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
    if (!dateCollecte || !site || !matiere || Number.isNaN(poidsTonnes)) { skipped++; continue; }
    if (monthInfo?.refDate && (dateCollecte.getMonth() !== monthInfo.refDate.getMonth() || dateCollecte.getFullYear() !== monthInfo.refDate.getFullYear())) { skipped++; continue; }
    toInsert.push({ dateCollecte, site, categorieFlux: "PAYANT", prestataire: "EGT", matiere, poidsTonnes, periodeReference: targetMonth as string });
  }
  if (toInsert.length > 0) await prisma.dechetterieFlux.createMany({ data: toInsert });
  return { inserted: toInsert.length, skipped, total: rows.length };
}

const D3E_MATIERES = [
  { matiere: "GEMF", col: 8 }, { matiere: "GEMHF", col: 10 }, { matiere: "PAM", col: 12 }, { matiere: "ECRANS", col: 14 },
  { matiere: "GEP F", col: 18 }, { matiere: "GEP HF", col: 20 },
  { matiere: "Lampes et Mixtes", col: 24 }, { matiere: "Tubes", col: 26 }, { matiere: "Article Culinaire Usagé", col: 30 }
];

async function handleD3E(workbook: XLSX.WorkBook, targetMonth: unknown): Promise<ImportResult> {
  const monthInfo = parseTargetMonth(targetMonth);
  if (!monthInfo) throw new Error("Le mois cible est obligatoire pour D3E.");
  const sheet = firstSheet(workbook);
  const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: true, defval: null });

  let dataStartIndex = 6;
  for (let i = 0; i < Math.min(matrix.length, 12); i++) {
    const cell = matrix[i]?.[0];
    if (typeof cell === "string" && cell.trim().toLowerCase() === "compte parent") { dataStartIndex = i + 1; break; }
  }

  const toInsert: { dateCollecte: Date; site: string; categorieFlux: string; prestataire: string; matiere: string; poidsTonnes: number; periodeReference: string; }[] = [];
  let skipped = 0; let matched = 0;
  for (let r = dataStartIndex; r < matrix.length; r++) {
    const row = matrix[r];
    if (!row || row.every((c) => c === null || c === undefined || c === "")) continue;
    const site = resolveTerritoireSite(row[1]); if (!site) continue;
    const moisRamassage = row[2];
    const moisStr = typeof moisRamassage === "string" ? moisRamassage.trim().toUpperCase() : "";
    if (moisStr !== monthInfo.abbrLabel) continue;

    matched++;

    for (const { matiere, col } of D3E_MATIERES) {
      const raw = row[col];
      if (raw === null || raw === undefined || raw === "") continue;

      const poidsTonnes = toNumber(raw);
      if (Number.isNaN(poidsTonnes)) { skipped++; continue; }
      toInsert.push({ dateCollecte: monthInfo.refDate, site, categorieFlux: "REP", prestataire: "D3E", matiere, poidsTonnes, periodeReference: targetMonth as string });
    }
  }
  if (toInsert.length > 0) await prisma.dechetterieFlux.createMany({ data: toInsert });
  return { inserted: toInsert.length, skipped, total: matched, details: [`${matched} ligne(s) correspondant au mois "${monthInfo.abbrLabel}"`] };
}

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
    if (!dateCollecte || !site || Number.isNaN(poidsKg)) { skipped++; continue; }
    if (monthInfo?.refDate && (dateCollecte.getMonth() !== monthInfo.refDate.getMonth() || dateCollecte.getFullYear() !== monthInfo.refDate.getFullYear())) { skipped++; continue; }
    toInsert.push({ dateCollecte, site, categorieFlux: "REP", prestataire: "Piles", matiere: "PILES", poidsTonnes: poidsKg / 1000, periodeReference: targetMonth as string });
  }
  if (toInsert.length > 0) await prisma.dechetterieFlux.createMany({ data: toInsert });
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
    if (!dateCollecte || !site || !matiere || Number.isNaN(poidsTonnes)) { skipped++; continue; }
    if (monthInfo?.refDate && (dateCollecte.getMonth() !== monthInfo.refDate.getMonth() || dateCollecte.getFullYear() !== monthInfo.refDate.getFullYear())) { skipped++; continue; }
    toInsert.push({ dateCollecte, site, categorieFlux: "PAYANT", prestataire: "Chimirec", matiere, poidsTonnes, periodeReference: targetMonth as string });
  }
  if (toInsert.length > 0) await prisma.dechetterieFlux.createMany({ data: toInsert });
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
    if (!dateCollecte || !site || !matiere || Number.isNaN(poidsTonnes)) { skipped++; continue; }
    if (monthInfo?.refDate && (dateCollecte.getMonth() !== monthInfo.refDate.getMonth() || dateCollecte.getFullYear() !== monthInfo.refDate.getFullYear())) { skipped++; continue; }
    toInsert.push({ dateCollecte, site, categorieFlux: "REP", prestataire: "EcoDDS", matiere, poidsTonnes, periodeReference: targetMonth as string });
  }
  if (toInsert.length > 0) await prisma.dechetterieFlux.createMany({ data: toInsert });
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
  if (!match) throw new Error("Format période invalide pour Eco'Sol. Attendu : AAAA-TX (ex: 2026-T1).");
  const year = parseInt(match[1], 10);
  const quarter = parseInt(match[2], 10);
  const pivotMonthIndex = (quarter - 1) * 3;
  const dateCollecte = new Date(year, pivotMonthIndex, 1);
  const toInsert: { dateCollecte: Date; periodeReference: string; site: string; categorieFlux: string; prestataire: string; matiere: string; poidsTonnes: number; }[] = [];
  let skipped = 0; const details: string[] = [];

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: true, defval: null });

    // 2. On cible la colonne "Total T[x]" en cherchant dans l'en-tête (ligne 6)
    const headerRow = matrix[6] ?? [];
    const targetHeader = `Total T${quarter}`;
    const monthCol = headerRow.findIndex((c) => typeof c === "string" && c.trim().toLowerCase() === targetHeader.toLowerCase());
    if (monthCol === -1) { skipped++; continue; }

    const targetRow = matrix[ECOSOL_TARGET_ROW_INDEX] ?? [];
    const raw = targetRow[monthCol];
    const poidsKg = toNumber(raw);
    if (raw === null || raw === undefined || raw === "" || Number.isNaN(poidsKg)) { skipped++; continue; }

    toInsert.push({ dateCollecte, periodeReference: periodStr, site: sheetName.trim(), categorieFlux: "REP", prestataire: "Eco'Sol", matiere: "Détournement", poidsTonnes: poidsKg / 1000 });
  }
  if (toInsert.length > 0) await prisma.dechetterieFlux.createMany({ data: toInsert });
  return { inserted: toInsert.length, skipped, total: workbook.SheetNames.length, details };
}

async function handleManualSaisie(formData: FormData, targetMonth: unknown): Promise<ImportResult> {
  const monthInfo = parseTargetMonth(targetMonth);
  if (!monthInfo) throw new Error("Mois cible manquant ou invalide.");
  const toInsert: { dateCollecte: Date; site: string; categorieFlux: string; prestataire: string; matiere: string; poidsTonnes: number; periodeReference: string; }[] = [];
  const dateCollecte = monthInfo.refDate ?? new Date();
  const periodeReference = targetMonth as string;
  const site = "Global";

  const mappings = [
    { key: "pneus", prestataire: "Alpharecyclage", matiere: "Pneus", categorie: "REP" },
    { key: "ecoMaison", prestataire: "Sytraival", matiere: "Eco maison", categorie: "REP" },
    { key: "ecoLogic", prestataire: "Sytraival", matiere: "Eco logic", categorie: "REP" },
    { key: "radiographies", prestataire: "Rhône Alpes Argent", matiere: "Radiographies", categorie: "REP" },
    { key: "huileVegetale", prestataire: "Quatra", matiere: "Huile végétale", categorie: "REP" },
  ];

  for (const map of mappings) {
    const valRaw = formData.get(map.key);
    if (valRaw && typeof valRaw === "string" && valRaw.trim() !== "") {
      const tonnes = toNumber(valRaw);
      if (!Number.isNaN(tonnes) && tonnes >= 0) {
        toInsert.push({ dateCollecte, site, categorieFlux: map.categorie, prestataire: map.prestataire, matiere: map.matiere, poidsTonnes: tonnes, periodeReference });
      }
    }
  }

  if (toInsert.length > 0) {
    const matieresAModifier = toInsert.map(item => item.matiere);
    await prisma.dechetterieFlux.deleteMany({
      where: { periodeReference, site, matiere: { in: matieresAModifier } }
    });
    await prisma.dechetterieFlux.createMany({ data: toInsert });
  }
  return { inserted: toInsert.length, skipped: 0, total: mappings.length, details: [`${toInsert.length} indicateur(s) manuel(s) mis à jour.`] };
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

    if (!workflow) return NextResponse.json({ error: "Aucun workflow sélectionné." }, { status: 400 });
    if (workflow === "manual_saisie") {
      const result = await handleManualSaisie(formData, targetMonth);
      return NextResponse.json({ success: true, workflow, targetMonth, ...result });
    }

    if (!(file instanceof File)) return NextResponse.json({ error: "Aucun fichier reçu." }, { status: 400 });
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    let workbook: XLSX.WorkBook;
    try { workbook = XLSX.read(buffer, { type: "buffer", cellDates: true }); }
    catch { return NextResponse.json({ error: "Fichier illisible." }, { status: 400 }); }
    if (workbook.SheetNames.length === 0) return NextResponse.json({ error: "Le classeur est vide." }, { status: 400 });

    let result: ImportResult;

    switch (workflow as WorkflowId) {
      case "referentiel": result = await handleReferentiel(workbook, targetMonth); break;
      case "sytraival": result = await handleSytraival(workbook, targetMonth); break;
      case "kilometres": result = await handleKilometres(workbook, targetMonth); break;
      case "carburant": result = await handleCarburant(workbook, targetMonth); break;
      case "biodechets": result = await handleBioDechets(workbook, targetMonth); break;
      case "serfim": result = await handleSerfim(workbook, targetMonth); break;
      case "passages": result = await handlePassages(workbook, targetMonth); break;
      case "egt": result = await handleEgt(workbook, targetMonth); break;
      case "d3e": result = await handleD3E(workbook, targetMonth); break;
      case "piles": result = await handlePiles(workbook, targetMonth); break;
      case "chimirec": result = await handleChimirec(workbook, targetMonth); break;
      case "ecodds": result = await handleEcoDDS(workbook, targetMonth); break;
      case "ecosol": result = await handleEcoSol(workbook, targetMonth); break;
      case "parc_bacs_particuliers": result = await handleParcBacsParticuliers(workbook); break;
      case "parc_cartes_pav": result = await handleParcCartesPav(workbook); break;
      default: return NextResponse.json({ error: `Workflow inconnu : "${workflow}".` }, { status: 400 });
    }
    return NextResponse.json({ success: true, workflow, fileName: file.name, targetMonth: targetMonth ?? null, ...result });
  } catch (err) {
    console.error(`[api/upload] Échec du traitement :`, err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "Erreur interne." }, { status: 500 });
  }
}
