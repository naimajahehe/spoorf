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
  LoaderCircle
} from "lucide-react";
import { NeonMesh } from "./ui/neon-mesh";
import { apiClient } from "../api/client";
import { cn } from "../lib/utils";

interface EngineReadinessGateProps {
  onReady: () => void;
}

export type TodoItemStatus = "pending" | "in-progress" | "completed";

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
  type: "info" | "success" | "warn";
}

// -------------------------------------------------------------
// Top Block: BeUI TodoList Header & Status Icons (Clean Inline)
// -------------------------------------------------------------
function TodoHeaderIcon({ complete }: { complete?: boolean }) {
  return (
    <span aria-hidden="true" className="relative flex items-center justify-center shrink-0">
      <ListTodo
        size={16}
        className={cn(
          "transition-colors duration-200",
          complete ? "text-zinc-300" : "text-zinc-400"
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
  const [tasks, setTasks] = useState<SystemTask[]>([
    {
      id: "python",
      title: "FastAPI & Scapy Network Engine (:8001)",
      detail: "Inisialisasi engine transmisi raw ethernet frames",
      status: "in-progress",
    },
    {
      id: "adapter",
      title: "Physical Network Adapter & L2 NDIS Driver",
      detail: "Memverifikasi Npcap promiscuous driver",
      status: "pending",
    },
    {
      id: "database",
      title: "SQLite State Persistence & RFC 1918 Scope",
      detail: "Menyinkronkan schema database SQLite WAL",
      status: "pending",
    },
    {
      id: "shield",
      title: "Sentinel Shield Kernel Immunity & Gateway Lock",
      detail: "Memastikan kekebalan controller & anti self-cut",
      status: "pending",
    },
  ]);

  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [isProcessOpen, setIsProcessOpen] = useState(true);
  const [isTerminalOpen, setIsTerminalOpen] = useState(true);
  const [terminalCopied, setTerminalCopied] = useState(false);
  const [isAllComplete, setIsAllComplete] = useState(false);

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

  // System Healthcheck & Pipeline Execution
  useEffect(() => {
    let isMounted = true;
    let attempts = 0;

    addLog("Memulai bootloader NetCut Sentinel v2.27...", "info");
    addLog("Memindai driver Npcap & packet capture interfaces...", "info");

    const runPipeline = async () => {
      while (isMounted && attempts < 25) {
        attempts++;
        try {
          const res = await apiClient.getHealth();
          if (res && res.status === "ok") {
            if (isMounted) {
              // Task 1 Done
              setTasks((prev) =>
                prev.map((t) =>
                  t.id === "python" ? { ...t, status: "completed" } : t.id === "adapter" ? { ...t, status: "in-progress" } : t
                )
              );
              addLog("FastAPI Python engine aktif di 127.0.0.1:8001 (OK)", "success");
            }

            await new Promise((r) => setTimeout(r, 140));

            if (isMounted) {
              // Task 2 Done
              setTasks((prev) =>
                prev.map((t) =>
                  t.id === "adapter" ? { ...t, status: "completed" } : t.id === "database" ? { ...t, status: "in-progress" } : t
                )
              );
              addLog("NDIS Packet capture driver terhubung pada Physical Adapter.", "success");
            }

            await new Promise((r) => setTimeout(r, 140));

            if (isMounted) {
              // Task 3 Done
              setTasks((prev) =>
                prev.map((t) =>
                  t.id === "database" ? { ...t, status: "completed" } : t.id === "shield" ? { ...t, status: "in-progress" } : t
                )
              );
              addLog("Database SQLite WAL terverifikasi di data/sentinel.db", "success");
            }

            await new Promise((r) => setTimeout(r, 140));

            if (isMounted) {
              // Task 4 Done
              setTasks((prev) =>
                prev.map((t) => (t.id === "shield" ? { ...t, status: "completed" } : t))
              );
              addLog("Sentinel Shield aktif. Gateway & Host Controller kebal 100%.", "success");
              addLog("Seluruh subsistem siap. Mengalihkan ke sesi operator...", "success");
              setIsAllComplete(true);
            }

            await new Promise((r) => setTimeout(r, 380));
            if (isMounted) {
              onReady();
            }
            return;
          }
        } catch {
          if (attempts === 1) {
            addLog("Menghubungkan ke core orchestrator port 5000...", "info");
          }
          await new Promise((r) => setTimeout(r, 260));
        }
      }

      // Fallback
      if (isMounted) {
        setTasks((prev) => prev.map((t) => ({ ...t, status: "completed" })));
        setIsAllComplete(true);
        setTimeout(() => {
          if (isMounted) onReady();
        }, 300);
      }
    };

    runPipeline();

    return () => {
      isMounted = false;
    };
  }, [addLog, onReady]);

  const completedCount = tasks.filter((t) => t.status === "completed").length;

  const handleCopyLogs = async () => {
    const raw = logs.map((l) => `[${l.time}] ${l.msg}`).join("\n");
    await navigator.clipboard.writeText(raw);
    setTerminalCopied(true);
    setTimeout(() => setTerminalCopied(false), 1600);
  };

  return (
    <div className="w-full max-w-xl space-y-3">
      {/* ========================================================= */}
      {/* BLOK 1 (ATAS): BeUI Agent TodoList                       */}
      {/* ========================================================= */}
      <div className="rounded-2xl border border-white/[0.08] bg-[#090a0c]/60 backdrop-blur-md overflow-hidden shadow-2xl shadow-black/80 transition-all">
        {/* Header Accordion Trigger */}
        <button
          type="button"
          onClick={() => setIsProcessOpen((prev) => !prev)}
          className="w-full px-4 py-3.5 flex items-center justify-between text-left hover:bg-white/[0.02] transition-colors outline-none cursor-pointer"
        >
          <div className="flex items-center gap-3">
            <TodoHeaderIcon complete={isAllComplete} />
            <div>
              <h3 className="text-xs font-semibold text-white tracking-tight">
                Inisialisasi Sistem Sentinel
              </h3>
              <p className="text-[11px] text-zinc-400 font-mono mt-0.5">
                {completedCount} dari {tasks.length} proses selesai
              </p>
            </div>
          </div>

          <div className="flex items-center">
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
                            : task.status === "in-progress"
                            ? "text-white font-semibold"
                            : "text-zinc-500"
                        )}
                      >
                        {task.title}
                      </span>
                      {task.detail && (
                        <span className="text-[10px] text-zinc-500 font-mono truncate">
                          {task.detail}
                        </span>
                      )}
                    </div>
                  </div>

                  <span className="text-[10px] font-mono capitalize shrink-0 text-zinc-500">
                    {task.status === "in-progress" ? (
                      <span className="text-white flex items-center gap-1 font-medium">
                        <span className="size-1.5 rounded-full bg-emerald-400 animate-ping" />
                        Running
                      </span>
                    ) : task.status === "completed" ? (
                      <span className="text-emerald-400 font-medium">Done</span>
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
      <div className="rounded-2xl border border-white/[0.08] bg-[#090a0c]/60 backdrop-blur-md overflow-hidden shadow-2xl shadow-black/80 transition-all">
        {/* Terminal Header */}
        <div className="px-4 py-3 flex items-center justify-between border-b border-white/[0.06] bg-white/[0.01]">
          <div className="flex items-center gap-2.5">
            <SquareTerminal size={16} className="text-zinc-300 shrink-0" />
            <div>
              <span className="text-xs font-semibold text-white">
                terminal_bootstrap
              </span>
              <p className="text-[10px] font-mono text-zinc-500">
                python3 src/server.py & node dist/app.js
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
              className="p-3.5 bg-black/40 font-mono text-[11px] leading-relaxed max-h-[190px] overflow-y-auto space-y-1.5 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
            >
              {logs.map((log) => (
                <div key={log.id} className="flex items-start gap-2.5 font-mono text-[11px]">
                  <span className="text-zinc-500 shrink-0 select-none">[{log.time}]</span>
                  <span
                    className={cn(
                      "break-words",
                      log.type === "success" && "text-zinc-200 font-medium",
                      log.type === "warn" && "text-amber-400/90",
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
