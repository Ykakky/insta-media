# 実機確認用の配信サーバー。キャッシュさせないので、更新がすぐiPhoneに反映される。
#   python3 serve.py [port]
import http.server, os, socket, sys

class NoCache(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, must-revalidate')
        super().end_headers()

def lan_ip():
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(('10.255.255.255', 1))  # 実際には送信しない。経路からLAN側のIPを得るだけ
        return s.getsockname()[0]
    except OSError:
        return 'localhost'
    finally:
        s.close()

os.chdir(os.path.dirname(os.path.abspath(__file__)))
port = int(sys.argv[1]) if len(sys.argv) > 1 else 8123
url = f'http://{lan_ip()}:{port}'
try:
    server = http.server.ThreadingHTTPServer(('', port), NoCache)
except OSError as e:
    if e.errno == 48:
        print(f'ポート{port}はすでに使われています（サーバーが起動済みの可能性）。iPhoneで {url} を開いてください。')
        sys.exit(0)
    raise
print(f'配信中: iPhoneで {url} を開いてください（止めるには Ctrl+C）')
try:
    server.serve_forever()
except KeyboardInterrupt:
    pass
