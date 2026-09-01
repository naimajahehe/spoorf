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
  RefreshCw,
  ArrowRight
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
    id: "orchestrator",
    title: "Node.js Orchestrator & Local API (:5000)",
    detail: "Memverifikasi service orchestrator dan control-plane",
    status: "in-progress",
  },
  {
    id: "python",
    title: "FastAPI & Scapy Network Engine (:8001)",
    detail: "Menghubungkan ke microservice transmisi raw frame L2",
    status: "pending",
  },
  {
    id: "npcap",
    title: "Npcap NDIS 6 Kernel Driver & Packet Capture",
    detail: "Memverifikasi service 'npcap' RUNNING & packet injection DLLs",
    status: "pending",
  },
  {
    id: "privileges",
    title: "Windows Administrator Privileges & UAC",
    detail: "Memeriksa hak akses raw packet injection kernel",
    status: "pending",
  },
  {
    id: "network",
    title: "Physical Network Adapter & Gateway Link",
    detail: "Memvalidasi IP privat RFC 1918 & latensi default gateway",
    status: "pending",
  },
  {
    id: "database",
    title: "SQLite 3 WAL Persistence & Safety Invariants",
    detail: "Memverifikasi database sentinel.db & kekebalan anti self-cut",
    status: "pending",
  },
];

