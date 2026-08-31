import os
from dotenv import load_dotenv

load_dotenv()

class Config:
    LOG_LEVEL = os.getenv('LOG_LEVEL', 'INFO')
    ARP_TIMEOUT = int(os.getenv('ARP_TIMEOUT', '3'))
    SPOOF_INTERVAL = int(os.getenv('SPOOF_INTERVAL', '1'))  # ubah default jadi 1 detik

config = Config()