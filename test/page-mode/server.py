"""Page mode test harness: python3 test/page-mode/server.py, then open http://localhost:8767/#mobile-sim"""
import http.server, os, socketserver

HEADERS = {
    '/deny.html': {'X-Frame-Options': 'DENY'},
    '/csp.html': {'Content-Security-Policy': "default-src 'self'; style-src 'self'; script-src 'self'; frame-ancestors 'self'"},
}


class Handler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        for k, v in HEADERS.get(self.path.split('?')[0], {}).items():
            self.send_header(k, v)
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()

    def log_message(self, *args):
        pass


os.chdir(os.path.dirname(os.path.abspath(__file__)))
socketserver.TCPServer.allow_reuse_address = True
with socketserver.TCPServer(('127.0.0.1', 8767), Handler) as httpd:
    print('page mode harness on http://localhost:8767')
    httpd.serve_forever()
