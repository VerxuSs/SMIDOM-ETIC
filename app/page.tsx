"use client";

import { useRouter } from "next/navigation";
import {
    Truck,
    DoorOpen,
    Users,
    Recycle,
    ChevronRight,
    LayoutDashboard
} from "lucide-react";

const MODULES = [
    {
        id: "collecte",
        label: "Collecte (OM)",
        description: "Pesées, tournées, carburant",
        icon: Truck,
        color: "text-[#1D6FA5]",
        bg: "bg-[#EAF3F9]",
        href: "/omr"
    },
    {
        id: "decheterie",
        label: "Déchèterie",
        description: "Passages, flux payants, REP",
        icon: DoorOpen,
        color: "text-[#2E9E6D]",
        bg: "bg-[#EFF8F3]",
        href: "/decheterie"
    },
    {
        id: "ri",
        label: "Redevance Incitative",
        description: "Snapshots mensuels clients",
        icon: Users,
        color: "text-[#8A6D28]",
        bg: "bg-[#FFF9EA]",
        href: "/ri"
    },
    {
        id: "cs",
        label: "Collecte Sélective",
        description: "Tonnages, Km, Carburants",
        icon: Recycle,
        color: "text-[#C05B3C]",
        bg: "bg-[#FBEEEA]",
        href: "/cs"
    }
];

export default function PortalPage() {
    const router = useRouter();

    return (
        <div className="min-h-screen bg-[#F4F7F5] p-6 md:p-12">
            <div className="max-w-4xl mx-auto">

                {/* En-tête */}
                <div className="mb-10">
                    <h1 className="text-3xl font-extrabold text-[#0F2A3D]">Portail d'Administration</h1>
                    <p className="text-[#52677A] mt-2">Consultez vos indicateurs ou importez de nouvelles données.</p>
                </div>

                {/* Accès Principal : Tableau de bord */}
                <div className="mb-10">
                    <button
                        onClick={() => router.push("/dashboard")}
                        className="w-full group bg-[#0F2A3D] p-6 md:p-8 rounded-2xl shadow-[0_8px_24px_-8px_rgba(15,42,61,0.2)] hover:shadow-[0_12px_28px_-8px_rgba(15,42,61,0.3)] transition-all text-left flex items-center justify-between border border-[#153a54]"
                    >
                        <div className="flex gap-5 items-center">
                            <div className="w-14 h-14 rounded-xl bg-white/10 flex items-center justify-center shrink-0">
                                <LayoutDashboard className="w-7 h-7 text-[#7FD9AE]" />
                            </div>
                            <div>
                                <h2 className="text-xl md:text-2xl font-bold text-white mb-1">Tableau de Bord Stratégique</h2>
                                <p className="text-sm text-[#9AAAA5]">Visualisez les KPIs, les cumuls annuels et les évolutions historiques.</p>
                            </div>
                        </div>
                        <ChevronRight className="w-7 h-7 text-[#52677A] group-hover:text-white transition-colors hidden sm:block" />
                    </button>
                </div>

                {/* Séparateur visuel */}
                <div className="mb-6 flex items-center gap-3">
                    <div className="h-px bg-[#E1E8E6] flex-1"></div>
                    <p className="text-xs font-bold text-[#52677A] uppercase tracking-wider px-2">Modules d'importation</p>
                    <div className="h-px bg-[#E1E8E6] flex-1"></div>
                </div>

                {/* Grille d'imports */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {MODULES.map((m) => {
                        const Icon = m.icon;
                        return (
                            <button
                                key={m.id}
                                onClick={() => router.push(m.href)}
                                className="group bg-white p-6 rounded-2xl border border-[#E1E8E6] shadow-[0_4px_12px_-4px_rgba(15,42,61,0.08)] hover:border-[#B9CFC6] transition-all text-left flex items-start justify-between"
                            >
                                <div className="flex gap-4">
                                    <div className={`w-12 h-12 rounded-xl ${m.bg} flex items-center justify-center shrink-0`}>
                                        <Icon className={`w-6 h-6 ${m.color}`} />
                                    </div>
                                    <div>
                                        <h2 className="text-lg font-bold text-[#0F2A3D]">{m.label}</h2>
                                        <p className="text-sm text-[#52677A] mt-1">{m.description}</p>
                                    </div>
                                </div>
                                <ChevronRight className="w-5 h-5 text-[#9AAAA5] group-hover:text-[#0F2A3D] transition-colors mt-2" />
                            </button>
                        );
                    })}
                </div>

            </div>
        </div>
    );
}
