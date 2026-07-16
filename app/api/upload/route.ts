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
    | "ecosol";

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

  const toInsert: { date: Date; immatriculation: string; produit: string; poidsNet: number }[] = [];
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
 * --------------------------------------------------------------------- */
async function handleBioDechets(workbook: XLSX.WorkBook, targetMonth: unknown): Promise<ImportResult> {
  const toInsert: { date: Date; idBac: string; poidsKg: number }[] = [];
  let skipped = 0;
  let totalCells = 0;
  const details: string[] = [];
  const monthInfo = parseTargetMonth(targetMonth);

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
      header: 1,
      raw: true,
      defval: null,
    });
    if (matrix.length === 0) continue;

    const headerRow = matrix[0] ?? [];
    const firstCell = headerRow[0];
    const looksLikePivot = typeof firstCell === "string" && firstCell.trim().toLowerCase() === "bacs";
    if (!looksLikePivot) continue;

    const dateColumns: { index: number; date: Date }[] = [];
    for (let col = 1; col < headerRow.length; col++) {
      // Pour le TCD des biodéchets, on essaie de parser la date de la colonne.
      // S'il n'y a pas de date claire dans la colonne, on utilise le targetMonth en repli.
      const date = parseExcelDate(headerRow[col]) ?? monthInfo?.refDate ?? null;
      if (date) dateColumns.push({ index: col, date });
    }

    let sheetInserted = 0;

    for (let r = 1; r < matrix.length; r++) {
      const row = matrix[r] ?? [];
      const idBacRaw = row[0];

      if (idBacRaw === null || idBacRaw === undefined || idBacRaw === "") break;
      if (String(idBacRaw).trim().toLowerCase().startsWith("total")) continue;

      const idBac = String(idBacRaw).trim();

      for (const { index, date } of dateColumns) {
        totalCells++;
        const raw = row[index];

        if (raw === null || raw === undefined || raw === "") continue;

        const poidsKg = toNumber(raw);
        if (Number.isNaN(poidsKg)) {
          skipped++;
          continue;
        }

        toInsert.push({ date, idBac, poidsKg });
        sheetInserted++;
      }
    }

    details.push(`${sheetName}: ${sheetInserted} pesée(s) dépivotée(s)`);
  }

  if (toInsert.length > 0) {
    await prisma.bioDechet.createMany({ data: toInsert });
  }

  return { inserted: toInsert.length, skipped, total: totalCells, details };
}

/* -----------------------------------------------------------------------
 * Workflow "Serfim" — fichier SERFIM TABLEAU SMIDOM
 * --------------------------------------------------------------------- */
