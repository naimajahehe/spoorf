import os
import sys
import subprocess
import shutil

def build():
    print("[Build Engine] Building spoorf-engine.exe via PyInstaller...")
    script_dir = os.path.dirname(os.path.abspath(__file__))
    os.chdir(script_dir)

    dist_dir = os.path.join(script_dir, "dist")
    build_dir = os.path.join(script_dir, "build")

    cmd = [
        sys.executable, "-m", "PyInstaller",
        "--noconfirm",
        "--onedir",
        "--name", "spoorf-engine",
        "--clean",
        "--hidden-import", "uvicorn.logging",
        "--hidden-import", "uvicorn.loops",
        "--hidden-import", "uvicorn.loops.auto",
        "--hidden-import", "uvicorn.protocols",
        "--hidden-import", "uvicorn.protocols.http",
        "--hidden-import", "uvicorn.protocols.http.auto",
        "--hidden-import", "uvicorn.protocols.websockets",
        "--hidden-import", "uvicorn.protocols.websockets.auto",
        "--hidden-import", "uvicorn.lifespans",
        "--hidden-import", "uvicorn.lifespans.auto",
        "--hidden-import", "scapy.all",
        "--hidden-import", "scapy.layers.all",
        "--hidden-import", "scapy.arch.windows",
        "--collect-all", "scapy",
        "--collect-all", "fastapi",
        "--collect-all", "starlette",
        "--collect-all", "uvicorn",
        "main.py"
    ]

    print(f"Executing: {' '.join(cmd)}")
    res = subprocess.run(cmd)
    if res.returncode == 0:
        print("\n[OK] [Build Engine] spoorf-engine successfully built in dist/spoorf-engine/!")
    else:
        print(f"\n[FAIL] [Build Engine] Build failed with code {res.returncode}")
        sys.exit(res.returncode)

if __name__ == "__main__":
    build()
