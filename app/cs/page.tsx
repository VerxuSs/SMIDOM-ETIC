"use client";

import { useRef, useState } from "react";
import {
    UploadCloud,
    FileSpreadsheet,
    CheckCircle2,
    AlertTriangle,
    Truck,
    Recycle,
    Box,
    Fuel,
    ChevronRight,
    Loader2,
    CalendarDays,
} from "lucide-react";

type WorkflowId = "veolia" | "papier" | "tlc" | "evolupac" | "evoluvrac";

type WorkflowDef = {
    id: WorkflowId;
    label: string;
    description: string;
    fileHint: string;
    icon: typeof Truck;
};

const WORKFLOWS: WorkflowDef[] = [
    {
        id: "veolia",
        label: "Emballages Régie",
        description: "Apports Veolia",
        fileHint: "Veolia_apports_*.xlsx",
        icon: Truck,
    },
    {
        id: "papier",
        label: "Collecte Papier",
        description: "Export Quincieux",
        fileHint: "EXPORT_QUINCIEUX_*.xlsx",
        icon: Recycle,
    },
    {
        id: "tlc",
        label: "Collecte TLC",
        description: "Le Relais (Textiles)",
        fileHint: "Le Relais - Collecte*.xlsx",
        icon: Box,
    },
    {
        id: "evolupac",
        label: "Evolupac A",
        description: "Km et Conso carburant",
        fileHint: "Excel Alxlvnet EVOLUPAC.xlsx",
        icon: Fuel,
    },
    {
        id: "evoluvrac",
        label: "Evoluvrac B",
        description: "Km et Conso carburant",
        fileHint: "Excel Alxlvnet EVOLUVRAC.xlsx",
        icon: Fuel,
    },
];

type UploadState = "idle" | "uploading" | "success" | "error";

type ApiResult = {
    success: boolean;
    workflow: string;
    fileName: string;
    targetMonth: string; // Ce champ est reçu, il sera enregistré en tant que "periodeReference" côté BDD
    rowsScanned: number;
    details: string[];
    warning?: string;
    error?: string;
};

function currentMonthValue(): string {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    return `${year}-${month}`;
}

