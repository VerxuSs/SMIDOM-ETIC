import { NextRequest, NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

type WorkflowId =
    | "mouvements"
    | "redevables"
    | "bacs"
    | "convention"
    | "pav"
    | "zero_depot"
    | "zero_levee"
    | "sans_dotation"
    | "evenements";

type Counters = Record<string, number>;

type WorkflowOutcome = {
  counters: Counters;
  totalRows: number;
  note?: string;
};

/* -----------------------------------------------------------------------
 * Helpers génériques
 * --------------------------------------------------------------------- */

function toNumber(value: unknown): number {
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const normalized = value.trim().replace(/\s/g, "").replace(",", ".");
    return Number(normalized);
  }
  return NaN;
}

function firstSheet(workbook: XLSX.WorkBook): XLSX.WorkSheet {
  return workbook.Sheets[workbook.SheetNames[0]];
}

// Convertit une date Excel (numéro de série) ou chaîne en objet Date JS
function parseExcelDate(value: unknown): Date | null {
  if (value instanceof Date) return value;
  if (typeof value === "number") {
    const utc_days = Math.floor(value - 25569);
    const utc_value = utc_days * 86400;
    return new Date(utc_value * 1000);
  }
  if (typeof value === "string") {
    const parsed = new Date(value);
    return isNaN(parsed.getTime()) ? null : parsed;
  }
  return null;
}

// Fonction de nettoyage pour les exclusions demandées
function isExcludedClient(usagerModele: string): boolean {
  const upper = usagerModele.toUpperCase();
  return upper.includes("SMIDOM") || upper.includes("BAC DE REGROUPEMENT");
}

/* =========================================================================
 * MODULE RI — Stratégie "agrégation à la volée"
 * ======================================================================= */

/* -----------------------------------------------------------------------
 * Workflow "mouvements" — balance arrivées et départ (Annuel)
 * --------------------------------------------------------------------- */
function computeMouvements(workbook: XLSX.WorkBook): WorkflowOutcome {
  const sheet = firstSheet(workbook);
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: null });

  const counters: Counters = { ARRIVEES_CLIENTS: 0, DEPARTS_CLIENTS: 0 };

  for (const row of rows) {
    const sens = typeof row["SENS"] === "string" ? row["SENS"].trim().toUpperCase() : "";
    if (sens === "ARRIVEE") counters.ARRIVEES_CLIENTS++;
    else if (sens === "DEPART") counters.DEPARTS_CLIENTS++;
  }

  return { counters, totalRows: rows.length };
}

/* -----------------------------------------------------------------------
 * Workflow "redevables" — liste redevables (Global / Instant T)
 * --------------------------------------------------------------------- */
function computeRedevables(workbook: XLSX.WorkBook): WorkflowOutcome {
  const sheet = firstSheet(workbook);
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: null });

  const counters: Counters = { REDEVABLES_PART: 0, REDEVABLES_PRO: 0, REDEVABLES_ADMIN: 0 };

  for (const row of rows) {
    const modele = typeof row["CLIENT_MODELE"] === "string" ? row["CLIENT_MODELE"] : (row["CLIENT MODELE"] as string || "");
    const modeleStr = modele.trim().toUpperCase();

    if (!modeleStr || isExcludedClient(modeleStr)) continue;

    if (modeleStr.includes("PARTICULIER")) counters.REDEVABLES_PART++;
    if (modeleStr.includes("PROFESSIONNEL")) counters.REDEVABLES_PRO++;
    if (modeleStr.includes("ADMINISTRATION")) counters.REDEVABLES_ADMIN++;
  }

  return { counters, totalRows: rows.length };
}

/* -----------------------------------------------------------------------
 * Workflow "bacs" — liste clients avec bac (Global / Instant T)
 * --------------------------------------------------------------------- */
function computeBacs(workbook: XLSX.WorkBook): WorkflowOutcome {
  const sheet = firstSheet(workbook);
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: null });

  const counters: Counters = { CLIENTS_SAC: 0, CLIENTS_BAC: 0 };

  for (const row of rows) {
    const modele = String(row["USAGER MODELE"] || row["CLIENT_MODELE"] || "").toUpperCase();
    if (isExcludedClient(modele)) continue;

    const type = String(row["CONTENANT TYPE"] || "").trim().toUpperCase();
    if (!type) continue;

    if (type === "SAC") {
      counters.CLIENTS_SAC++;
    } else if (!type.includes("CONVENTION")) {
      // Si ce n'est ni SAC ni CONVENTION, c'est un BAC
      counters.CLIENTS_BAC++;
    }
  }

  return { counters, totalRows: rows.length };
}

