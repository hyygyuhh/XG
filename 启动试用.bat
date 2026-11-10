@echo off & chcp 65001 >nul & cd /d "%~dp0" & set PYTHONIOENCODING=utf-8 & (py -3 -x "%~f0" %* || python -x "%~f0" %*) & if errorlevel 1 pause & goto :eof
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
import os
import shutil
import subprocess

os.chdir(os.path.dirname(os.path.abspath(__file__)))
server = ThreadingHTTPServer(("127.0.0.1", 0), SimpleHTTPRequestHandler)
url = f"http://127.0.0.1:{server.server_port}/"
print(f"试用地址：{url}\n关闭此窗口即可停止。", flush=True)

candidates = [
    shutil.which("msedge"),
    os.path.expandvars(r"%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"),
    os.path.expandvars(r"%ProgramFiles%\Microsoft\Edge\Application\msedge.exe"),
    os.path.expandvars(r"%LocalAppData%\Microsoft\Edge\Application\msedge.exe"),
]
edge = next((path for path in candidates if path and os.path.isfile(path)), None)
if edge:
    subprocess.Popen([edge, url])
else:
    os.startfile(url)

try:
    server.serve_forever()
except KeyboardInterrupt:
    pass
finally:
    server.server_close()