export default function CsUploadPage() {
    const [workflowId, setWorkflowId] = useState<WorkflowId>("veolia");
    const [targetMonth, setTargetMonth] = useState<string>(currentMonthValue());
    const [fileName, setFileName] = useState<string | null>(null);
    const [state, setState] = useState<UploadState>("idle");
    const [result, setResult] = useState<ApiResult | null>(null);
    const [errorMessage, setErrorMessage] = useState<string | null>(null);
    const [dragOver, setDragOver] = useState(false);

    const inputRef = useRef<HTMLInputElement>(null);
    const fileRef = useRef<File | null>(null);

    const activeWorkflow = WORKFLOWS.find((w) => w.id === workflowId)!;

    function handleFiles(files: FileList | null) {
        if (!files || files.length === 0) return;
        fileRef.current = files[0];
        setFileName(files[0].name);
        setState("idle");
        setResult(null);
        setErrorMessage(null);
    }

    async function handleSubmit() {
        if (!fileRef.current || !targetMonth) return;
        setState("uploading");
        setErrorMessage(null);

        const formData = new FormData();
        formData.append("file", fileRef.current);
        formData.append("workflow", workflowId);
        // On envoie toujours le mois sélectionné, le backend le mappera sur `periodeReference`
        formData.append("targetMonth", targetMonth);

        try {
            const res = await fetch("/api/upload-cs", { method: "POST", body: formData });
            const data: ApiResult = await res.json();

            if (!res.ok || !data.success) {
                setErrorMessage(data.error ?? "Une erreur est survenue lors de l'import.");
                setState("error");
                return;
            }

            setResult(data);
            setState("success");
        } catch {
            setErrorMessage("Impossible de contacter le serveur. Vérifiez votre connexion.");
            setState("error");
        }
    }

    function reset() {
        fileRef.current = null;
        setFileName(null);
        setState("idle");
        setResult(null);
        setErrorMessage(null);
        if (inputRef.current) inputRef.current.value = "";
    }

    const canSubmit = !!fileName && !!targetMonth && state !== "uploading";

    return (
        <div className="min-h-screen w-full bg-[#F4F7F5] flex items-center justify-center px-4 py-10">
            <div className="w-full max-w-2xl">
                <div className="flex items-center gap-3 mb-8 justify-center">
                    <div className="w-11 h-11 rounded-xl bg-[#0F2A3D] flex items-center justify-center shadow-sm">
                        <Recycle className="w-6 h-6 text-[#7FD9AE]" strokeWidth={2.2} />
                    </div>
                    <div>
                        <p className="text-[#0F2A3D] text-xl font-extrabold leading-tight">Module Collecte Sélective</p>
                        <p className="text-[#52677A] text-xs tracking-wide uppercase">Tonnages, Carburants et Km</p>
                    </div>
                </div>

                <div className="bg-white rounded-2xl border border-[#E1E8E6] shadow-[0_8px_24px_-8px_rgba(15,42,61,0.08)] p-8">
                    <h1 className="text-[#0F2A3D] text-2xl font-extrabold mb-1">Importer un fichier</h1>
                    <p className="text-[#52677A] text-sm mb-7">
                        Chaque fichier est agrégé à la volée : seuls les compteurs (KPIs) calculés sont enregistrés en base de données.
                    </p>

                    <div className="mb-7">
                        <p className="text-[#0F2A3D] text-xs uppercase tracking-wide font-bold mb-3">
                            1. Type de fichier
                        </p>
                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                            {WORKFLOWS.map((w) => {
                                const Icon = w.icon;
                                const selected = workflowId === w.id;
                                return (
                                    <button
                                        key={w.id}
                                        type="button"
                                        onClick={() => {
                                            setWorkflowId(w.id);
                                            reset();
                                        }}
                                        className={[
                                            "flex flex-col items-start gap-1.5 rounded-xl border px-3 py-3 text-left transition-all",
                                            selected
                                                ? "border-[#2E9E6D] bg-[#EFF8F3] shadow-[0_0_0_3px_rgba(46,158,109,0.12)]"
                                                : "border-[#E1E8E6] bg-white hover:border-[#B9CFC6]",
                                        ].join(" ")}
                                    >
                                        <Icon
                                            className="w-4 h-4"
                                            style={{ color: selected ? "#2E9E6D" : "#52677A" }}
                                            strokeWidth={2}
                                        />
                                        <span
                                            className="text-xs leading-tight font-semibold"
                                            style={{ color: selected ? "#0F2A3D" : "#52677A" }}
                                        >
                      {w.label}
                    </span>
                                        <span className="text-[10px] text-[#8AA0AA] leading-tight">{w.description}</span>
                                    </button>
                                );
                            })}
                        </div>
                    </div>

                    <div className="mb-7">
                        <p className="text-[#0F2A3D] text-xs uppercase tracking-wide font-bold mb-3">
                            2. Période de référence (Mois)
                        </p>
                        <div className="relative">
                            <CalendarDays className="w-4 h-4 text-[#52677A] absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                            <input
                                type="month"
                                required
                                value={targetMonth}
                                onChange={(e) => setTargetMonth(e.target.value)}
                                className="w-full rounded-xl border border-[#E1E8E6] bg-[#FAFCFB] pl-10 pr-3.5 py-2.5 text-sm text-[#0F2A3D] font-semibold focus:outline-none focus:ring-2 focus:ring-[#2E9E6D]/30 focus:border-[#2E9E6D]"
                            />
                        </div>
                        <p className="text-[11px] text-[#8AA0AA] mt-1.5">
                            Les valeurs seront rattachées à ce mois de référence lors de l'enregistrement.
                        </p>
                    </div>

                    <div>
                        <p className="text-[#0F2A3D] text-xs uppercase tracking-wide font-bold mb-3">
                            3. Fichier Excel — {activeWorkflow.fileHint}
                        </p>
                        <div
                            onDragOver={(e) => {
                                e.preventDefault();
                                setDragOver(true);
                            }}
                            onDragLeave={() => setDragOver(false)}
                            onDrop={(e) => {
                                e.preventDefault();
                                setDragOver(false);
                                handleFiles(e.dataTransfer.files);
                            }}
                            onClick={() => inputRef.current?.click()}
                            className={[
                                "rounded-xl border-2 border-dashed px-6 py-9 flex flex-col items-center justify-center gap-3 cursor-pointer transition-colors",
                                dragOver ? "border-[#1D6FA5] bg-[#EAF3F9]" : "border-[#D8E2DF] bg-[#FAFCFB] hover:bg-[#F4F7F5]",
                            ].join(" ")}
                        >
                            <input
                                ref={inputRef}
                                type="file"
                                accept=".xlsx,.xls,.csv"
                                className="hidden"
                                onChange={(e) => handleFiles(e.target.files)}
                            />
                            {fileName ? (
                                <>
                                    <div className="w-11 h-11 rounded-full bg-[#EFF8F3] flex items-center justify-center">
                                        <FileSpreadsheet className="w-5 h-5 text-[#2E9E6D]" />
                                    </div>
                                    <p className="text-sm text-[#0F2A3D] font-semibold">{fileName}</p>
                                    <p className="text-xs text-[#52677A]">Cliquez pour remplacer le fichier</p>
                                </>
                            ) : (
                                <>
                                    <div className="w-11 h-11 rounded-full bg-[#EAF3F9] flex items-center justify-center">
                                        <UploadCloud className="w-5 h-5 text-[#1D6FA5]" />
                                    </div>
                                    <p className="text-sm text-[#0F2A3D] font-semibold">Glissez-déposez votre fichier ici</p>
                                    <p className="text-xs text-[#52677A]">
                                        ou cliquez pour parcourir — .xlsx, .xls
                                    </p>
                                </>
                            )}
                        </div>
                    </div>

                    <button
                        type="button"
                        disabled={!canSubmit}
                        onClick={handleSubmit}
                        className={[
                            "w-full mt-7 rounded-xl py-3.5 flex items-center justify-center gap-2 font-bold transition-all",
                            canSubmit
                                ? "bg-[#0F2A3D] text-white hover:bg-[#153a54] shadow-sm"
                                : "bg-[#EDF1F0] text-[#9AAAA5] cursor-not-allowed",
                        ].join(" ")}
                    >
                        {state === "uploading" ? (
                            <>
                                <Loader2 className="w-4 h-4 animate-spin" />
                                Calcul des indicateurs en cours…
                            </>
                        ) : (
                            <>
                                Calculer et enregistrer les KPIs
                                <ChevronRight className="w-4 h-4" />
                            </>
                        )}
                    </button>

                    {state === "success" && result && (
                        <div className="mt-5 rounded-xl bg-[#EFF8F3] border border-[#CFE9DB] p-4">
                            <div className="flex items-center gap-2 mb-2">
                                <CheckCircle2 className="w-4 h-4 text-[#2E9E6D]" />
                                <p className="text-sm font-bold text-[#0F2A3D]">
                                    Indicateurs mis à jour pour {result.targetMonth}
                                </p>
                            </div>
                            <p className="text-xs text-[#3E6B58] mb-2">
                                {result.rowsScanned.toLocaleString("fr-FR")} ligne(s) analysée(s) dans « {result.fileName} ».
                            </p>
                            <ul className="space-y-1">
                                {result.details.map((d) => (
                                    <li
                                        key={d}
                                        className="text-xs text-[#0F2A3D] font-semibold bg-white/60 rounded-lg px-2.5 py-1.5 border border-[#CFE9DB]"
                                    >
                                        {d}
                                    </li>
                                ))}
                            </ul>
                            {result.warning && (
                                <p className="text-[11px] text-[#8A6D28] mt-2 flex items-start gap-1.5">
                                    <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                                    {result.warning}
                                </p>
                            )}
                            <button
                                type="button"
                                onClick={reset}
                                className="mt-3 text-xs font-semibold text-[#1D6FA5] hover:underline"
                            >
                                Importer un autre fichier
                            </button>
                        </div>
                    )}

                    {state === "error" && errorMessage && (
                        <div className="mt-5 rounded-xl bg-[#FBEEEA] border border-[#F0D2C7] p-4 flex items-start gap-2">
                            <AlertTriangle className="w-4 h-4 text-[#C05B3C] mt-0.5 shrink-0" />
                            <p className="text-xs text-[#8A4128]">{errorMessage}</p>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
