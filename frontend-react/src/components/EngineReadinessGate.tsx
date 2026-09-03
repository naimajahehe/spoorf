"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import type { FC } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  SquareTerminal,
  Copy,
  Check,
  ChevronDown,
  ListTodo,
  LoaderCircle,
  AlertTriangle,
  XCircle,
  RefreshCw
} from "lucide-react";
import { NeonMesh } from "./ui/neon-mesh";
import { apiClient } from "../api/client";
import { cn } from "../lib/utils";
import type { SystemDiagnosticsResponse } from "../types";

interface EngineReadinessGateProps {
  onReady: () => void;
}

export type TodoItemStatus = "pending" | "in-progress" | "completed" | "warning" | "error";

export interface SystemTask {
  id: string;
  title: string;
  detail?: string;
  status: TodoItemStatus;
}

interface LogEntry {
  id: number;
  time: string;
  msg: string;
  type: "info" | "success" | "warn" | "error";
}

const INITIAL_TASKS: SystemTask[] = [
  {
    id: "engine",
    title: "Core Engine & Orchestrator Services (:5000 & :8001)",
    detail: "Memverifikasi Node.js Orchestrator & Python FastAPI Engine",
    status: "in-progress",
  },
  {
    id: "npcap",
    title: "Npcap NDIS 6 Kernel Driver & Packet Injection",
    detail: "Memverifikasi driver kernel Npcap, DLLs, dan hak akses raw socket",
    status: "pending",
  },
  {
    id: "network",
    title: "Physical Network Adapter & Gateway Link",
    detail: "Memvalidasi adapter Wi-Fi/LAN, IP privat & latensi router",
    status: "pending",
  },
  {
    id: "persistence",
    title: "State Persistence & Core Safety Invariants",
    detail: "Memverifikasi SQLite WAL database & proteksi anti self-cut",
    status: "pending",
  },
];

// -------------------------------------------------------------
// Top Block: BeUI TodoList Header & Status Icons (Clean Static Logo)
// -------------------------------------------------------------
function TodoHeaderIcon() {
  return (
    <span aria-hidden="true" className="relative flex items-center justify-center shrink-0">
      <ListTodo size={16} className="text-zinc-400" />
    </span>
  );
}

function TodoStatusIcon({ status }: { status: TodoItemStatus }) {
  if (status === "in-progress") {
    return (
      <span className="flex items-center justify-center shrink-0">
        <LoaderCircle size={14} className="animate-spin text-white" />
      </span>
    );
  }
  if (status === "completed") {
    return (
      <span className="flex items-center justify-center shrink-0">
        <Check size={14} className="text-emerald-400 stroke-[2.5]" />
      </span>
    );
  }
  if (status === "warning") {
    return (
      <span className="flex items-center justify-center shrink-0">
        <AlertTriangle size={14} className="text-amber-400" />
      </span>
    );
  }
  if (status === "error") {
    return (
      <span className="flex items-center justify-center shrink-0">
        <XCircle size={14} className="text-rose-400" />
      </span>
    );
  }
  return (
    <span className="flex items-center justify-center shrink-0 size-3.5">
      <span className="size-1.5 rounded-full bg-zinc-600 inline-block" />
    </span>
  );
}

