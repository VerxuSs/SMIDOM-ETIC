"use client";

import { useRef, useState, useMemo } from "react";
import {
  UploadCloud,
  FileSpreadsheet,
  CheckCircle2,
  AlertTriangle,
  ArrowLeftRight,
  Users,
  Archive,
  MapPinned,
  PackageX,
  ClipboardX,
  Boxes,
  Clock3,
  ChevronRight,
  Loader2,
  CalendarDays,
  Globe2
} from "lucide-react";

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

// Catégories temporelles pour piloter l'interface
type PeriodType = "ANNUEL" | "TRIMESTRIEL" | "GLOBAL";

type WorkflowDef = {
  id: WorkflowId;
  label: string;
  description: string;
  fileHint: string;
  icon: typeof ArrowLeftRight;
  periodType: PeriodType;
};

const WORKFLOWS: WorkflowDef[] = [
  {
    id: "mouvements",
    label: "Mouvements",
    description: "Balance arrivées / départs",
    fileHint: "balance_arrivées_et_départ.xlsx",
    icon: ArrowLeftRight,
    periodType: "ANNUEL",
  },
  {
    id: "redevables",
    label: "Redevables",
    description: "Particuliers / Pro / Admin",
    fileHint: "liste_redevables.xlsx",
    icon: Users,
    periodType: "GLOBAL",
  },
  {
    id: "bacs",
    label: "Clients Bacs/Sacs",
    description: "Filtres sans doublons",
    fileHint: "liste_clients_avec_bac_et_bac_convention.xlsx",
    icon: Archive,
    periodType: "GLOBAL",
  },
  {
    id: "convention",
    label: "Clients Convention",
    description: "Filtre trimestriel sur date",
    fileHint: "liste_clients_avec_bac_et_bac_convention.xlsx",
    icon: Archive,
    periodType: "TRIMESTRIEL",
  },
  {
    id: "pav",
    label: "Clients PAV",
    description: "Points d'apport volontaire",
    fileHint: "liste_déposants_et_supports.xlsx",
    icon: MapPinned,
    periodType: "GLOBAL",
  },
  {
    id: "zero_depot",
    label: "Anomalies 0 dépôt",
    description: "Déposants sans dépôt",
    fileHint: "liste_déposants_avec_0_dépôt.xlsx",
    icon: PackageX,
    periodType: "TRIMESTRIEL",
  },
  {
    id: "zero_levee",
    label: "Anomalies 0 levée",
    description: "Bacs sans collecte (TCD)",
    fileHint: "liste_clients_avec_bac_sans_collecte.xlsx",
    icon: ClipboardX,
    periodType: "TRIMESTRIEL",
  },
  {
    id: "sans_dotation",
    label: "Sans dotation",
    description: "Clients actifs sans support",
    fileHint: "liste_clients_actifs_sans_support_et_sans_bac.xlsx",
    icon: Boxes,
    periodType: "TRIMESTRIEL",
  },
  {
    id: "evenements",
    label: "Événements en cours",
    description: "Dossiers en traitement",
    fileHint: "liste_évenements_en_cours.xlsx",
    icon: Clock3,
    periodType: "TRIMESTRIEL",
  },
];

type UploadState = "idle" | "uploading" | "success" | "error";

type ApiResult = {
  success: boolean;
  workflow: string;
  fileName: string;
  periodeReference: string;
  rowsScanned: number;
  details: string[];
  warning?: string;
  error?: string;
};

