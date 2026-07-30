"use client";

import { useRef, useState, useMemo } from "react";
import {
  UploadCloud,
  FileSpreadsheet,
  CheckCircle2,
  AlertTriangle,
  DoorOpen,
  Truck,
  Cpu,
  BatteryFull,
  FlaskConical,
  ShieldCheck,
  Sparkles,
  ChevronRight,
  Loader2,
  CalendarDays,
  PenLine,
  Save
} from "lucide-react";

type WorkflowId = "passages" | "egt" | "d3e" | "piles" | "chimirec" | "ecodds" | "ecosol";
type PeriodType = "MENSUEL" | "TRIMESTRIEL";
type InputMode = "file" | "manual";

type WorkflowDef = {
  id: WorkflowId;
  label: string;
  description: string;
  fileHint: string;
  icon: typeof Truck;
  periodType: PeriodType;
};

const WORKFLOWS: WorkflowDef[] = [
  { id: "passages", label: "Passages", description: "Passages en déchèterie", fileHint: "Passages_en_déchèterie_*.xlsx", icon: DoorOpen, periodType: "MENSUEL" },
  { id: "egt", label: "Flux EGT", description: "Récapitulatif collectivités", fileHint: "recapitulatif-collectivites-*.xlsx", icon: Truck, periodType: "MENSUEL" },
  { id: "d3e", label: "D3E", description: "Déchets d'équipements", fileHint: "D3E.xlsx", icon: Cpu, periodType: "MENSUEL" },
  { id: "piles", label: "Piles", description: "Collecte de piles", fileHint: "export_statistiques_...xlsx", icon: BatteryFull, periodType: "MENSUEL" },
  { id: "chimirec", label: "Chimirec", description: "Bilan déchets dangereux", fileHint: "Chimirec_-Bilan-_*.xlsx", icon: FlaskConical, periodType: "MENSUEL" },
  { id: "ecodds", label: "EcoDDS", description: "Portail EcoDDS", fileHint: "Portail_ECODDS_*.xlsx", icon: ShieldCheck, periodType: "MENSUEL" },
  { id: "ecosol", label: "Eco'Sol", description: "Recycleries — flux", fileHint: "ECO_SOL_*.xlsx", icon: Sparkles, periodType: "TRIMESTRIEL" },
];

type UploadState = "idle" | "uploading" | "success" | "error";

type ApiResult = {
  success: boolean;
  workflow?: string;
  fileName?: string;
  periodeReference: string;
  inserted: number;
  skipped: number;
  total: number;
  details?: string[];
  error?: string;
};

