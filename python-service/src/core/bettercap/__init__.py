#!/usr/bin/env python3
"""
Bettercap Security Suite Engine for NetCut Sentinel (Spoorf)
============================================================
Modul terintegrasi yang menghadirkan kapabilitas inti Bettercap:
- Dynamic DNS Spoofing Engine (Wildcard/Regex mapping)
- Protocol Dissector & Packet Sniffer (Auth headers, cookies, cleartext)
- High-Speed SYN & Port Reconnaissance Scanner
"""

from .dns_spoofer import BettercapDNSEngine, DnsSpoofRule
from .sniffer import BettercapPacketDissector, SniffedCredential
from .syn_scan import FastSYNScanner, PortScanResult

__all__ = [
    "BettercapDNSEngine",
    "DnsSpoofRule",
    "BettercapPacketDissector",
    "SniffedCredential",
    "FastSYNScanner",
    "PortScanResult",
]
