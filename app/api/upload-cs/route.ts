import { NextRequest, NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { prisma } from "@/lib/prisma";
import { parseTargetMonth } from "@/lib/targetMonth";
import {parseExcelDate} from "@/lib/parseExcelDate";

export const runtime = "nodejs";

type WorkflowId = "veolia" | "papier" | "tlc" | "evolupac" | "evoluvrac";

function toNumber(value: unknown): number {
    if (typeof value === "number") return value;
    if (typeof value === "string") {
        const normalized = value.trim().replace(/\s/g, "").replace(",", ".");
        return Number(normalized);
    }
    return NaN;
}

export async function POST(req: NextRequest) {
    let workflow: WorkflowId | null = null;
    let fileName = "";

    try {
        const formData = await req.formData();
        const file = formData.get("file");
        workflow = formData.get("workflow") as WorkflowId | null;
        const targetMonthStr = formData.get("targetMonth") as string | null;

        if (!(file instanceof File)) {
            return NextResponse.json({ success: false, error: "Aucun fichier reçu." }, { status: 400 });
        }
        if (!workflow || !targetMonthStr) {
            return NextResponse.json({ success: false, error: "Workflow ou mois de référence manquant." }, { status: 400 });
        }

        fileName = file.name;
        const monthInfo = parseTargetMonth(targetMonthStr);
        if (!monthInfo) {
            return NextResponse.json({ success: false, error: "Format du mois cible invalide." }, { status: 400 });
        }

        const arrayBuffer = await file.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        const workbook = XLSX.read(buffer, { type: "buffer" });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];

        const kpiUpdates: Record<string, number> = {};
        let rowsScanned = 0;
        const details: string[] = [];

        // =========================================================================
        // WORKFLOW : VEOLIA (Emballages Régie)
        // =========================================================================
        if (workflow === "veolia") {
            const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: null });
            rowsScanned = rows.length;
            let totalTonnes = 0;
            let matchedRows = 0;

            for (const row of rows) {
                const datePesee = parseExcelDate(row["Date de la pesée"]) ?? monthInfo?.refDate ?? null;
                const lieux = String(row["Lieux d'exploitation"] || "").toLowerCase();

                // NOUVEAU FILTRE : On ne garde QUE les lignes où "Lieux d'exploitation" contient SMIDOM
                if (lieux.includes("smidom")) {
                    const tonnes = toNumber(row["Poids réalisé"]);
                    if (!Number.isNaN(tonnes)) {
                        totalTonnes += tonnes;
                        matchedRows++;
                    }
                }

                if (monthInfo?.refDate) {
                    const isSameMonth = datePesee.getMonth() === monthInfo.refDate.getMonth();
                    const isSameYear = datePesee.getFullYear() === monthInfo.refDate.getFullYear();

                    if (!isSameMonth || !isSameYear) {
                        continue; // On ignore les lignes qui ne sont pas du bon mois/année
                    }
                }
            }
            kpiUpdates["EMBALLAGES_REGIE"] = totalTonnes;
            details.push(`EMBALLAGES_REGIE : ${totalTonnes.toFixed(2)} T (${matchedRows} passages SMIDOM retenus)`);
        }

            // =========================================================================
            // WORKFLOW : PAPIER (Quincieux)
        // =========================================================================
        else if (workflow === "papier") {
            const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: null });
            rowsScanned = rows.length;
            let totalKg = 0;
            let matchedRows = 0;

            for (const row of rows) {
                const datePoidsEntree = parseExcelDate(row["Date du poids d'entrée"]) ?? monthInfo?.refDate ?? null;
                const libelle = String(row["Libellé Client"] || "").toUpperCase().trim();

                // NOUVEAU FILTRE : On vérifie que la colonne "Libellé Client" inclut le mot exact "SMIDOM"
                if (libelle.includes("SMIDOM")) {
                    const kg = toNumber(row["Net"]);
                    if (!Number.isNaN(kg)) {
                        totalKg += kg;
                        matchedRows++;
                    }
                }

                if (monthInfo?.refDate) {
                    const isSameMonth = datePoidsEntree.getMonth() === monthInfo.refDate.getMonth();
                    const isSameYear = datePoidsEntree.getFullYear() === monthInfo.refDate.getFullYear();

                    if (!isSameMonth || !isSameYear) {
                        continue; // On ignore les lignes qui ne sont pas du bon mois/année
                    }
                }
            }
            const tonnes = totalKg / 1000;
            kpiUpdates["PAPIER_QUINCIEUX"] = tonnes;
            details.push(`PAPIER_QUINCIEUX : ${tonnes.toFixed(2)} T (${matchedRows} passages SMIDOM retenus)`);
        }

            // =========================================================================
            // WORKFLOW : TLC (Le Relais) - Tableau Croisé Dynamique (Lecture du TOTAL)
        // =========================================================================
        else if (workflow === "tlc") {
            const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: null });
            rowsScanned = matrix.length;
            let targetCol = -1;
            let totalKg = 0;

            // 1. Chercher la colonne correspondant au mois (ex: "Mai") dans les 10 premières lignes
            for (let r = 0; r < Math.min(matrix.length, 10); r++) {
                const row = matrix[r] || [];
                for (let c = 0; c < row.length; c++) {
                    const cell = String(row[c] || "").trim().toLowerCase();
                    // Le mois peut avoir une astérisque (ex: "Avril*")
                    if (cell.startsWith(monthInfo.fullLabel.toLowerCase())) {
                        targetCol = c;
                        break;
                    }
                }
                if (targetCol !== -1) break;
            }

            if (targetCol === -1) {
                throw new Error(`Impossible de trouver la colonne correspondant à "${monthInfo.fullLabel}" dans le fichier TLC.`);
            }

            // 2. Chercher directement la ligne "TOTAL"
            let foundTotal = false;
            for (let r = 0; r < matrix.length; r++) {
                const row = matrix[r] || [];
                const label = String(row[0] || "").toLowerCase().trim();

                // On cible spécifiquement la ligne de total général
                if (label === "total" || label === "total général") {
                    const value = toNumber(row[targetCol]);
                    if (!Number.isNaN(value)) {
                        totalKg = value;
                        foundTotal = true;
                    }
                    break; // On a trouvé le total, on peut arrêter de lire le fichier !
                }
            }

            if (!foundTotal) {
                throw new Error("Impossible de trouver la ligne 'TOTAL' dans la première colonne du fichier.");
            }

            const tonnes = totalKg / 1000;
            kpiUpdates["TLC_LE_RELAIS"] = tonnes;
            details.push(`TLC_LE_RELAIS : ${tonnes.toFixed(2)} T (Lecture directe de la ligne TOTAL)`);
        }

            // =========================================================================
            // WORKFLOW : EVOLUPAC & EVOLUVRAC
        // =========================================================================
        else if (workflow === "evolupac" || workflow === "evoluvrac") {
            const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: null });
            rowsScanned = rows.length;
            let totalLiters = 0;
            let minCompteur = Infinity;
            let maxCompteur = -Infinity;

            for (const row of rows) {
                const values = Object.values(row);

                // Replis sur l'index 7 pour la quantité (encodage cassé "QuantitÃ©")
                const quantiteRaw = row["QuantitÃ©"] ?? values[7];
                // Replis sur l'index 9 pour le compteur
                const compteurRaw = row["Compteur"] ?? values[9];

                const liters = toNumber(quantiteRaw);
                const compteur = toNumber(compteurRaw);

                if (!Number.isNaN(liters)) {
                    totalLiters += liters;
                }
                if (!Number.isNaN(compteur) && compteur > 0) {
                    if (compteur < minCompteur) minCompteur = compteur;
                    if (compteur > maxCompteur) maxCompteur = compteur;
                }
            }

            const deltaKm = (maxCompteur !== -Infinity && minCompteur !== Infinity) ? (maxCompteur - minCompteur) : 0;

            const suffix = workflow === "evolupac" ? "EVOLUPAC" : "EVOLUVRAC";
            kpiUpdates[`CONSO_${suffix}`] = totalLiters;
            kpiUpdates[`KM_${suffix}`] = deltaKm;

            details.push(`CONSO_${suffix} : ${totalLiters.toFixed(2)} Litres`);
            details.push(`KM_${suffix} : ${deltaKm} Km parcourus`);
        }

        // =========================================================================
        // INSERTION EN BASE (UPSERT)
        // =========================================================================
        for (const [indicateur, valeur] of Object.entries(kpiUpdates)) {
            await prisma.csIndicateur.upsert({
                where: {
                    periodeReference_indicateur: {
                        periodeReference: targetMonthStr,
                        indicateur: indicateur,
                    },
                },
                update: { valeur },
                create: {
                    periodeReference: targetMonthStr,
                    indicateur,
                    valeur,
                },
            });
        }

        return NextResponse.json({
            success: true,
            workflow,
            fileName,
            targetMonth: targetMonthStr,
            rowsScanned,
            details,
        });

    } catch (error) {
        console.error(`[api/upload-cs] Erreur :`, error);
        return NextResponse.json(
            { success: false, error: error instanceof Error ? error.message : "Erreur interne serveur." },
            { status: 500 }
        );
    }
}