/* -----------------------------------------------------------------------
 * Workflow "convention" — clients convention (Trimestriel)
 * Filtre sur la date de dotation
 * --------------------------------------------------------------------- */
function computeConvention(workbook: XLSX.WorkBook, periodeReference: string): WorkflowOutcome {
  const sheet = firstSheet(workbook);
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: null });

  const counters: Counters = { CLIENTS_CONVENTION: 0 };

  // periodeReference ressemble à "2026-T1"
  const [yearStr, quarterStr] = periodeReference.split("-");
  const targetYear = parseInt(yearStr, 10);
  const targetQuarter = parseInt(quarterStr.replace("T", ""), 10);

  for (const row of rows) {
    const type = String(row["CONTENANT TYPE"] || "").trim().toUpperCase();
    if (!type.includes("CONVENTION")) continue;

    const dateDotation = parseExcelDate(row["DATE DOTATION"]);
    if (!dateDotation) continue;

    const dotYear = dateDotation.getFullYear();
    // getMonth() est 0-indexé, on ajoute 1 pour faire le calcul
    const dotQuarter = Math.ceil((dateDotation.getMonth() + 1) / 3);

    if (dotYear === targetYear && dotQuarter === targetQuarter) {
      counters.CLIENTS_CONVENTION++;
    }
  }

  return { counters, totalRows: rows.length };
}

/* -----------------------------------------------------------------------
 * Workflow "pav" — liste déposants et supports (Global / Instant T)
 * --------------------------------------------------------------------- */
function computePav(workbook: XLSX.WorkBook): WorkflowOutcome {
  const sheet = firstSheet(workbook);
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: null });

  const counters: Counters = { CLIENTS_PAV: 0 };

  for (const row of rows) {
    const modele = String(row["USAGER MODELE"] || "").toUpperCase();
    if (isExcludedClient(modele)) continue;

    const actif = String(row["CLIENT ACTIF"] || "").toUpperCase();
    const avecSupport = toNumber(row["AVEC SUPPORT"]);

    if (actif === "O" && avecSupport === 1) {
      counters.CLIENTS_PAV++;
    }
  }

  return { counters, totalRows: rows.length };
}

/* -----------------------------------------------------------------------
 * Workflow "sans_dotation" — liste clients actifs sans support (Trimestriel)
 * --------------------------------------------------------------------- */
function computeSansDotation(workbook: XLSX.WorkBook): WorkflowOutcome {
  const sheet = firstSheet(workbook);
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: null });

  const counters: Counters = { CLIENTS_SANS_DOTATION: 0 };

  for (const row of rows) {
    const actif = String(row["CLIENT ACTIF"] || row["ACTIF"] || "").toUpperCase();
    if (actif === "O") counters.CLIENTS_SANS_DOTATION++;
  }

  return { counters, totalRows: rows.length };
}

/* -----------------------------------------------------------------------
 * Workflow "zero_depot" — déposants avec 0 dépôt (Trimestriel)
 * --------------------------------------------------------------------- */
function computeZeroDepot(workbook: XLSX.WorkBook): WorkflowOutcome {
  const sheet = firstSheet(workbook);
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: null });

  const counters: Counters = { ANOMALIE_0_DEPOT: 0 };

  for (const row of rows) {
    const modele = String(row["USAGER MODELE"] || row["MODELE"] || "").toUpperCase();
    if (isExcludedClient(modele)) continue;

    const actif = String(row["CLIENT ACTIF"] || row["ACTIF"] || "").toUpperCase();
    const visite = toNumber(row["VISITE COLONNES"] ?? row["VISITES"]);

    if (actif === "O" && visite === 0) {
      counters.ANOMALIE_0_DEPOT++;
    }
  }

  return { counters, totalRows: rows.length };
}

/* -----------------------------------------------------------------------
 * Workflow "zero_levee" — liste clients sans collecte (Trimestriel)
 * ⚠️ Fichier = TCD.
 * --------------------------------------------------------------------- */
