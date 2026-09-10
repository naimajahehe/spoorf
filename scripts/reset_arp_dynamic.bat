@echo off
:: NetCut Sentinel - Reset ARP & Restore Dynamic
net session >nul 2>&1
if %errorLevel% neq 0 (
    echo [INFO] Meminta hak akses Administrator (UAC)...
    powershell -Command "Start-Process cmd -ArgumentList '/c \"\"%~f0\"\"' -Verb runAs"
    exit /b
)

title Reset ARP Cache - Spoorf Sentinel
echo =======================================================
echo NetCut Sentinel - Reset ARP Cache ^& Restore Dynamic ARP
echo =======================================================
echo.
echo Sedang membersihkan entri static/permanent di adapter Wi-Fi...
echo.

powershell -NoProfile -Command "Get-NetNeighbor -InterfaceAlias 'Wi-Fi' -AddressFamily IPv4 | Where-Object { $_.State -eq 'Permanent' -and $_.IPAddress -notmatch '^(224\.|239\.|255\.255\.255\.255)' } | ForEach-Object { Write-Host 'Menghapus entri permanen:' $_.IPAddress; Remove-NetNeighbor -InterfaceAlias 'Wi-Fi' -IPAddress $_.IPAddress -Confirm:$false -ErrorAction SilentlyContinue }"

echo.
echo Mengosongkan cache ARP Windows...
netsh interface ip delete arpcache >nul 2>&1
arp -d * >nul 2>&1

echo.
echo Melakukan Flush DNS...
ipconfig /flushdns >nul 2>&1

echo.
echo =======================================================
echo [SUKSES] Tabel ARP telah dikembalikan ke status DYNAMIC!
echo Entri statis router lama telah berhasil dihapus.
echo Sekarang silakan hubungkan kembali ke Wi-Fi 'Teman Kenangan'.
echo =======================================================
echo.
pause