async function handleSerfim(workbook: XLSX.WorkBook, targetMonth: unknown): Promise<ImportResult> {
  const toInsert: { date: Date; immatriculation: string; produit: string; poidsNet: number }[] = [];
  let skipped = 0;
  const details: string[] = [];
  const monthInfo = parseTargetMonth(targetMonth);

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: true, defval: null });
    if (matrix.length === 0) continue;

    const headerIndex = findHeaderRowIndex(matrix, "DATE");
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
      range: headerIndex,
      defval: null,
    });

    let sheetInserted = 0;

    for (const row of rows) {
      const date = parseExcelDate(row["DATE"]) ?? monthInfo?.refDate ?? null;
      const poidsNet = toNumber(row["POIDS"]);
      const numeroPesee = row["N° PESEE"];

      if (!date || Number.isNaN(poidsNet)) {
        skipped++;
        continue;
      }

      toInsert.push({
        date,
        immatriculation: "SERFIM",
        produit: numeroPesee ? `Transfert Serfim #${numeroPesee}` : "Transfert Serfim",
        poidsNet,
      });
      sheetInserted++;
    }

    details.push(`${sheetName}: en-têtes détectés ligne ${headerIndex + 1}, ${sheetInserted} pesée(s)`);
  }

  if (toInsert.length > 0) {
    await prisma.pesee.createMany({ data: toInsert });
  }

  return { inserted: toInsert.length, skipped, total: toInsert.length + skipped, details };
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

  const toInsert: { datePassage: Date; site: string; typeUsager: string | null }[] = [];
  let skipped = 0;

  for (const row of rows) {
    if (row["STATUT"] === "I" || row["COMPTABILISE"] === "NON") {
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

    toInsert.push({ datePassage, site, typeUsager });
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

  const toInsert: { dateCollecte: Date; site: string; categorieFlux: string; prestataire: string; matiere: string; poidsTonnes: number }[] = [];
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

    toInsert.push({ dateCollecte, site, categorieFlux: "PAYANT", prestataire: "EGT", matiere, poidsTonnes });
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

  const toInsert: { dateCollecte: Date; site: string; categorieFlux: string; prestataire: string; matiere: string; poidsTonnes: number }[] = [];
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

  const toInsert: { dateCollecte: Date; site: string; categorieFlux: string; prestataire: string; matiere: string; poidsTonnes: number }[] = [];
  let skipped = 0;

  for (const row of rows) {
    const dateCollecte = parseExcelDate(row["Date collecte"]) ?? monthInfo?.refDate ?? null;
    const site = normalizeSiteName(row["Nom commercial"]);
    const poidsKg = toNumber(row["Poids collecté"]);

    if (!dateCollecte || !site || Number.isNaN(poidsKg)) {
      skipped++;
      continue;
    }

    toInsert.push({
      dateCollecte,
      site,
      categorieFlux: "REP",
      prestataire: "Piles",
      matiere: "PILES",
      poidsTonnes: poidsKg / 1000,
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

  const toInsert: { dateCollecte: Date; site: string; categorieFlux: string; prestataire: string; matiere: string; poidsTonnes: number }[] = [];
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

    toInsert.push({ dateCollecte, site, categorieFlux: "PAYANT", prestataire: "Chimirec", matiere, poidsTonnes });
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

  const toInsert: { dateCollecte: Date; site: string; categorieFlux: string; prestataire: string; matiere: string; poidsTonnes: number }[] = [];
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

    toInsert.push({ dateCollecte, site, categorieFlux: "REP", prestataire: "EcoDDS", matiere, poidsTonnes });
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
  const monthInfo = parseTargetMonth(targetMonth);
  if (!monthInfo) {
    throw new Error(
        "Le mois cible (targetMonth, format AAAA-MM) est obligatoire pour le workflow Eco'Sol : il sert à cibler la bonne colonne du tableau croisé."
    );
  }

  const toInsert: { dateCollecte: Date; site: string; categorieFlux: string; prestataire: string; matiere: string; poidsTonnes: number }[] = [];
  let skipped = 0;
  const details: string[] = [];

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: true, defval: null });

    if (matrix.length <= ECOSOL_TARGET_ROW_INDEX) {
      skipped++;
      details.push(`${sheetName} : feuille trop courte (ligne 29 introuvable), ignorée`);
      continue;
    }

    let monthCol: number | null = null;
    for (let r = 0; r < Math.min(matrix.length, 12) && monthCol === null; r++) {
      const row = matrix[r] ?? [];
      for (let c = 0; c < row.length; c++) {
        const cell = row[c];
        if (typeof cell === "string" && cell.trim().toLowerCase() === monthInfo.fullLabel.toLowerCase()) {
          monthCol = c;
          break;
        }
      }
    }

    if (monthCol === null) {
      monthCol = 2 + (monthInfo.monthIndex % 3);
    }

    const targetRow = matrix[ECOSOL_TARGET_ROW_INDEX] ?? [];
    const raw = targetRow[monthCol];
    const poidsKg = toNumber(raw);

    if (raw === null || raw === undefined || raw === "" || Number.isNaN(poidsKg)) {
      skipped++;
      details.push(`${sheetName} : aucune valeur exploitable (ligne 29, colonne ${monthCol})`);
      continue;
    }

    toInsert.push({
      dateCollecte: monthInfo.refDate,
      site: sheetName.trim(),
      categorieFlux: "REP",
      prestataire: "Eco'Sol",
      matiere: "Détournement",
      poidsTonnes: poidsKg / 1000,
    });
    details.push(`${sheetName} : ${poidsKg} kg détectés (colonne ${monthCol})`);
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