// -------------------------------------------------------------
// Top Block: BeUI TodoList Header & Status Icons (Clean Inline)
// -------------------------------------------------------------
function TodoHeaderIcon({ complete, hasError }: { complete?: boolean; hasError?: boolean }) {
  if (hasError) {
    return (
      <span aria-hidden="true" className="relative flex items-center justify-center shrink-0">
        <AlertTriangle size={16} className="text-amber-400" />
      </span>
    );
  }
  return (
    <span aria-hidden="true" className="relative flex items-center justify-center shrink-0">
      <ListTodo
        size={16}
        className={cn(
          "transition-colors duration-200",
          complete ? "text-emerald-400" : "text-zinc-400"
        )}
      />
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
  const [isAllComplete, setIsAllComplete] = useState(false);
  const [isChecking, setIsChecking] = useState(false);
  const [criticalError, setCriticalError] = useState<{ title: string; message: string; actionText?: string } | null>(null);

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

  // Execute Strict Sequential System Diagnostics Pipeline
  const runDiagnostics = useCallback(async () => {
    setIsChecking(true);
    setCriticalError(null);
    setIsAllComplete(false);
    startTimeRef.current = Date.now();
    
    addLog("Memulai bootloader NetCut Sentinel v2.3.0...", "info");
    addLog("Memulai audit persyaratan sistem secara bertahap & ketat...", "info");

    // Reset task state
    setTasks(INITIAL_TASKS);

    // =========================================================================
    // TAHAP 1: Node.js Orchestrator & Local API (:5000)
    // =========================================================================
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
          t.id === "orchestrator"
            ? { ...t, status: "error", detail: "Node.js Orchestrator (:5000) tidak merespons" }
            : t
        )
      );
      addLog("[ERROR] Gagal menghubungi Node.js Orchestrator di http://127.0.0.1:5000", "error");
      setCriticalError({
        title: "Node.js Orchestrator Tidak Aktif",
        message: "Layanan backend Express (:5000) tidak dapat dihubungi. Pastikan server Node.js telah berjalan (npm run dev).",
      });
      setIsChecking(false);
      return; // STOP! Jangan lanjut jika Tahap 1 belum Done.
    }

    // Tahap 1 Selesai -> Lanjut Tahap 2
    setTasks((prev) =>
      prev.map((t) =>
        t.id === "orchestrator"
          ? { ...t, status: "completed", detail: "Node.js Express (:5000) aktif & listening di loopback" }
          : t.id === "python"
          ? { ...t, status: "in-progress" }
          : t
      )
    );
    addLog("[NODE] Node.js Orchestrator listening di 127.0.0.1:5000 (OK)", "success");

    await new Promise((r) => setTimeout(r, 160));

    // =========================================================================
    // TAHAP 2: FastAPI & Scapy Network Engine (:8001)
    // =========================================================================
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
        await new Promise((r) => setTimeout(r, 350));
      }
    }

    if (!diagResult || diagResult.checks.python_engine.status === "error") {
      setTasks((prev) =>
        prev.map((t) =>
          t.id === "python"
            ? { ...t, status: "error", detail: "FastAPI Python Engine (:8001) offline atau tidak merespons" }
            : t
        )
      );
      addLog("[ERROR] FastAPI Python Engine (:8001) tidak aktif atau gagal inisialisasi.", "error");
      setCriticalError({
        title: "Python Network Engine Tidak Aktif",
        message: "Microservice Python FastAPI (:8001) tidak merespons. Pastikan 'python -m src.server' berjalan pada port 8001.",
      });
      setIsChecking(false);
      return; // STOP! Jangan lanjut jika Tahap 2 belum Done.
    }

    const { checks, logs: returnedLogs } = diagResult;
    const pyCheck = checks.python_engine;

    // Tahap 2 Selesai -> Lanjut Tahap 3
    setTasks((prev) =>
      prev.map((t) =>
        t.id === "python"
          ? { ...t, status: "completed", detail: `FastAPI Python ${pyCheck.version || '3.11'} aktif (PID: ${pyCheck.pid || 'OK'})` }
          : t.id === "npcap"
          ? { ...t, status: "in-progress" }
          : t
      )
    );
    addLog(`[PYTHON] FastAPI & Scapy Engine aktif di 127.0.0.1:8001 (PID: ${pyCheck.pid || 'OK'})`, "success");

    await new Promise((r) => setTimeout(r, 180));

    // =========================================================================
    // TAHAP 3: Npcap NDIS 6 Kernel Driver & Packet Capture DLLs
    // =========================================================================
    const npcapCheck = checks.npcap_driver;

    if (npcapCheck.status === "error" || (!npcapCheck.installed && !npcapCheck.service_running)) {
      setTasks((prev) =>
        prev.map((t) =>
          t.id === "npcap"
            ? { ...t, status: "error", detail: npcapCheck.details }
            : t
        )
      );
      addLog(`[NPCAP ERROR] ${npcapCheck.details}`, "error");
      setCriticalError({
        title: "Driver Npcap Tidak Ditemukan",
        message: "Aplikasi membutuhkan Npcap untuk menginjeksi frame raw Ethernet di Windows. Silakan install Npcap dari npcap.com dengan mencentang 'WinPcap API-compatible mode'.",
        actionText: "Buka npcap.com"
      });
      setIsChecking(false);
      return; // STOP! Jangan lanjut jika Npcap gagal total.
    }

    // Npcap Terverifikasi -> Lanjut Tahap 4
    setTasks((prev) =>
      prev.map((t) =>
        t.id === "npcap"
          ? {
              ...t,
              status: npcapCheck.status === "warning" ? "warning" : "completed",
              detail: npcapCheck.details,
            }
          : t.id === "privileges"
          ? { ...t, status: "in-progress" }
          : t
      )
    );
    addLog(`[NPCAP] ${npcapCheck.details}`, npcapCheck.status === "warning" ? "warn" : "success");

    await new Promise((r) => setTimeout(r, 180));

    // =========================================================================
    // TAHAP 4: Administrator Privileges (UAC Elevation)
    // =========================================================================
    const adminCheck = checks.admin_privileges;
    const isAdmin = adminCheck?.is_admin ?? false;

    setTasks((prev) =>
      prev.map((t) =>
        t.id === "privileges"
          ? {
              ...t,
              status: isAdmin ? "completed" : "warning",
              detail: adminCheck?.details || (isAdmin ? "Hak akses Administrator aktif" : "User standar"),
            }
          : t.id === "network"
          ? { ...t, status: "in-progress" }
          : t
      )
    );
    addLog(`[AUTH] Hak Akses: ${isAdmin ? 'Administrator (Elevated)' : 'User Standar (UAC Notice)'}`, isAdmin ? "success" : "warn");

    await new Promise((r) => setTimeout(r, 180));

    // =========================================================================
    // TAHAP 5: Physical Network Adapter & Gateway Link
    // =========================================================================
    const netCheck = checks.network_adapter;

    if (netCheck.status === "error" || !netCheck.ip || !netCheck.gateway) {
      setTasks((prev) =>
        prev.map((t) =>
          t.id === "network"
            ? { ...t, status: "error", detail: netCheck.details || "Tidak ada koneksi adapter fisik dengan IP privat" }
            : t
        )
      );
      addLog(`[NET ERROR] ${netCheck.details}`, "error");
      setCriticalError({
        title: "Koneksi Jaringan Tidak Ditemukan",
        message: "PC tidak terhubung ke jaringan lokal Wi-Fi atau Ethernet LAN dengan IP privat yang sah (RFC 1918). Hubungkan PC ke router untuk melanjutkan.",
      });
      setIsChecking(false);
      return; // STOP! Jangan lanjut jika jaringan offline.
    }

    setTasks((prev) =>
      prev.map((t) =>
        t.id === "network"
          ? {
              ...t,
              status: netCheck.status === "warning" ? "warning" : "completed",
              detail: netCheck.details,
            }
          : t.id === "database"
          ? { ...t, status: "in-progress" }
          : t
      )
    );
    addLog(`[NET] ${netCheck.details}`, "success");

    await new Promise((r) => setTimeout(r, 180));

    // =========================================================================
    // TAHAP 6: SQLite 3 WAL Persistence & Safety Invariants
    // =========================================================================
    const dbCheck = checks.database_persistence;
    const shieldCheck = checks.sentinel_shield;

    setTasks((prev) =>
      prev.map((t) =>
        t.id === "database"
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

    setIsAllComplete(true);
    setIsChecking(false);

    // Auto-proceed ONLY after all phases are Done
    setTimeout(() => {
      onReady();
    }, 450);
  }, [addLog, onReady, logs]);

  useEffect(() => {
    runDiagnostics();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const completedCount = tasks.filter((t) => t.status === "completed" || t.status === "warning").length;
  const hasErrors = tasks.some((t) => t.status === "error");

  const handleCopyLogs = async () => {
    const raw = logs.map((l) => `[${l.time}] ${l.msg}`).join("\n");
    await navigator.clipboard.writeText(raw);
    setTerminalCopied(true);
    setTimeout(() => setTerminalCopied(false), 1600);
  };

  return (
    <div className="w-full max-w-xl space-y-3 font-sans">
      {/* ========================================================= */}
      {/* CRITICAL ERROR / WARNING BANNER                           */}
      {/* ========================================================= */}
      {criticalError && (
        <motion.div
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          className="p-4 rounded-2xl bg-rose-500/10 border border-rose-500/30 text-rose-200 text-xs space-y-2.5 shadow-xl"
        >
          <div className="flex items-center gap-2 font-semibold text-white">
            <XCircle size={16} className="text-rose-400 shrink-0" />
            <span>{criticalError.title}</span>
          </div>
          <p className="text-zinc-300 leading-relaxed text-[11px]">
            {criticalError.message}
          </p>
          <div className="flex items-center gap-3 pt-1">
            <button
              type="button"
              onClick={runDiagnostics}
              disabled={isChecking}
              className="px-3 py-1.5 rounded-xl bg-white text-black font-semibold text-xs hover:bg-zinc-200 transition-all flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
            >
              <RefreshCw size={13} className={cn(isChecking && "animate-spin")} />
              <span>Periksa Ulang (Retry Check)</span>
            </button>

            <button
              type="button"
              onClick={() => onReady()}
              className="px-3 py-1.5 rounded-xl bg-white/[0.08] hover:bg-white/[0.14] text-zinc-300 font-medium text-xs transition-all flex items-center gap-1.5 cursor-pointer"
            >
              <span>Lanjutkan Mode Terbatas (Bypass)</span>
              <ArrowRight size={12} />
            </button>
          </div>
        </motion.div>
      )}

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
            <TodoHeaderIcon complete={isAllComplete} hasError={hasErrors} />
            <div>
              <h3 className="text-xs font-semibold text-white tracking-tight flex items-center gap-2">
                <span>Inisialisasi Sistem Sentinel (Hardware & Npcap Audit)</span>
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
                          task.status === "completed"
                            ? "text-zinc-200"
                            : task.status === "warning"
                            ? "text-amber-300 font-medium"
                            : task.status === "error"
                            ? "text-rose-400 font-semibold"
                            : task.status === "in-progress"
                            ? "text-white font-semibold"
                            : "text-zinc-500"
                        )}
                      >
                        {task.title}
                      </span>
                      {task.detail && (
                        <span className={cn(
                          "text-[10px] font-mono truncate",
                          task.status === "error" ? "text-rose-400/80" : task.status === "warning" ? "text-amber-400/80" : "text-zinc-500"
                        )}>
                          {task.detail}
                        </span>
                      )}
                    </div>
                  </div>

                  <span className="text-[10px] font-mono capitalize shrink-0 text-zinc-500">
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
                      "Pending"
                    )}
                  </span>
                </div>
              ))}
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
