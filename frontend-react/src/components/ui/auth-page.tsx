"use client";

import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import {
  Eye,
  EyeOff,
  X,
  KeyRound,
  Mail,
  Lock,
  User,
  ShieldCheck,
  AlertCircle,
  CheckCircle2,
  Loader2,
  Sparkles,
  Check
} from "lucide-react";
import { AuthStatusResponse } from "../../types";

const Logo = () => (
  <svg
    fill="currentColor"
    height="36"
    viewBox="0 0 40 48"
    width="30"
    className="text-white shrink-0"
  >
    <clipPath id="a">
      <path d="m0 0h40v48h-40z" />
    </clipPath>
    <g clipPath="url(#a)">
      <path d="m25.0887 5.05386-3.933-1.05386-3.3145 12.3696-2.9923-11.16736-3.9331 1.05386 3.233 12.0655-8.05262-8.0526-2.87919 2.8792 8.83271 8.8328-10.99975-2.9474-1.05385625 3.933 12.01860625 3.2204c-.1376-.5935-.2104-1.2119-.2104-1.8473 0-4.4976 3.646-8.1436 8.1437-8.1436 4.4976 0 8.1436 3.646 8.1436 8.1436 0 .6313-.0719 1.2459-.2078 1.8359l10.9227 2.9267 1.0538-3.933-12.0664-3.2332 11.0005-2.9476-1.0539-3.933-12.0659 3.233 8.0526-8.0526-2.8792-2.87916-8.7102 8.71026z" />
      <path d="m27.8723 26.2214c-.3372 1.4256-1.0491 2.7063-2.0259 3.7324l7.913 7.9131 2.8792-2.8792z" />
      <path d="m25.7665 30.0366c-.9886 1.0097-2.2379 1.7632-3.6389 2.1515l2.8794 10.746 3.933-1.0539z" />
      <path d="m21.9807 32.2274c-.65.1671-1.3313.2559-2.0334.2559-.7522 0-1.4806-.102-2.1721-.2929l-2.882 10.7558 3.933 1.0538z" />
      <path d="m17.6361 32.1507c-1.3796-.4076-2.6067-1.1707-3.5751-2.1833l-7.9325 7.9325 2.87919 2.8792z" />
      <path d="m13.9956 29.8973c-.9518-1.019-1.6451-2.2826-1.9751-3.6862l-10.95836 2.9363 1.05385 3.933z" />
    </g>
  </svg>
);

interface AuthPageProps {
  authStatus?: AuthStatusResponse | null;
  onLogin: (email: string, password?: string, token?: string, cloudUrl?: string) => Promise<any>;
  onActivateKey: (key: string) => Promise<any>;
  onClose?: () => void;
  isModal?: boolean;
}

