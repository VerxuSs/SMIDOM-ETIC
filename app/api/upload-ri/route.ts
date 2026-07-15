import { NextRequest, NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { prisma } from "@/lib/prisma";

// La lecture de fichiers volumineux (jusqu'à ~30 000 lignes) avec `xlsx`
// nécessite le runtime Node.js (non compatible avec le runtime "edge").
export const runtime = "nodejs";

type WorkflowId =
  | "mouvements"
  | "redevables"
  | "bacs"
  | "pav"
  | "zero_depot"
  | "zero_levee"
  | "sans_dotation"
  | "evenements";

/** Compteurs KPI accumulés en mémoire : { NOM_KPI: valeur } */
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

/** Valide le format "AAAA-MM" envoyé par le champ `<input type="month">`. */
function isValidTargetMonth(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}$/.test(value.trim());
}

/* =========================================================================
 * MODULE RI — Stratégie "agrégation à la volée"
 * Chaque workflow lit le fichier ligne par ligne, incrémente des compteurs
 * en mémoire, et ne renvoie QUE ces compteurs finaux (aucune ligne brute
 * n'est jamais insérée en base).
 * ======================================================================= */

/* -----------------------------------------------------------------------
 * Workflow "mouvements" — balance arrivées et départ
 * SENS === 'ARRIVEE' -> ARRIVEES_CLIENTS | SENS === 'DEPART' -> DEPARTS_CLIENTS
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
 * Workflow "redevables" — liste redevables
 * CLIENT MODELE inclut 'PARTICULIER' / 'PROFESSIONNEL' / 'ADMINISTRATION'
 * --------------------------------------------------------------------- */
function computeRedevables(workbook: XLSX.WorkBook): WorkflowOutcome {
  const sheet = firstSheet(workbook);
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: null });

  const counters: Counters = { REDEVABLES_PART: 0, REDEVABLES_PRO: 0, REDEVABLES_ADMIN: 0 };

  for (const row of rows) {
    const modele = typeof row["CLIENT MODELE"] === "string" ? row["CLIENT MODELE"].trim().toUpperCase() : "";
    if (!modele) continue;

    // Indépendants (pas de else-if) : un même libellé pourrait en théorie
    // relever de plusieurs catégories selon les évolutions du référentiel.
    if (modele.includes("PARTICULIER")) counters.REDEVABLES_PART++;
    if (modele.includes("PROFESSIONNEL")) counters.REDEVABLES_PRO++;
    if (modele.includes("ADMINISTRATION")) counters.REDEVABLES_ADMIN++;
  }

  return { counters, totalRows: rows.length };
}

/* -----------------------------------------------------------------------
 * Workflow "bacs" — liste clients avec bac et bac convention
 * CONTENANT TYPE inclut 'CONVENTION' > 'SAC' > (non vide) 'BAC'
 * --------------------------------------------------------------------- */
function computeBacs(workbook: XLSX.WorkBook): WorkflowOutcome {
  const sheet = firstSheet(workbook);
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: null });

  const counters: Counters = { CLIENTS_CONVENTION: 0, CLIENTS_SAC: 0, CLIENTS_BAC: 0 };

  for (const row of rows) {
    const raw = row["CONTENANT TYPE"];
    const type = typeof raw === "string" ? raw.trim().toUpperCase() : "";
    if (!type) continue; // cellule vide -> pas de contenant, on ignore

    if (type.includes("CONVENTION")) counters.CLIENTS_CONVENTION++;
    else if (type.includes("SAC")) counters.CLIENTS_SAC++;
    else counters.CLIENTS_BAC++;
  }

  return { counters, totalRows: rows.length };
}

/* -----------------------------------------------------------------------
 * Workflow "pav" — liste déposants et supports
 * SUPPORT MODELE inclut 'PAV' -> CLIENTS_PAV
 * --------------------------------------------------------------------- */
function computePav(workbook: XLSX.WorkBook): WorkflowOutcome {
  const sheet = firstSheet(workbook);
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: null });

  const counters: Counters = { CLIENTS_PAV: 0 };

  for (const row of rows) {
    const raw = row["SUPPORT MODELE"];
    const modele = typeof raw === "string" ? raw.trim().toUpperCase() : "";
    if (modele.includes("PAV")) counters.CLIENTS_PAV++;
  }

  return { counters, totalRows: rows.length };
}

