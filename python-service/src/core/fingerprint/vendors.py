"""
Vendor & OUI Database + MAC Randomization Heuristics
"""

# ===== VENDOR DATABASE (OUI) =====
_VENDORS = {
    # Apple
    '00:03:93': 'Apple', '00:05:02': 'Apple', '00:0a:95': 'Apple', '00:0d:93': 'Apple',
    '00:10:fa': 'Apple', '00:14:51': 'Apple', '00:16:cb': 'Apple', '00:17:f2': 'Apple',
    '00:19:e3': 'Apple', '00:1b:63': 'Apple', '00:1c:b3': 'Apple', '00:1d:4f': 'Apple',
    '00:1e:52': 'Apple', '00:1e:c2': 'Apple', '00:21:e9': 'Apple', '00:22:41': 'Apple',
    '00:23:12': 'Apple', '00:23:df': 'Apple', '00:24:36': 'Apple', '00:25:00': 'Apple',
    '00:25:4b': 'Apple', '00:26:08': 'Apple', '00:26:4a': 'Apple', '00:26:b0': 'Apple',
    '28:cf:e9': 'Apple', '34:08:bc': 'Apple', '38:ca:84': 'Apple', '3c:07:54': 'Apple',
    '70:11:24': 'Apple', '74:8d:08': 'Apple', '78:7b:8a': 'Apple', '7c:04:d0': 'Apple',
    'a4:83:e7': 'Apple', 'ac:bc:32': 'Apple', 'b0:34:95': 'Apple', 'd0:23:db': 'Apple',
    'f0:18:98': 'Apple', 'f4:5c:89': 'Apple', 'f8:ff:c2': 'Apple',

    # Samsung
    '00:07:ab': 'Samsung', '00:12:47': 'Samsung', '00:15:99': 'Samsung', '00:17:d5': 'Samsung',
    '00:1a:8a': 'Samsung', '00:1d:25': 'Samsung', '00:21:19': 'Samsung', '00:24:e9': 'Samsung',
    '08:08:c2': 'Samsung', '14:89:fd': 'Samsung', '28:27:bf': 'Samsung', '34:23:87': 'Samsung',
    '40:0e:85': 'Samsung', '44:4e:1a': 'Samsung', '4c:bc:42': 'Samsung', '54:92:be': 'Samsung',
    '64:77:91': 'Samsung', '78:47:1d': 'Samsung', '84:25:19': 'Samsung', '94:01:c2': 'Samsung',
    'ac:5a:f0': 'Samsung', 'b4:3a:28': 'Samsung', 'c4:73:1e': 'Samsung', 'cc:07:ab': 'Samsung',

    # Xiaomi / Poco
    '00:9e:c8': 'Xiaomi', '04:cf:8c': 'Xiaomi', '0c:98:38': 'Xiaomi', '10:2a:b3': 'Xiaomi',
    '14:f6:5a': 'Xiaomi', '18:59:36': 'Xiaomi', '20:34:fb': 'Xiaomi', '28:6c:07': 'Xiaomi',
    '34:ce:00': 'Xiaomi', '3c:bd:3e': 'Xiaomi', '50:64:2b': 'Xiaomi', '64:09:80': 'Xiaomi',
    '78:11:dc': 'Xiaomi', '84:20:96': 'Xiaomi', '98:fa:e3': 'Xiaomi', 'ac:c1:ee': 'Xiaomi',
    'b4:60:77': 'Xiaomi', 'd4:97:0b': 'Xiaomi', 'ec:41:18': 'Xiaomi', 'f8:a4:5f': 'Xiaomi',

    # Oppo / Realme / OnePlus
    '00:f6:20': 'OPPO', '04:79:70': 'OPPO', '0c:d7:46': 'OPPO', '14:3c:c3': 'Realme',
    '1c:77:f6': 'OPPO', '24:52:6a': 'OPPO', '30:0c:23': 'OnePlus', '34:79:16': 'OnePlus',
    '44:33:4c': 'OPPO', '50:8f:4c': 'Realme', '68:3e:34': 'OPPO', '74:23:44': 'OPPO',
    '88:c9:d0': 'OnePlus', '94:63:72': 'OnePlus', 'a0:93:47': 'OPPO', 'ac:e3:42': 'Realme',
    'b8:37:65': 'OPPO', 'cc:44:52': 'OPPO', 'd4:50:3f': 'OnePlus', 'f0:19:af': 'OPPO',

    # Vivo / iQOO
    '08:57:00': 'Vivo', '10:f1:f2': 'Vivo', '14:d1:69': 'Vivo',
    '20:82:c0': 'Vivo', '34:0a:98': 'Vivo', '44:6d:57': 'Vivo', '54:78:1a': 'Vivo',
    '60:21:c0': 'Vivo', '70:8a:09': 'Vivo', '84:1b:5e': 'Vivo', '94:87:e0': 'Vivo',
    'a0:78:3e': 'Vivo', 'b4:e1:c4': 'Vivo', 'cc:7b:35': 'Vivo', 'f0:db:f8': 'Vivo',

    # Huawei / Honor
    '00:18:82': 'Huawei', '00:1e:10': 'Huawei', '00:25:9e': 'Huawei', '04:02:1f': 'Huawei',
    '08:19:a6': 'Huawei', '10:47:80': 'Huawei', '20:08:89': 'Huawei', '28:31:52': 'Huawei',
    '40:4d:8e': 'Huawei', '70:54:f5': 'Huawei', '84:a8:e4': 'Huawei', 'ac:85:3d': 'Huawei',

    # TP-Link & Routers
    '00:27:19': 'TP-Link', '14:cc:20': 'TP-Link', '1c:3b:f3': 'TP-Link', '30:b5:c2': 'TP-Link',
    '50:3a:a0': 'TP-Link', '50:c7:bf': 'TP-Link', '54:af:97': 'TP-Link', '60:32:b1': 'TP-Link',
    '70:4f:57': 'TP-Link', '74:da:88': 'TP-Link', '98:25:4a': 'TP-Link', 'ac:84:c6': 'TP-Link',
    'b0:4e:26': 'TP-Link', 'c0:25:e9': 'TP-Link', 'c4:6e:1f': 'TP-Link', 'd8:0d:17': 'TP-Link',
    'e4:5f:01': 'TP-Link', 'ec:08:6b': 'TP-Link', 'f4:f2:6d': 'TP-Link', '00:11:22': 'Cisco',
    '00:01:e6': 'Cisco', '08:55:31': 'MikroTik', '2c:c8:1b': 'MikroTik', '48:8f:5a': 'MikroTik',
    '78:9a:18': 'Ubiquiti', 'b4:fb:e4': 'Ubiquiti', 'd8:b3:70': 'Ubiquiti', '04:95:e6': 'Tenda',

    # Infinix / Tecno / Itel (Transsion)
    '28:bb:b2': 'Infinix', '50:2b:73': 'Tecno', '0c:41:e9': 'Infinix', '14:13:57': 'Infinix',
    '54:26:96': 'Infinix', '38:4f:f0': 'Infinix', 'e0:d4:e8': 'Infinix', 'b8:bc:5b': 'Tecno',
    '48:21:0b': 'Infinix', '2c:6b:f5': 'Infinix', '78:42:12': 'Tecno', '98:cd:ac': 'Infinix',

    # Intel / Realtek / Foxconn / MediaTek
    '00:02:b3': 'Intel', '00:13:02': 'Intel', '00:15:00': 'Intel', '00:1b:21': 'Intel',
    '00:21:6a': 'Intel', '00:24:d7': 'Intel', '34:13:e8': 'Intel', '3c:58:c2': 'Intel',
    '48:51:b7': 'Intel', '68:05:ca': 'Intel', '7c:70:db': 'Intel', '80:86:f2': 'Intel',
    'a4:34:d9': 'Intel', 'ac:74:b1': 'Intel', 'b4:96:91': 'Intel', 'c8:5b:76': 'Intel',
    '00:e0:4c': 'Realtek', '52:54:00': 'Realtek / QEMU', 'a8:3b:76': 'Lenovo / MediaTek',
    '70:66:55': 'Foxconn',

    # PC Brands: Dell, HP, Lenovo, Asus, Acer, Microsoft
    '00:14:22': 'Dell', '00:18:8b': 'Dell', '18:03:73': 'Dell', '24:b6:fd': 'Dell',
    '44:a8:42': 'Dell', '74:86:7a': 'Dell', '98:90:96': 'Dell', 'f8:bc:12': 'Dell',
    '00:1b:78': 'HP', '08:2e:5f': 'HP', '28:92:4a': 'HP', '3c:d9:2b': 'HP',
    '44:39:c4': 'HP', '70:5a:0f': 'HP', 'a4:5d:36': 'HP', 'c4:34:6b': 'HP',
    '04:7b:cb': 'Lenovo', '08:d2:3e': 'Lenovo', '20:76:93': 'Lenovo', '40:45:da': 'Lenovo',
    '48:2c:67': 'Lenovo', '50:3e:aa': 'Lenovo', '54:e1:ad': 'Lenovo', '70:72:0d': 'Lenovo',
    '80:2b:f9': 'Lenovo', 'a4:bb:6d': 'Lenovo', 'ac:38:70': 'Lenovo', 'ec:70:97': 'Lenovo',
    '00:15:f2': 'ASUS', '04:92:26': 'ASUS', '10:7b:44': 'ASUS', '14:dd:a9': 'ASUS',
    '24:4b:fe': 'ASUS', '38:2c:4a': 'ASUS', '50:46:5d': 'ASUS', '74:d0:2b': 'ASUS',
    '00:15:5d': 'Microsoft', '00:03:7f': 'Acer', '00:01:24': 'Acer', '54:ab:3a': 'Acer',

    # IoT / Smart Home / Virtual
    '18:fe:34': 'Espressif (ESP8266/ESP32)', '24:0a:c4': 'Espressif', '24:62:ab': 'Espressif',
    '2c:3a:e8': 'Espressif', '30:ae:a4': 'Espressif', '3c:61:05': 'Espressif', '3c:71:bf': 'Espressif',
    '84:0d:8e': 'Espressif', '84:f3:eb': 'Espressif', '94:b9:7e': 'Espressif', 'a4:cf:12': 'Espressif',
    'b8:27:eb': 'Raspberry Pi', 'dc:a6:32': 'Raspberry Pi', '28:cd:c1': 'Raspberry Pi',
    '00:0c:29': 'VMware', '00:50:56': 'VMware', '08:00:27': 'VirtualBox',
}

def is_randomized_mac(mac: str) -> bool:
    """Deteksi apakah MAC adalah Private/Randomized MAC (bit locally administered aktif: 2, 6, A, E)."""
    if not mac or len(mac) < 2:
        return False
    try:
        second_char = mac.replace('-', ':').split(':')[0][1].upper()
        return second_char in ('2', '6', 'A', 'E')
    except:
        return False

def get_vendor(mac: str, is_gateway: bool = False) -> str:
    """Identifikasi vendor perangkat berdasarkan 3-oktet pertama (OUI)."""
    if not mac:
        return "Router / Gateway" if is_gateway else "Unknown"
    norm = mac.replace('-', ':').lower()
    prefix = norm[:8]
    if prefix in _VENDORS:
        return _VENDORS[prefix]
    if is_randomized_mac(norm):
        return "Private Device (Randomized MAC)"
    return "Router / Gateway" if is_gateway else "Generic Device"
