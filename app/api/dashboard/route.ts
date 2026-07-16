import { NextRequest, NextResponse } from "next/server";
import { computeFourWindows } from "@/lib/dateWindows";
import { getOmrTab, getDecheteriesTab, getRiTab, getCsTab } from "@/lib/dashboardQueries";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const month = req.nextUrl.searchParams.get("month");

  if (!month) {
    return NextResponse.json({ error: "Paramètre ?month=AAAA-MM requis." }, { status: 400 });
  }

  let windows;
  try {
    windows = computeFourWindows(month);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Mois invalide." },
      { status: 400 }
    );
  }

  try {
    // Les 4 onglets sont indépendants : on les calcule en parallèle plutôt
    // qu'en série pour limiter la latence totale de la requête.
    const [omr, decheteries, ri, cs] = await Promise.all([
      getOmrTab(windows),
      getDecheteriesTab(windows),
      getRiTab(windows),
      getCsTab(windows),
    ]);

    return NextResponse.json({
      success: true,
      month,
      label: windows.label,
      omr,
      decheteries,
      ri,
      cs,
    });
  } catch (err) {
    console.error("[api/dashboard] Échec de l'agrégation :", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Erreur interne lors du calcul des indicateurs." },
      { status: 500 }
    );
  }
}
