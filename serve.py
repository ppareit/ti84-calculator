#!/usr/bin/env python3
"""Dev server for the calculator.

Plain `python3 -m http.server` lets the browser cache JS heuristically, so
edits appear not to take effect. This one says no-store on everything.

    python3 serve.py [port]
"""
import http.server, socketserver, sys

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8000


class NoCache(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, must-revalidate')
        super().end_headers()


socketserver.TCPServer.allow_reuse_address = True
with socketserver.TCPServer(('', PORT), NoCache) as httpd:
    print('TI-84 running at http://localhost:%d' % PORT)
    httpd.serve_forever()
