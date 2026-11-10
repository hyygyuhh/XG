#!/bin/zsh
set -e
cd -- "$(dirname -- "$0")"
python3 - <<'PY'
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
import subprocess
server = ThreadingHTTPServer(('127.0.0.1', 0), SimpleHTTPRequestHandler)
url = f'http://127.0.0.1:{server.server_port}/'
print(f'试用地址：{url}\n关闭此终端窗口即可停止。', flush=True)
subprocess.Popen(['open', '-a', 'Microsoft Edge', url])
try:
    server.serve_forever()
except KeyboardInterrupt:
    pass
finally:
    server.server_close()
PY
