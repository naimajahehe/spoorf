import sys
import multiprocessing
import uvicorn
from src.server import app

if __name__ == '__main__':
    multiprocessing.freeze_support()
    uvicorn.run(app, host="127.0.0.1", port=8001, log_level="info", access_log=False)