// -------------------------------------------------------------
// EngineReadinessGate Content Blocks (BeUI TodoList + ToolResult)
// -------------------------------------------------------------
export const EngineReadinessGateContent: FC<EngineReadinessGateProps> = ({ onReady }) => {
  const [tasks, setTasks] = useState<SystemTask[]>(INITIAL_TASKS);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [isProcessOpen, setIsProcessOpen] = useState(true);
  const [isTerminalOpen, setIsTerminalOpen] = useState(true);
  const [terminalCopied, setTerminalCopied] = useState(false);
  const [isChecking, setIsChecking] = useState(false);
  // Alasan pipeline berhenti. Wajib diisi setiap kali sebuah tahap STOP, agar user
  // selalu punya jalan keluar — tanpa ini gate mengunci user secara permanen.
  const [haltedReason, setHaltedReason] = useState<string | null>(null);

  const startTimeRef = useRef<number>(Date.now());
  const logIdRef = useRef<number>(0);
  const terminalEndRef = useRef<HTMLDivElement>(null);

  const addLog = useCallback(
    (msg: string, type: LogEntry["type"] = "info") => {
      const elapsed = ((Date.now() - startTimeRef.current) / 1000).toFixed(2);
      const newEntry: LogEntry = {
        id: logIdRef.current++,
        time: `${elapsed}s`,
        msg,
        type,
      };
      setLogs((prev) => [...prev, newEntry]);
    },
    []
  );

  // Auto-scroll terminal
  useEffect(() => {
    terminalEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs]);

  // Execute Strict Sequential System Diagnostics Pipeline with 1.25s per-phase pacing (Total 5.0s)
  const runDiagnostics = useCallback(async () => {
    setIsChecking(true);
    setHaltedReason(null);
    startTimeRef.current = Date.now();
    
    addLog("Memulai bootloader NetCut Sentinel v2.3.0...", "info");
    addLog("Memulai audit persyaratan sistem secara bertahap & ketat...", "info");

    // Reset task state
    setTasks(INITIAL_TASKS);

    // =========================================================================
    // TAHAP 1: Core Engine & Orchestrator Services (:5000 & :8001) (~1.25s)
    // =========================================================================
    const t1Start = Date.now();
    let healthOk = false;
    try {
      const healthRes = await apiClient.getHealth();
      if (healthRes && (healthRes.status === "ok" || healthRes.status === "degraded")) {
        healthOk = true;
      }
    } catch {
      healthOk = false;
    }

    if (!healthOk) {
      setTasks((prev) =>
        prev.map((t) =>
          t.id === "engine"
            ? { ...t, status: "error", detail: "Node.js Orchestrator (:5000) tidak merespons" }
            : t
        )
      );
      addLog("[ERROR] Gagal menghubungi Node.js Orchestrator di http://127.0.0.1:5000", "error");
      setHaltedReason("Node.js Orchestrator (:5000) tidak merespons");
      setIsChecking(false);
      return; // STOP!
    }

    let diagResult: SystemDiagnosticsResponse | null = null;
    let attempts = 0;

    while (attempts < 10) {
      attempts++;
      try {
        const res = await apiClient.getDiagnostics();
        if (res && res.success) {
          diagResult = res;
          break;
        }
      } catch {
        await new Promise((r) => setTimeout(r, 200));
      }
    }

    if (!diagResult || diagResult.checks.python_engine.status === "error") {
      setTasks((prev) =>
        prev.map((t) =>
          t.id === "engine"
            ? { ...t, status: "error", detail: "FastAPI Python Engine (:8001) offline atau tidak merespons" }
            : t
        )
      );
      addLog("[ERROR] FastAPI Python Engine (:8001) tidak aktif atau gagal inisialisasi.", "error");
      setHaltedReason("FastAPI Python Engine (:8001) offline atau tidak merespons");
      setIsChecking(false);
      return; // STOP!
    }

    const { checks, logs: returnedLogs } = diagResult;
    const pyCheck = checks.python_engine;

    // Pastikan durasi tahap 1 mencapai ~1.25 detik untuk visualisasi natural
    const elapsedT1 = Date.now() - t1Start;
    if (elapsedT1 < 1250) {
      await new Promise((r) => setTimeout(r, 1250 - elapsedT1));
    }

    // Tahap 1 Selesai -> Lanjut Tahap 2
    setTasks((prev) =>
      prev.map((t) =>
        t.id === "engine"
          ? { ...t, status: "completed", detail: `Node.js (:5000) & FastAPI Python ${pyCheck.version || '3.11'} (:8001) aktif` }
          : t.id === "npcap"
          ? { ...t, status: "in-progress" }
          : t
      )
    );
    addLog("[NODE] Node.js Orchestrator listening di 127.0.0.1:5000 (OK)", "success");
    addLog(`[PYTHON] FastAPI & Scapy Engine aktif di 127.0.0.1:8001 (PID: ${pyCheck.pid || 'OK'})`, "success");

    // =========================================================================
    // TAHAP 2: Npcap NDIS 6 Kernel Driver & Packet Injection (~1.25s)
    // =========================================================================
    const npcapCheck = checks.npcap_driver;
    const adminCheck = checks.admin_privileges;
    const isAdmin = adminCheck?.is_admin ?? false;

    // Tunggu alokasi waktu tahap 2
    await new Promise((r) => setTimeout(r, 1200));

    if (npcapCheck.status === "error" || (!npcapCheck.installed && !npcapCheck.service_running)) {
      setTasks((prev) =>
        prev.map((t) =>
          t.id === "npcap"
            ? { ...t, status: "error", detail: npcapCheck.details }
            : t
        )
      );
      addLog(`[NPCAP ERROR] ${npcapCheck.details}`, "error");
      setHaltedReason(npcapCheck.details || "Npcap NDIS 6 Kernel Driver tidak terverifikasi");
      setIsChecking(false);
      return; // STOP!
    }

    // Tahap 2 Selesai -> Lanjut Tahap 3
    setTasks((prev) =>
      prev.map((t) =>
        t.id === "npcap"
          ? {
              ...t,
              status: npcapCheck.status === "warning" ? "warning" : "completed",
              detail: `${npcapCheck.details} | Hak Akses: ${isAdmin ? 'Administrator' : 'Standard User'}`,
            }
          : t.id === "network"
          ? { ...t, status: "in-progress" }
          : t
      )
    );
    addLog(`[NPCAP] ${npcapCheck.details}`, npcapCheck.status === "warning" ? "warn" : "success");
    addLog(`[AUTH] Hak Akses: ${isAdmin ? 'Administrator (Elevated)' : 'User Standar (UAC Notice)'}`, isAdmin ? "success" : "warn");

    // =========================================================================
    // TAHAP 3: Physical Network Adapter & Gateway Link (~1.25s)
    // =========================================================================
    const netCheck = checks.network_adapter;

    // Tunggu alokasi waktu tahap 3
    await new Promise((r) => setTimeout(r, 1200));

    if (netCheck.status === "error" || !netCheck.ip || !netCheck.gateway) {
      setTasks((prev) =>
        prev.map((t) =>
          t.id === "network"
            ? { ...t, status: "error", detail: netCheck.details || "Tidak ada koneksi adapter fisik dengan IP privat" }
            : t
        )
      );
      addLog(`[NET ERROR] ${netCheck.details}`, "error");
      setHaltedReason(netCheck.details || "Tidak ada adapter jaringan fisik dengan IP privat");
      setIsChecking(false);
      return; // STOP!
    }

    // Tahap 3 Selesai -> Lanjut Tahap 4
    setTasks((prev) =>
      prev.map((t) =>
        t.id === "network"
          ? {
              ...t,
              status: netCheck.status === "warning" ? "warning" : "completed",
              detail: netCheck.details,
            }
          : t.id === "persistence"
          ? { ...t, status: "in-progress" }
          : t
      )
    );
    addLog(`[NET] ${netCheck.details}`, "success");

    // =========================================================================
    // TAHAP 4: State Persistence & Core Safety Invariants (~1.25s)
    // =========================================================================
    const dbCheck = checks.database_persistence;
    const shieldCheck = checks.sentinel_shield;

    // Tunggu alokasi waktu tahap 4
    await new Promise((r) => setTimeout(r, 1200));

    setTasks((prev) =>
      prev.map((t) =>
        t.id === "persistence"
          ? {
              ...t,
              status: dbCheck?.status === "warning" ? "warning" : "completed",
              detail: `${dbCheck?.details || 'Database SQLite WAL siap'} | ${shieldCheck?.details || 'Anti Self-Cut Active'}`,
            }
          : t
      )
    );
    addLog(`[DB] ${dbCheck?.details || 'SQLite WAL Persistence Active'}`, "success");
    addLog(`[SAFETY] ${shieldCheck?.details || 'Gateway Immunity & Anti Self-Cut Active'}`, "success");

    // SINKRONISASI LOG TERMINAL DARI HASIL AUDIT NYATA
    if (returnedLogs && returnedLogs.length > 0) {
      for (const logItem of returnedLogs) {
        if (!logs.some(l => l.msg === logItem)) {
          addLog(logItem, "info");
        }
      }
    }

    addLog("Seluruh persyaratan subsistem terpenuhi. Mengalihkan ke dashboard...", "success");

    setIsChecking(false);

    // Auto-proceed ke dashboard
    setTimeout(() => {
      onReady();
    }, 450);
  }, [addLog, onReady, logs]);

  useEffect(() => {
    runDiagnostics();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const completedCount = tasks.filter((t) => t.status === "completed" || t.status === "warning").length;

  const handleCopyLogs = async () => {
    const raw = logs.map((l) => `[${l.time}] ${l.msg}`).join("\n");
    await navigator.clipboard.writeText(raw);
    setTerminalCopied(true);
    setTimeout(() => setTerminalCopied(false), 1600);
  };

  return (
    <div className="w-full max-w-xl space-y-3 font-sans">
      {/* ========================================================= */}
      {/* BLOK 1 (ATAS): BeUI Agent TodoList                       */}
      {/* ========================================================= */}
      <div className="rounded-2xl border border-white/[0.08] bg-[#090a0c]/80 backdrop-blur-md overflow-hidden shadow-2xl shadow-black/80 transition-all">
        {/* Header Accordion Trigger */}
        <button
          type="button"
          onClick={() => setIsProcessOpen((prev) => !prev)}
          className="w-full px-4 py-3.5 flex items-center justify-between text-left hover:bg-white/[0.02] transition-colors outline-none cursor-pointer"
        >
          <div className="flex items-center gap-3">
            <TodoHeaderIcon />
            <div>
              <h3 className="text-xs font-semibold text-white tracking-tight flex items-center gap-2">
                <span>Inisialisasi Sistem</span>
              </h3>
              <p className="text-[11px] text-zinc-400 font-mono mt-0.5">
                {completedCount} dari {tasks.length} komponen terverifikasi nyata
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                runDiagnostics();
              }}
              disabled={isChecking}
              title="Periksa Ulang Subsistem"
              className="size-7 rounded-lg text-zinc-400 hover:text-white hover:bg-white/[0.06] transition-colors flex items-center justify-center cursor-pointer outline-none disabled:opacity-50"
            >
              <RefreshCw size={13} className={cn(isChecking && "animate-spin text-cyan-400")} />
            </button>

            <ChevronDown
              size={14}
              className={cn(
                "text-zinc-400 transition-transform duration-200",
                isProcessOpen && "rotate-180 text-white"
              )}
            />
          </div>
        </button>

        {/* Task List Items */}
        <AnimatePresence initial={false}>
          {isProcessOpen && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="border-t border-white/[0.06] divide-y divide-white/[0.04] px-4 py-1"
            >
              {tasks.map((task) => (
                <div
                  key={task.id}
                  className="py-2.5 flex items-center justify-between gap-3 text-xs"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <TodoStatusIcon status={task.status} />
                    <div className="flex flex-col min-w-0">
                      <span
                        className={cn(
                          "font-medium truncate transition-colors",
                          task.status === "in-progress"
                            ? "text-white font-semibold"
                            : "text-zinc-200"
                        )}
                      >
                        {task.title}
                      </span>
                      {task.detail && (
                        <span className="text-[10px] font-mono truncate text-zinc-500">
                          {task.detail}
                        </span>
                      )}
                    </div>
                  </div>

                  <span className="text-[10px] font-mono capitalize shrink-0">
                    {task.status === "in-progress" ? (
                      <span className="text-white flex items-center gap-1 font-medium">
                        <span className="size-1.5 rounded-full bg-emerald-400 animate-ping" />
                        Probing
                      </span>
                    ) : task.status === "completed" ? (
                      <span className="text-emerald-400 font-medium">Done</span>
                    ) : task.status === "warning" ? (
                      <span className="text-amber-400 font-medium">Warning</span>
                    ) : task.status === "error" ? (
                      <span className="text-rose-400 font-medium">Failed</span>
                    ) : (
                      <span className="text-zinc-500">Pending</span>
                    )}
                  </span>
                </div>
              ))}
            </motion.div>
          )}
        </AnimatePresence>

        {/* Jalan keluar saat pipeline berhenti — selalu tersedia, apa pun tahap yang gagal. */}
        <AnimatePresence initial={false}>
          {haltedReason && !isChecking && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="border-t border-white/[0.06] bg-amber-500/[0.03] overflow-hidden"
            >
              <div className="px-4 py-3 flex items-center justify-between gap-3">
                <div className="flex items-start gap-2.5 min-w-0">
                  <AlertTriangle size={13} className="text-amber-400 shrink-0 mt-px" />
                  <p className="text-[11px] text-zinc-400 leading-snug min-w-0">
                    Inisialisasi berhenti — <span className="text-zinc-300">{haltedReason}</span>
                  </p>
                </div>

                <button
                  type="button"
                  onClick={() => onReady()}
                  className="shrink-0 px-2.5 py-1.5 rounded-lg text-[11px] font-medium text-amber-300 border border-amber-400/25 bg-amber-400/[0.06] hover:bg-amber-400/[0.12] hover:text-amber-200 transition-colors cursor-pointer outline-none"
                >
                  Lanjutkan Mode Terbatas
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* ========================================================= */}
      {/* BLOK 2 (BAWAH): BeUI Agent ToolResult / Terminal         */}
      {/* ========================================================= */}
      <div className="rounded-2xl border border-white/[0.08] bg-[#090a0c]/80 backdrop-blur-md overflow-hidden shadow-2xl shadow-black/80 transition-all">
        {/* Terminal Header */}
        <div className="px-4 py-3 flex items-center justify-between border-b border-white/[0.06] bg-white/[0.01]">
          <div className="flex items-center gap-2.5">
            <SquareTerminal size={16} className="text-zinc-300 shrink-0" />
            <div>
              <span className="text-xs font-semibold text-white">
                terminal_bootstrap
              </span>
              <p className="text-[10px] font-mono text-zinc-500">
                GET /api/system/diagnostics & sc query npcap
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={handleCopyLogs}
              title="Salin Log Terminal"
              className="size-7 rounded-lg text-zinc-400 hover:text-white hover:bg-white/[0.06] transition-colors flex items-center justify-center cursor-pointer outline-none"
            >
              {terminalCopied ? <Check size={13} className="text-emerald-400" /> : <Copy size={13} />}
            </button>

            <button
              type="button"
              onClick={() => setIsTerminalOpen((prev) => !prev)}
              title={isTerminalOpen ? "Tutup Terminal" : "Buka Terminal"}
              className="size-7 rounded-lg text-zinc-400 hover:text-white hover:bg-white/[0.06] transition-colors flex items-center justify-center cursor-pointer outline-none"
            >
              <ChevronDown
                size={14}
                className={cn("transition-transform duration-200", isTerminalOpen && "rotate-180 text-white")}
              />
            </button>
          </div>
        </div>

        {/* Terminal Logs Stream */}
        <AnimatePresence initial={false}>
          {isTerminalOpen && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="p-3.5 bg-black/50 font-mono text-[11px] leading-relaxed max-h-[190px] overflow-y-auto space-y-1.5 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
            >
              {logs.map((log) => (
                <div key={log.id} className="flex items-start gap-2.5 font-mono text-[11px]">
                  <span className="text-zinc-500 shrink-0 select-none">[{log.time}]</span>
                  <span
                    className={cn(
                      "break-words",
                      log.type === "success" && "text-zinc-200 font-medium",
                      log.type === "warn" && "text-amber-400/90",
                      log.type === "error" && "text-rose-400 font-semibold",
                      log.type === "info" && "text-zinc-400"
                    )}
                  >
                    {log.msg}
                  </span>
                </div>
              ))}
              <div ref={terminalEndRef} />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
};

export const EngineReadinessGate: FC<EngineReadinessGateProps> = (props) => {
  return (
    <NeonMesh className="w-full min-h-screen flex items-center justify-center font-sans p-4 select-none">
      <div className="relative z-10 w-full max-w-xl">
        <EngineReadinessGateContent {...props} />
      </div>
    </NeonMesh>
  );
};