function computeZeroLevee(workbook: XLSX.WorkBook): WorkflowOutcome {
  const counters: Counters = { ANOMALIE_0_LEVEE: 0 };
  let found = false;
  let scannedRows = 0;

  for (const sheetName of workbook.SheetNames) {
    if (found) break;
    const sheet = workbook.Sheets[sheetName];
    const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: true, defval: null });
    scannedRows += matrix.length;

    for (const row of matrix) {
      const idx = row.findIndex(
          (cell) => typeof cell === "string" && cell.trim().toLowerCase().includes("total général")
      );
      if (idx === -1) continue;

      const raw = row[idx + 1];
      const valeur = toNumber(raw);
      counters.ANOMALIE_0_LEVEE = Number.isNaN(valeur) ? 0 : valeur;
      found = true;
      break;
    }
  }

  return {
    counters,
    totalRows: scannedRows,
    note: found ? undefined : 'Ligne "Total général" introuvable dans le classeur — valeur mise à 0.',
  };
}

/* -----------------------------------------------------------------------
 * Workflow "evenements" — liste événements en cours (Trimestriel)
 * --------------------------------------------------------------------- */
function computeEvenements(workbook: XLSX.WorkBook, periodeReference: string): WorkflowOutcome {
  const sheet = firstSheet(workbook);
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: null });

  const counters: Counters = { DOSSIERS_EN_COURS: 0 };

  // Filtrage selon le trimestre de la date de début de l'événement
  const [yearStr, quarterStr] = periodeReference.split("-");
  const targetYear = parseInt(yearStr, 10);
  const targetQuarter = parseInt(quarterStr.replace("T", ""), 10);

  for (const row of rows) {
    const dateDebut = parseExcelDate(row["Date de début"] || row["DATE DEBUT"]);
    if (!dateDebut) continue;

    const eventYear = dateDebut.getFullYear();
    const eventQuarter = Math.ceil((dateDebut.getMonth() + 1) / 3);

    // Si on veut être strict sur l'appartenance au trimestre :
    if (eventYear === targetYear && eventQuarter === targetQuarter) {
      counters.DOSSIERS_EN_COURS++;
    }
  }

  return { counters, totalRows: rows.length };
}

/* -----------------------------------------------------------------------
 * Upsert générique
 * --------------------------------------------------------------------- */
async function upsertIndicateurs(periodeReference: string, counters: Counters): Promise<string[]> {
  const details: string[] = [];

  for (const [indicateur, valeur] of Object.entries(counters)) {
    await prisma.riIndicateur.upsert({
      where: { periodeReference_indicateur: { periodeReference, indicateur } },
      update: { valeur },
      create: { periodeReference, indicateur, valeur },
    });
    details.push(`${indicateur} : ${valeur}`);
  }

  return details;
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
    const periodeReferenceRaw = formData.get("periodeReference") as string | null;

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "Aucun fichier reçu." }, { status: 400 });
    }
    if (!workflow) {
      return NextResponse.json({ error: "Aucun workflow sélectionné." }, { status: 400 });
    }
    if (!periodeReferenceRaw) {
      return NextResponse.json(
          { error: "La période de référence est obligatoire pour le module RI." },
          { status: 400 }
      );
    }

    const periodeReference = periodeReferenceRaw.trim();

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

    let outcome: WorkflowOutcome;

    switch (workflow as WorkflowId) {
      case "mouvements":
        outcome = computeMouvements(workbook);
        break;
      case "redevables":
        outcome = computeRedevables(workbook);
        break;
      case "bacs":
        outcome = computeBacs(workbook);
        break;
      case "convention":
        outcome = computeConvention(workbook, periodeReference);
        break;
      case "pav":
        outcome = computePav(workbook);
        break;
      case "sans_dotation":
        outcome = computeSansDotation(workbook);
        break;
      case "zero_depot":
        outcome = computeZeroDepot(workbook);
        break;
      case "zero_levee":
        outcome = computeZeroLevee(workbook);
        break;
      case "evenements":
        outcome = computeEvenements(workbook, periodeReference);
        break;
      default:
        return NextResponse.json({ error: `Workflow inconnu : "${workflow}".` }, { status: 400 });
    }

    const details = await upsertIndicateurs(periodeReference, outcome.counters);

    return NextResponse.json({
      success: true,
      workflow,
      fileName: file.name,
      periodeReference: periodeReference,
      rowsScanned: outcome.totalRows,
      details,
      ...(outcome.note ? { warning: outcome.note } : {}),
    });
  } catch (err) {
    console.error(`[api/upload-ri] Échec du traitement (workflow="${workflow}") :`, err);
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
