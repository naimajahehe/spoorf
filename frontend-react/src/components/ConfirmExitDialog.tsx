import React from 'react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { ShieldAlert, LogOut } from 'lucide-react';

interface ConfirmExitDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}

export const ConfirmExitDialog: React.FC<ConfirmExitDialogProps> = ({
  open,
  onOpenChange,
  onConfirm,
}) => {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="border border-white/10 bg-[#0d0f14]/98 shadow-2xl backdrop-blur-2xl max-w-[440px]">
        <AlertDialogHeader className="space-y-3">
          <div className="size-11 rounded-xl bg-rose-500/10 border border-rose-500/25 flex items-center justify-center text-rose-400 mx-auto sm:mx-0 shadow-lg shadow-rose-500/10">
            <ShieldAlert size={22} className="text-rose-400" />
          </div>
          <div className="space-y-1 text-center sm:text-left">
            <AlertDialogTitle className="text-base font-semibold text-white tracking-tight">
              Keluar dari Spoorf Sentinel?
            </AlertDialogTitle>
            <AlertDialogDescription className="text-xs text-zinc-400 leading-relaxed">
              Aktivitas pemantauan jaringan, proteksi ARP, dan pembatasan bandwidth yang sedang aktif akan dihentikan saat aplikasi ditutup. Apakah Anda yakin ingin keluar?
            </AlertDialogDescription>
          </div>
        </AlertDialogHeader>
        <AlertDialogFooter className="pt-2">
          <AlertDialogCancel onClick={() => onOpenChange(false)}>
            Batal
          </AlertDialogCancel>
          <AlertDialogAction
            onClick={onConfirm}
            className="flex items-center gap-1.5"
          >
            <LogOut size={14} />
            <span>Keluar & Tutup</span>
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};

export default ConfirmExitDialog;