export const AuthPage: React.FC<AuthPageProps> = ({
  authStatus,
  onLogin,
  onActivateKey,
  onClose,
  isModal = true,
}) => {
  const [authMode, setAuthMode] = useState<"signin" | "license" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [licenseKey, setLicenseKey] = useState("");
  const [rememberMachine, setRememberMachine] = useState(true);
  const [agreeTerms, setAgreeTerms] = useState(true);
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    setSuccessMessage(null);
    setIsLoading(true);

    try {
      if (authMode === "license") {
        if (!licenseKey.trim()) {
          setErrorMessage("Silakan masukkan kode lisensi PRO Anda.");
          setIsLoading(false);
          return;
        }
        await onActivateKey(licenseKey.trim());
        setSuccessMessage("Lisensi PRO berhasil diaktivasi!");
        setTimeout(() => onClose?.(), 600);
      } else {
        if (!email.trim()) {
          setErrorMessage("Silakan masukkan alamat email.");
          setIsLoading(false);
          return;
        }
        if (!password.trim()) {
          setErrorMessage("Silakan masukkan kata sandi.");
          setIsLoading(false);
          return;
        }
        await onLogin(email.trim(), password);
        setSuccessMessage(
          authMode === "signup"
            ? "Akun berhasil dibuat & sesi PRO aktif!"
            : "Login berhasil! Sesi PRO dibuka."
        );
        setTimeout(() => onClose?.(), 600);
      }
    } catch (err: any) {
      setErrorMessage(
        err?.response?.data?.message ||
          err?.message ||
          "Gagal memproses autentikasi. Periksa kredensial Anda."
      );
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="relative flex items-center justify-center w-full bg-transparent text-white p-4 sm:p-6 overflow-hidden select-none">
      {/* Modal Close Button */}
      {isModal && onClose && (
        <button
          type="button"
          onClick={onClose}
          className="absolute top-2 right-2 size-8 rounded-full bg-white/[0.04] hover:bg-white/[0.1] border border-white/[0.08] text-zinc-400 hover:text-white flex items-center justify-center transition-colors cursor-pointer z-20"
        >
          <X size={15} />
        </button>
      )}

      <div className="flex flex-1 flex-col justify-center w-full max-w-sm">
        <div className="sm:mx-auto sm:w-full sm:max-w-md">
          {/* Header Brand */}
          <div className="flex items-center space-x-2">
            <Logo />
            <p className="font-bold text-lg text-white tracking-tight">
              Sentinel
            </p>
          </div>

          <h3 className="mt-5 text-xl font-bold text-white tracking-tight">
            {authMode === "signin"
              ? "Sign in to your account"
              : authMode === "license"
              ? "Activate license key"
              : "Create an account"}
          </h3>

          <p className="mt-1.5 text-xs text-zinc-400">
            {authMode === "signin" ? (
              <>
                Belum memiliki akun?{" "}
                <button
                  type="button"
                  onClick={() => {
                    setAuthMode("signup");
                    setErrorMessage(null);
                  }}
                  className="font-medium text-zinc-200 hover:text-white underline underline-offset-4 cursor-pointer"
                >
                  Daftar gratis
                </button>
              </>
            ) : authMode === "license" ? (
              <>
                Ingin masuk dengan akun cloud?{" "}
                <button
                  type="button"
                  onClick={() => {
                    setAuthMode("signin");
                    setErrorMessage(null);
                  }}
                  className="font-medium text-zinc-200 hover:text-white underline underline-offset-4 cursor-pointer"
                >
                  Sign in email
                </button>
              </>
            ) : (
              <>
                Sudah memiliki akun?{" "}
                <button
                  type="button"
                  onClick={() => {
                    setAuthMode("signin");
                    setErrorMessage(null);
                  }}
                  className="font-medium text-zinc-200 hover:text-white underline underline-offset-4 cursor-pointer"
                >
                  Sign in
                </button>
              </>
            )}
          </p>

          {/* Quick Dual Shortcut Switcher */}
          <div className="mt-5 grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => {
                setAuthMode("signin");
                setErrorMessage(null);
              }}
              className={`h-9 text-xs font-medium rounded-xl border flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
                authMode === "signin" || authMode === "signup"
                  ? "bg-white/[0.08] border-white/[0.2] text-white"
                  : "bg-white/[0.02] border-white/[0.06] text-zinc-400 hover:text-zinc-200 hover:bg-white/[0.04]"
              }`}
            >
              <Mail size={13} className="shrink-0" />
              <span>Cloud Account</span>
            </button>

            <button
              type="button"
              onClick={() => {
                setAuthMode("license");
                setErrorMessage(null);
              }}
              className={`h-9 text-xs font-medium rounded-xl border flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
                authMode === "license"
                  ? "bg-white/[0.1] border-white/[0.25] text-white"
                  : "bg-white/[0.02] border-white/[0.06] text-zinc-400 hover:text-zinc-200 hover:bg-white/[0.04]"
              }`}
            >
              <KeyRound size={13} className="shrink-0" />
              <span>License Key</span>
            </button>
          </div>

          {/* Feedback Alert */}
          {errorMessage && (
            <div className="mt-4 p-3 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-300 text-xs flex items-center gap-2">
              <AlertCircle size={15} className="shrink-0 text-rose-400" />
              <span>{errorMessage}</span>
            </div>
          )}

          {successMessage && (
            <div className="mt-4 p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 text-xs flex items-center gap-2">
              <CheckCircle2 size={15} className="shrink-0 text-emerald-400" />
              <span>{successMessage}</span>
            </div>
          )}

          {/* Form */}
          <form onSubmit={handleSubmit} className="mt-5 space-y-4">
            {authMode === "signup" && (
              <div className="space-y-1.5">
                <Label htmlFor="fullname-input" className="text-xs font-medium text-zinc-300 flex items-center gap-1.5">
                  <User size={13} className="text-zinc-400" />
                  Nama Lengkap
                </Label>
                <Input
                  id="fullname-input"
                  type="text"
                  placeholder="Budi Pratama"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  className="bg-white/[0.04] border-white/[0.1] text-white placeholder:text-zinc-500 h-10"
                />
              </div>
            )}

            {authMode !== "license" ? (
              <>
                <div className="space-y-1.5">
                  <Label htmlFor="email-input" className="text-xs font-medium text-zinc-300 flex items-center gap-1.5">
                    <Mail size={13} className="text-zinc-400" />
                    Email
                  </Label>
                  <Input
                    id="email-input"
                    type="email"
                    placeholder="user@spoorf.app"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    className="bg-white/[0.04] border-white/[0.1] text-white placeholder:text-zinc-500 h-10"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="password-input" className="text-xs font-medium text-zinc-300 flex items-center gap-1.5">
                    <Lock size={13} className="text-zinc-400" />
                    Password
                  </Label>
                  <div className="relative">
                    <Input
                      id="password-input"
                      type={showPassword ? "text" : "password"}
                      placeholder="••••••••"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      required
                      className="pr-10 bg-white/[0.04] border-white/[0.1] text-white placeholder:text-zinc-500 h-10"
                    />
                    <button
                      type="button"
                      className="absolute right-0 top-0 h-full px-3 text-zinc-400 hover:text-white flex items-center justify-center cursor-pointer outline-none"
                      onClick={() => setShowPassword(!showPassword)}
                    >
                      {showPassword ? (
                        <EyeOff size={15} />
                      ) : (
                        <Eye size={15} />
                      )}
                    </button>
                  </div>
                </div>

                {authMode === "signin" ? (
                  <div className="flex items-center justify-between pt-1">
                    <div
                      onClick={() => setRememberMachine(!rememberMachine)}
                      className="flex items-center gap-2.5 text-xs text-zinc-400 hover:text-zinc-200 cursor-pointer select-none"
                    >
                      <div className={`size-4 rounded border flex items-center justify-center transition-all ${
                        rememberMachine
                          ? "bg-white border-white text-black"
                          : "bg-white/[0.04] border-white/[0.2] text-transparent hover:border-white/[0.4]"
                      }`}>
                        {rememberMachine && <Check size={11} className="stroke-[3] text-black" />}
                      </div>
                      <span>Ingat perangkat ini</span>
                    </div>

                    <button
                      type="button"
                      onClick={() => setAuthMode("license")}
                      className="text-xs font-medium text-zinc-300 hover:text-white underline underline-offset-4 cursor-pointer"
                    >
                      Gunakan Key?
                    </button>
                  </div>
                ) : (
                  <div
                    onClick={() => setAgreeTerms(!agreeTerms)}
                    className="flex items-center gap-2.5 pt-1 text-xs text-zinc-400 hover:text-zinc-200 cursor-pointer select-none"
                  >
                    <div className={`size-4 rounded border flex items-center justify-center transition-all ${
                      agreeTerms
                        ? "bg-white border-white text-black"
                        : "bg-white/[0.04] border-white/[0.2] text-transparent hover:border-white/[0.4]"
                    }`}>
                      {agreeTerms && <Check size={11} className="stroke-[3] text-black" />}
                    </div>
                    <span>
                      Saya menyetujui Ketentuan & Kebijakan Sentinel
                    </span>
                  </div>
                )}
              </>
            ) : (
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <Label htmlFor="license-input" className="text-xs font-medium text-zinc-300 flex items-center gap-1.5">
                    <KeyRound size={13} className="text-zinc-300" />
                    Kode Lisensi PRO
                  </Label>
                  <Input
                    id="license-input"
                    type="text"
                    placeholder="PRO-SENTINEL-XXXX-XXXX"
                    value={licenseKey}
                    onChange={(e) => setLicenseKey(e.target.value.toUpperCase())}
                    required
                    className="font-mono bg-white/[0.04] border-white/[0.1] text-white placeholder:text-zinc-500 h-10 tracking-wider"
                  />
                </div>

                <div className="p-2.5 rounded-xl bg-white/[0.02] border border-white/[0.06] text-[11px] text-zinc-400 flex items-center justify-between">
                  <span className="font-mono text-zinc-500">HWID Kunci Mesin:</span>
                  <span className="font-mono text-zinc-300 font-medium">
                    {authStatus?.hwid ? `${authStatus.hwid.substring(0, 14)}...` : "LOCAL-HOST"}
                  </span>
                </div>
              </div>
            )}

            <Button
              type="submit"
              disabled={isLoading}
              className="mt-6 w-full h-10 font-semibold bg-white text-black hover:bg-zinc-200 active:scale-[0.98] transition-all cursor-pointer disabled:opacity-50 flex items-center justify-center gap-2 rounded-xl shadow-lg shadow-black/50"
            >
              {isLoading ? (
                <Loader2 size={16} className="animate-spin" />
              ) : authMode === "license" ? (
                <Sparkles size={15} />
              ) : (
                <ShieldCheck size={15} />
              )}
              <span>
                {isLoading
                  ? "Memproses..."
                  : authMode === "signin"
                  ? "Sign In ke Cloud"
                  : authMode === "license"
                  ? "Aktivasi Lisensi PRO"
                  : "Buat Akun Baru"}
              </span>
            </Button>
          </form>

          {/* Separator */}
          <div className="relative my-6">
            <div className="absolute inset-0 flex items-center">
              <Separator />
            </div>
            <div className="relative flex justify-center text-[10px] uppercase font-mono tracking-widest">
              <span className="bg-[#090a0c] px-2 text-zinc-500">
                SENTINEL SECURITY
              </span>
            </div>
          </div>

          <p className="text-[11px] text-zinc-500 text-center font-mono">
            Pro License membuka Unlimited Cut-Off & Bandwidth Throttling.
          </p>
        </div>
      </div>
    </div>
  );
};