/* -----------------------------------------------------------------------
 * Workflow "sans_dotation" — liste clients actifs sans support et sans bac
 * ACTIF === 'O' -> CLIENTS_SANS_DOTATION
 * --------------------------------------------------------------------- */
function computeSansDotation(workbook: XLSX.WorkBook): WorkflowOutcome {
  const sheet = firstSheet(workbook);
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: null });

  const counters: Counters = { CLIENTS_SANS_DOTATION: 0 };

  for (const row of rows) {
    const actif = typeof row["ACTIF"] === "string" ? row["ACTIF"].trim() : row["ACTIF"];
    if (actif === "O") counters.CLIENTS_SANS_DOTATION++;
  }

  return { counters, totalRows: rows.length };
}

/* -----------------------------------------------------------------------
 * Workflow "zero_depot" — liste déposants avec 0 dépôt
 * ACTIF === 'O' -> ANOMALIE_0_DEPOT
 * --------------------------------------------------------------------- */
function computeZeroDepot(workbook: XLSX.WorkBook): WorkflowOutcome {
  const sheet = firstSheet(workbook);
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: null });

  const counters: Counters = { ANOMALIE_0_DEPOT: 0 };

  for (const row of rows) {
    const actif = typeof row["ACTIF"] === "string" ? row["ACTIF"].trim() : row["ACTIF"];
    if (actif === "O") counters.ANOMALIE_0_DEPOT++;
  }

  return { counters, totalRows: rows.length };
}

/* -----------------------------------------------------------------------
 * Workflow "zero_levee" — liste clients avec bac sans collecte
 * ⚠️ Fichier = Tableau Croisé Dynamique (TCD), pas une liste plate.
 * On lit chaque feuille en mode `header: 1` et on cherche la ligne dont
 * une cellule contient "Total général" ; la valeur se trouve dans la
 * cellule adjacente sur la même ligne. On parcourt toutes les feuilles du
 * classeur (le TCD n'est pas toujours sur le même onglet ni le même nom
 * selon l'export) et on s'arrête dès que la ligne est trouvée.
 * -> ANOMALIE_0_LEVEE
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

      // La valeur est dans la cellule adjacente, sur la même ligne.
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
 * Workflow "evenements" — liste événements en cours
 * Statut (insensible casse) === 'en cours' -> DOSSIERS_EN_COURS
 * --------------------------------------------------------------------- */
function computeEvenements(workbook: XLSX.WorkBook): WorkflowOutcome {
  const sheet = firstSheet(workbook);
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: null });

  const counters: Counters = { DOSSIERS_EN_COURS: 0 };

  for (const row of rows) {
    const statut = typeof row["Statut"] === "string" ? row["Statut"].trim().toLowerCase() : "";
    if (statut === "en cours") counters.DOSSIERS_EN_COURS++;
  }

  return { counters, totalRows: rows.length };
}

/* -----------------------------------------------------------------------
 * Upsert générique : 1 KPI = 1 ligne (moisReference, indicateur) unique
 * --------------------------------------------------------------------- */
async function upsertIndicateurs(moisReference: string, counters: Counters): Promise<string[]> {
  const details: string[] = [];

  for (const [indicateur, valeur] of Object.entries(counters)) {
    await prisma.riIndicateur.upsert({
      where: { moisReference_indicateur: { moisReference, indicateur } },
      update: { valeur },
      create: { moisReference, indicateur, valeur },
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
    const targetMonth = formData.get("targetMonth");

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "Aucun fichier reçu." }, { status: 400 });
    }
    if (!workflow) {
      return NextResponse.json({ error: "Aucun workflow sélectionné." }, { status: 400 });
    }
    if (!isValidTargetMonth(targetMonth)) {
      return NextResponse.json(
        { error: "Le mois de référence (targetMonth, format AAAA-MM) est obligatoire pour le module RI." },
        { status: 400 }
      );
    }
    const moisReference = targetMonth.trim();

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
        outcome = computeEvenements(workbook);
        break;
      default:
        return NextResponse.json({ error: `Workflow inconnu : "${workflow}".` }, { status: 400 });
    }

    // Agrégation à la volée : seuls les compteurs finaux sont persistés,
    // jamais les lignes brutes du fichier source.
    const details = await upsertIndicateurs(moisReference, outcome.counters);

    return NextResponse.json({
      success: true,
      workflow,
      fileName: file.name,
      targetMonth: moisReference,
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