export default function RiUploadPage() {
  const [workflowId, setWorkflowId] = useState<WorkflowId>("mouvements");

  // États de sélection temporelle
  const [targetYear, setTargetYear] = useState<string>(String(new Date().getFullYear()));
  const [targetQuarter, setTargetQuarter] = useState<string>("T1");

  const [fileName, setFileName] = useState<string | null>(null);
  const [state, setState] = useState<UploadState>("idle");
  const [result, setResult] = useState<ApiResult | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<File | null>(null);

  const activeWorkflow = WORKFLOWS.find((w) => w.id === workflowId)!;

  // Calcul dynamique de la période envoyée au backend selon le type de workflow
  const computedPeriodeReference = useMemo(() => {
    if (activeWorkflow.periodType === "GLOBAL") return "GLOBALE";
    if (activeWorkflow.periodType === "ANNUEL") return `${targetYear}-ANNUEL`;
    return `${targetYear}-${targetQuarter}`; // TRIMESTRIEL
  }, [activeWorkflow.periodType, targetYear, targetQuarter]);

  function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    fileRef.current = files[0];
    setFileName(files[0].name);
    setState("idle");
    setResult(null);
    setErrorMessage(null);
  }

  async function handleSubmit() {
    if (!fileRef.current) return;
    setState("uploading");
    setErrorMessage(null);

    const formData = new FormData();
    formData.append("file", fileRef.current);
    formData.append("workflow", workflowId);
    // On envoie la chaîne construite (ex: "GLOBALE", "2026-ANNUEL", "2026-T1")
    formData.append("periodeReference", computedPeriodeReference);

    try {
      const res = await fetch("/api/upload-ri", { method: "POST", body: formData });
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

  const canSubmit = !!fileName && state !== "uploading";

  return (
      <div className="min-h-screen w-full bg-[#F4F7F5] flex items-center justify-center px-4 py-10">
        <div className="w-full max-w-2xl">
          <div className="flex items-center gap-3 mb-8 justify-center">
            <div className="w-11 h-11 rounded-xl bg-[#0F2A3D] flex items-center justify-center shadow-sm">
              <Users className="w-6 h-6 text-[#7FD9AE]" strokeWidth={2.2} />
            </div>
            <div>
              <p className="text-[#0F2A3D] text-xl font-extrabold leading-tight">Module RI</p>
              <p className="text-[#52677A] text-xs tracking-wide uppercase">Redevance incitative — Données & Anomalies</p>
            </div>
          </div>

          <div className="bg-white rounded-2xl border border-[#E1E8E6] shadow-[0_8px_24px_-8px_rgba(15,42,61,0.08)] p-8">
            <h1 className="text-[#0F2A3D] text-2xl font-extrabold mb-1">Importer un fichier Styx</h1>
            <p className="text-[#52677A] text-sm mb-7">
              Chaque fichier est agrégé à la volée. Seuls les compteurs (KPIs) sont mis à jour (Upsert).
            </p>

            {/* Sélecteur de workflow */}
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
                            className="text-[11px] leading-tight font-semibold"
                            style={{ color: selected ? "#0F2A3D" : "#52677A" }}
                        >
                      {w.label}
                    </span>
                        <span className="text-[9px] text-[#8AA0AA] leading-tight">{w.description}</span>
                      </button>
                  );
                })}
              </div>
            </div>

            {/* Sélecteur de période dynamique */}
            <div className="mb-7">
              <p className="text-[#0F2A3D] text-xs uppercase tracking-wide font-bold mb-3">
                2. Période de référence
              </p>

              {activeWorkflow.periodType === "GLOBAL" && (
                  <div className="flex items-center gap-3 bg-[#EAF3F9] border border-[#CFE4F3] rounded-xl px-4 py-3">
                    <Globe2 className="w-5 h-5 text-[#1D6FA5]" />
                    <div>
                      <p className="text-sm font-bold text-[#0F2A3D]">Mise à jour globale (Instantanée)</p>
                      <p className="text-[11px] text-[#52677A]">Ce fichier remplace les données précédentes sans conserver d'historique.</p>
                    </div>
                  </div>
              )}

              {activeWorkflow.periodType === "ANNUEL" && (
                  <div className="flex gap-4">
                    <div className="flex-1 relative">
                      <CalendarDays className="w-4 h-4 text-[#52677A] absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                      <select
                          value={targetYear}
                          onChange={(e) => setTargetYear(e.target.value)}
                          className="w-full rounded-xl border border-[#E1E8E6] bg-[#FAFCFB] pl-10 pr-3.5 py-2.5 text-sm text-[#0F2A3D] font-semibold focus:outline-none focus:ring-2 focus:ring-[#2E9E6D]/30 focus:border-[#2E9E6D]"
                      >
                        <option value="2024">2024</option>
                        <option value="2025">2025</option>
                        <option value="2026">2026</option>
                        <option value="2027">2027</option>
                      </select>
                    </div>
                  </div>
              )}

              {activeWorkflow.periodType === "TRIMESTRIEL" && (
                  <div className="flex gap-4">
                    <div className="flex-1 relative">
                      <CalendarDays className="w-4 h-4 text-[#52677A] absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                      <select
                          value={targetYear}
                          onChange={(e) => setTargetYear(e.target.value)}
                          className="w-full rounded-xl border border-[#E1E8E6] bg-[#FAFCFB] pl-10 pr-3.5 py-2.5 text-sm text-[#0F2A3D] font-semibold focus:outline-none focus:ring-2 focus:ring-[#2E9E6D]/30 focus:border-[#2E9E6D]"
                      >
                        <option value="2024">Année 2024</option>
                        <option value="2025">Année 2025</option>
                        <option value="2026">Année 2026</option>
                        <option value="2027">Année 2027</option>
                      </select>
                    </div>
                    <div className="flex-1 relative">
                      <select
                          value={targetQuarter}
                          onChange={(e) => setTargetQuarter(e.target.value)}
                          className="w-full rounded-xl border border-[#E1E8E6] bg-[#FAFCFB] px-3.5 py-2.5 text-sm text-[#0F2A3D] font-semibold focus:outline-none focus:ring-2 focus:ring-[#2E9E6D]/30 focus:border-[#2E9E6D]"
                      >
                        <option value="T1">Trimestre 1</option>
                        <option value="T2">Trimestre 2</option>
                        <option value="T3">Trimestre 3</option>
                        <option value="T4">Trimestre 4</option>
                      </select>
                    </div>
                  </div>
              )}

              {activeWorkflow.periodType !== "GLOBAL" && (
                  <p className="text-[11px] text-[#8AA0AA] mt-1.5">
                    Les indicateurs seront enregistrés sous la période : <strong className="text-[#0F2A3D]">{computedPeriodeReference}</strong>.
                  </p>
              )}
            </div>

            {/* Dropzone */}
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

            {/* Résultat */}
            {state === "success" && result && (
                <div className="mt-5 rounded-xl bg-[#EFF8F3] border border-[#CFE9DB] p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <CheckCircle2 className="w-4 h-4 text-[#2E9E6D]" />
                    <p className="text-sm font-bold text-[#0F2A3D]">
                      Indicateurs mis à jour pour {result.periodeReference}
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