function currentMonthValue(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

export default function DecheterieUploadPage() {
  const [inputMode, setInputMode] = useState<InputMode>("file");
  const [workflowId, setWorkflowId] = useState<WorkflowId>("passages");

  // États de sélection temporelle
  const [targetMonth, setTargetMonth] = useState<string>(currentMonthValue());
  const [targetYear, setTargetYear] = useState<string>(String(new Date().getFullYear()));
  const [targetQuarter, setTargetQuarter] = useState<string>("T1");

  // États pour l'import de fichier
  const [fileName, setFileName] = useState<string | null>(null);
  const fileRef = useRef<File | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

  // États pour la saisie manuelle (Données par mail)
  const [manualData, setManualData] = useState({
    pneus: "",
    ecoMaison: "",
    ecoLogic: "",
    radiographies: "",
    huileVegetale: "",
  });

  // États globaux UI
  const [state, setState] = useState<UploadState>("idle");
  const [result, setResult] = useState<ApiResult | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const activeWorkflow = WORKFLOWS.find((w) => w.id === workflowId)!;

  const computedPeriodeReference = useMemo(() => {
    // Si on est en saisie manuelle, on part du principe que c'est mensuel,
    // tu pourras ajuster si certains mails sont trimestriels.
    if (inputMode === "manual") return targetMonth;
    if (activeWorkflow.periodType === "TRIMESTRIEL") return `${targetYear}-${targetQuarter}`;
    return targetMonth;
  }, [inputMode, activeWorkflow.periodType, targetYear, targetQuarter, targetMonth]);

  function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    fileRef.current = files[0];
    setFileName(files[0].name);
    setState("idle");
    setResult(null);
    setErrorMessage(null);
  }

  // --- SOUMISSION FICHIER ---
  async function handleFileSubmit() {
    if (!fileRef.current) return;
    setState("uploading");
    setErrorMessage(null);

    const formData = new FormData();
    formData.append("file", fileRef.current);
    formData.append("workflow", workflowId);
    formData.append("targetMonth", computedPeriodeReference);

    try {
      const res = await fetch("/api/upload", { method: "POST", body: formData });
      const data: ApiResult = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error ?? "Erreur lors de l'import.");
      setResult(data);
      setState("success");
    } catch (err: any) {
      setErrorMessage(err.message || "Impossible de contacter le serveur.");
      setState("error");
    }
  }

  // --- SOUMISSION MANUELLE ---
  async function handleManualSubmit() {
    setState("uploading");
    setErrorMessage(null);

    // On utilise FormData pour taper sur le même route.ts que les fichiers
    const formData = new FormData();
    formData.append("workflow", "manual_saisie");
    formData.append("targetMonth", computedPeriodeReference);

    // On ajoute chaque valeur saisie
    formData.append("pneus", manualData.pneus);
    formData.append("ecoMaison", manualData.ecoMaison);
    formData.append("ecoLogic", manualData.ecoLogic);
    formData.append("radiographies", manualData.radiographies);
    formData.append("huileVegetale", manualData.huileVegetale);

    try {
      const res = await fetch("/api/upload", {
        method: "POST",
        body: formData // Pas de JSON, on reste sur du FormData !
      });

      const data: ApiResult = await res.json();

      if (!res.ok || !data.success) {
        throw new Error(data.error ?? "Erreur lors de la sauvegarde.");
      }

      setResult(data);
      setState("success");
    } catch (err: any) {
      setErrorMessage(err.message || "Impossible de contacter le serveur.");
      setState("error");
    }
  }

  function reset() {
    fileRef.current = null;
    setFileName(null);
    setState("idle");
    setResult(null);
    setErrorMessage(null);
    setManualData({ pneus: "", ecoMaison: "", ecoLogic: "", radiographies: "", huileVegetale: "" });
    if (inputRef.current) inputRef.current.value = "";
  }

  const canSubmitFile = !!fileName && !!computedPeriodeReference && state !== "uploading";
  const canSubmitManual = !!computedPeriodeReference && state !== "uploading" && Object.values(manualData).some(v => v !== "");

  return (
      <div className="min-h-screen w-full bg-[#F4F7F5] flex items-center justify-center px-4 py-10">
        <div className="w-full max-w-2xl">
          <div className="flex items-center gap-3 mb-8 justify-center">
            <div className="w-11 h-11 rounded-xl bg-[#0F2A3D] flex items-center justify-center shadow-sm">
              <DoorOpen className="w-6 h-6 text-[#7FD9AE]" strokeWidth={2.2} />
            </div>
            <div>
              <p className="text-[#0F2A3D] text-xl font-extrabold leading-tight">Module Déchèteries</p>
              <p className="text-[#52677A] text-xs tracking-wide uppercase">Intégration des données</p>
            </div>
          </div>

          <div className="bg-white rounded-2xl border border-[#E1E8E6] shadow-[0_8px_24px_-8px_rgba(15,42,61,0.08)] overflow-hidden">

            {/* TABS (Fichiers vs Manuel) */}
            <div className="flex border-b border-[#E1E8E6] bg-[#FAFCFB]">
              <button
                  onClick={() => { setInputMode("file"); reset(); }}
                  className={`flex-1 flex items-center justify-center gap-2 py-4 text-sm font-bold transition-colors ${
                      inputMode === "file" ? "text-[#0F2A3D] border-b-2 border-[#2E9E6D] bg-white" : "text-[#8AA0AA] hover:text-[#52677A]"
                  }`}
              >
                <FileSpreadsheet className="w-4 h-4" />
                Import de fichiers
              </button>
              <button
                  onClick={() => { setInputMode("manual"); reset(); }}
                  className={`flex-1 flex items-center justify-center gap-2 py-4 text-sm font-bold transition-colors ${
                      inputMode === "manual" ? "text-[#0F2A3D] border-b-2 border-[#2E9E6D] bg-white" : "text-[#8AA0AA] hover:text-[#52677A]"
                  }`}
              >
                <PenLine className="w-4 h-4" />
                Saisie Manuelle (Emails)
              </button>
            </div>

            <div className="p-8">
              {/* SÉLECTEUR DE PÉRIODE (Commun aux deux modes) */}
              <div className="mb-7">
                <p className="text-[#0F2A3D] text-xs uppercase tracking-wide font-bold mb-3">
                  {inputMode === "file" ? "1. " : ""}Période de référence
                </p>

                {(inputMode === "manual" || activeWorkflow.periodType === "MENSUEL") && (
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
                )}

                {inputMode === "file" && activeWorkflow.periodType === "TRIMESTRIEL" && (
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
              </div>

              {/* --- VUE IMPORT DE FICHIER --- */}
              {inputMode === "file" && (
                  <>
                    <div className="mb-7">
                      <p className="text-[#0F2A3D] text-xs uppercase tracking-wide font-bold mb-3">2. Type de fichier</p>
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                        {WORKFLOWS.map((w) => {
                          const Icon = w.icon;
                          const selected = workflowId === w.id;
                          return (
                              <button
                                  key={w.id}
                                  type="button"
                                  onClick={() => { setWorkflowId(w.id); reset(); }}
                                  className={`flex flex-col items-start gap-1.5 rounded-xl border px-3 py-3 text-left transition-all ${
                                      selected ? "border-[#2E9E6D] bg-[#EFF8F3] shadow-[0_0_0_3px_rgba(46,158,109,0.12)]" : "border-[#E1E8E6] bg-white hover:border-[#B9CFC6]"
                                  }`}
                              >
                                <Icon className="w-4 h-4" style={{ color: selected ? "#2E9E6D" : "#52677A" }} strokeWidth={2} />
                                <span className={`text-[11px] leading-tight font-semibold ${selected ? "text-[#0F2A3D]" : "text-[#52677A]"}`}>{w.label}</span>
                                <span className="text-[9px] text-[#8AA0AA] leading-tight">{w.description}</span>
                              </button>
                          );
                        })}
                      </div>
                    </div>

                    <div>
                      <p className="text-[#0F2A3D] text-xs uppercase tracking-wide font-bold mb-3">
                        3. Fichier Excel — {activeWorkflow.fileHint}
                      </p>
                      <div
                          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                          onDragLeave={() => setDragOver(false)}
                          onDrop={(e) => { e.preventDefault(); setDragOver(false); handleFiles(e.dataTransfer.files); }}
                          onClick={() => inputRef.current?.click()}
                          className={`rounded-xl border-2 border-dashed px-6 py-9 flex flex-col items-center justify-center gap-3 cursor-pointer transition-colors ${
                              dragOver ? "border-[#1D6FA5] bg-[#EAF3F9]" : "border-[#D8E2DF] bg-[#FAFCFB] hover:bg-[#F4F7F5]"
                          }`}
                      >
                        <input ref={inputRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={(e) => handleFiles(e.target.files)} />
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
                              <p className="text-xs text-[#52677A]">ou cliquez pour parcourir — .xlsx, .xls, .csv</p>
                            </>
                        )}
                      </div>
                    </div>

                    <button
                        type="button"
                        disabled={!canSubmitFile}
                        onClick={handleFileSubmit}
                        className={`w-full mt-7 rounded-xl py-3.5 flex items-center justify-center gap-2 font-bold transition-all ${
                            canSubmitFile ? "bg-[#0F2A3D] text-white hover:bg-[#153a54] shadow-sm" : "bg-[#EDF1F0] text-[#9AAAA5] cursor-not-allowed"
                        }`}
                    >
                      {state === "uploading" ? <><Loader2 className="w-4 h-4 animate-spin" /> Traitement en cours…</> : <><UploadCloud className="w-4 h-4" /> Transférer le fichier</>}
                    </button>
                  </>
              )}

              {/* --- VUE SAISIE MANUELLE --- */}
              {inputMode === "manual" && (
                  <>
                    <p className="text-[#0F2A3D] text-xs uppercase tracking-wide font-bold mb-3">Tonnages reçus par mail (en Tonnes)</p>
                    <div className="space-y-4 bg-[#FAFCFB] border border-[#E1E8E6] p-5 rounded-xl">

                      <div className="flex items-center justify-between gap-4">
                        <label className="text-sm font-semibold text-[#0F2A3D] w-1/2">Pneus <span className="text-[10px] text-[#8AA0AA] font-normal">(Alpharecyclage)</span></label>
                        <input type="number" step="0.01" min="0" placeholder="0.00" value={manualData.pneus} onChange={e => setManualData({...manualData, pneus: e.target.value})} className="w-1/2 rounded-lg border border-[#E1E8E6] px-3 py-2 text-sm text-[#0F2A3D] focus:ring-2 focus:ring-[#2E9E6D]/30 focus:border-[#2E9E6D] text-right" />
                      </div>

                      <div className="flex items-center justify-between gap-4">
                        <label className="text-sm font-semibold text-[#0F2A3D] w-1/2">Eco maison <span className="text-[10px] text-[#8AA0AA] font-normal">(Sytraival)</span></label>
                        <input type="number" step="0.01" min="0" placeholder="0.00" value={manualData.ecoMaison} onChange={e => setManualData({...manualData, ecoMaison: e.target.value})} className="w-1/2 rounded-lg border border-[#E1E8E6] px-3 py-2 text-sm text-[#0F2A3D] focus:ring-2 focus:ring-[#2E9E6D]/30 focus:border-[#2E9E6D] text-right" />
                      </div>

                      <div className="flex items-center justify-between gap-4">
                        <label className="text-sm font-semibold text-[#0F2A3D] w-1/2">Eco logic <span className="text-[10px] text-[#8AA0AA] font-normal">(Sytraival)</span></label>
                        <input type="number" step="0.01" min="0" placeholder="0.00" value={manualData.ecoLogic} onChange={e => setManualData({...manualData, ecoLogic: e.target.value})} className="w-1/2 rounded-lg border border-[#E1E8E6] px-3 py-2 text-sm text-[#0F2A3D] focus:ring-2 focus:ring-[#2E9E6D]/30 focus:border-[#2E9E6D] text-right" />
                      </div>

                      <div className="flex items-center justify-between gap-4">
                        <label className="text-sm font-semibold text-[#0F2A3D] w-1/2">Radiographies <span className="text-[10px] text-[#8AA0AA] font-normal">(Rhône Alpes Argent)</span></label>
                        <input type="number" step="0.01" min="0" placeholder="0.00" value={manualData.radiographies} onChange={e => setManualData({...manualData, radiographies: e.target.value})} className="w-1/2 rounded-lg border border-[#E1E8E6] px-3 py-2 text-sm text-[#0F2A3D] focus:ring-2 focus:ring-[#2E9E6D]/30 focus:border-[#2E9E6D] text-right" />
                      </div>

                      <div className="flex items-center justify-between gap-4">
                        <label className="text-sm font-semibold text-[#0F2A3D] w-1/2">Huile végétale <span className="text-[10px] text-[#8AA0AA] font-normal">(Quatra)</span></label>
                        <input type="number" step="0.01" min="0" placeholder="0.00" value={manualData.huileVegetale} onChange={e => setManualData({...manualData, huileVegetale: e.target.value})} className="w-1/2 rounded-lg border border-[#E1E8E6] px-3 py-2 text-sm text-[#0F2A3D] focus:ring-2 focus:ring-[#2E9E6D]/30 focus:border-[#2E9E6D] text-right" />
                      </div>

                    </div>

                    <button
                        type="button"
                        disabled={!canSubmitManual}
                        onClick={handleManualSubmit}
                        className={`w-full mt-7 rounded-xl py-3.5 flex items-center justify-center gap-2 font-bold transition-all ${
                            canSubmitManual ? "bg-[#0F2A3D] text-white hover:bg-[#153a54] shadow-sm" : "bg-[#EDF1F0] text-[#9AAAA5] cursor-not-allowed"
                        }`}
                    >
                      {state === "uploading" ? <><Loader2 className="w-4 h-4 animate-spin" /> Sauvegarde en cours…</> : <><Save className="w-4 h-4" /> Enregistrer les tonnages</>}
                    </button>
                  </>
              )}

              {/* --- RÉTROACTIONS (Succès / Erreur) --- */}
              {state === "success" && result && (
                  <div className="mt-5 rounded-xl bg-[#EFF8F3] border border-[#CFE9DB] p-4">
                    <div className="flex items-center gap-2 mb-2">
                      <CheckCircle2 className="w-4 h-4 text-[#2E9E6D]" />
                      <p className="text-sm font-bold text-[#0F2A3D]">Import réussi</p>
                    </div>
                    <p className="text-xs text-[#3E6B58]">
                      Période traitée : <strong className="font-bold">{result.periodeReference}</strong>.
                    </p>
                    {result.details && result.details.length > 0 && (
                        <ul className="mt-2 space-y-0.5">
                          {result.details.map((d, i) => (
                              <li key={i} className="text-[11px] text-[#3E6B58]">• {d}</li>
                          ))}
                        </ul>
                    )}
                    <button type="button" onClick={reset} className="mt-3 text-xs font-semibold text-[#1D6FA5] hover:underline">
                      {inputMode === "file" ? "Importer un autre fichier" : "Saisir une autre période"}
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

          <p className="text-center text-[#9AAAA5] text-xs mt-5">
            Les données sont enregistrées en toute sécurité dans la base SQLite via Prisma.
          </p>
        </div>
      </div>
  );
}
