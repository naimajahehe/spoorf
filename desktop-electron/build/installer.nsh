; ============================================================================
;  Spoorf Sentinel - NSIS custom installer script (electron-builder include)
;  Memasang prasyarat runtime SEBELUM aplikasi dianggap selesai dipasang:
;    1. Npcap  (driver kernel WAJIB untuk Scapy / injeksi paket Layer 2)
;    2. Visual C++ Runtime x64 (jaminan untuk modul native & engine)
;
;  Berkas prasyarat diletakkan pembuat di:  build/prerequisites/
;    - npcap.exe            (dari https://npcap.com/#download, rename ke npcap.exe)
;    - vc_redist.x64.exe    (dari https://aka.ms/vs/17/release/vc_redist.x64.exe)
;  Guard !if /FileExists membuat build tetap sukses walau berkas belum ada.
; ============================================================================

; --- Deteksi & pasang Npcap ------------------------------------------------
!macro InstallNpcap
  ; Deteksi berbasis file (bebas masalah registry-view 32/64-bit).
  ; wpcap.dll dipasang Npcap ke System32\Npcap\ (dan ke System32 pada mode
  ; kompatibel WinPcap). Salah satu ada = Npcap sudah terpasang.
  StrCpy $R9 "0" ; 0 = belum ada, 1 = sudah ada

  ${If} ${FileExists} "$SYSDIR\Npcap\wpcap.dll"
    StrCpy $R9 "1"
  ${ElseIf} ${FileExists} "$SYSDIR\wpcap.dll"
    StrCpy $R9 "1"
  ${EndIf}

  ${If} $R9 == "1"
    DetailPrint "Npcap sudah terpasang - dilewati."
  ${Else}
    !if /FileExists "${BUILD_RESOURCES_DIR}\prerequisites\npcap.exe"
      DetailPrint "Memasang driver Npcap (wajib untuk fitur jaringan)..."
      InitPluginsDir
      File "/oname=$PLUGINSDIR\npcap.exe" "${BUILD_RESOURCES_DIR}\prerequisites\npcap.exe"
      ; Interaktif: pengguna klik-lanjut di UI resmi Npcap (patuh lisensi gratis).
      ExecWait '"$PLUGINSDIR\npcap.exe"'
      ; Verifikasi ulang setelah pengguna menutup installer Npcap.
      ${IfNot} ${FileExists} "$SYSDIR\Npcap\wpcap.dll"
      ${AndIfNot} ${FileExists} "$SYSDIR\wpcap.dll"
        MessageBox MB_ICONEXCLAMATION|MB_OK "Npcap belum terpasang. Spoorf Sentinel membutuhkan Npcap untuk memindai dan mengelola perangkat jaringan. Anda dapat memasangnya nanti dari https://npcap.com."
      ${EndIf}
    !else
      DetailPrint "PERINGATAN: build/prerequisites/npcap.exe tidak ditemukan saat build - langkah Npcap dilewati."
    !endif
  ${EndIf}
!macroend

; --- Deteksi & pasang Visual C++ Runtime x64 -------------------------------
!macro InstallVCRedist
  ; Runtime x64 terdaftar di tampilan registry 64-bit; NSIS berjalan 32-bit,
  ; jadi alihkan ke tampilan 64-bit sebelum membaca kunci ini.
  ClearErrors
  SetRegView 64
  ReadRegDWORD $R7 HKLM "SOFTWARE\Microsoft\VisualStudio\14.0\VC\Runtimes\x64" "Installed"
  SetRegView 32
  ${If} $R7 == "1"
    DetailPrint "Visual C++ Runtime x64 sudah terpasang - dilewati."
  ${Else}
    !if /FileExists "${BUILD_RESOURCES_DIR}\prerequisites\vc_redist.x64.exe"
      DetailPrint "Memasang Visual C++ Runtime x64..."
      InitPluginsDir
      File "/oname=$PLUGINSDIR\vc_redist.x64.exe" "${BUILD_RESOURCES_DIR}\prerequisites\vc_redist.x64.exe"
      ExecWait '"$PLUGINSDIR\vc_redist.x64.exe" /install /quiet /norestart'
    !else
      DetailPrint "PERINGATAN: build/prerequisites/vc_redist.x64.exe tidak ditemukan saat build - langkah VC++ dilewati."
    !endif
  ${EndIf}
!macroend

; electron-builder memanggil makro ini di awal Section instalasi (sebelum
; aplikasi selesai dipasang). Prasyarat dijalankan lebih dulu di sini.
!macro customInstall
  DetailPrint "Memeriksa prasyarat Spoorf Sentinel..."
  !insertmacro InstallNpcap
  !insertmacro InstallVCRedist
!macroend
