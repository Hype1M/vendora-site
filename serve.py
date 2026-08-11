#!/usr/bin/env python3
"""
Serveur local Vendora : sert le site statique ET relaie les requetes vers
l'API Render (meme origine -> aucun probleme de CORS, sans toucher au backend).

Lancer :  python3 serve.py     puis ouvrir  http://localhost:8000
"""
import http.server, socketserver, urllib.request, urllib.error

PORT = 8000
RENDER = "https://gemini-api-ko4v.onrender.com"   # API Gemini sur Render

class Handler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        # Interdit le cache : le navigateur charge toujours la derniere version.
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()

    def do_POST(self):
        # Tout POST vers /proxy/... est relaye vers Render.
        if self.path.startswith("/proxy/"):
            target = RENDER + self.path[len("/proxy"):]   # /proxy/generate -> /generate
            length = int(self.headers.get("Content-Length", 0))
            body = self.rfile.read(length)
            req = urllib.request.Request(target, data=body, method="POST")
            ct = self.headers.get("Content-Type")
            if ct:
                req.add_header("Content-Type", ct)   # conserve la boundary multipart
            try:
                with urllib.request.urlopen(req, timeout=300) as r:
                    data = r.read()
                    self.send_response(r.status)
                    self.send_header("Content-Type", r.headers.get("Content-Type", "application/octet-stream"))
                    self.send_header("Content-Length", str(len(data)))
                    self.end_headers()
                    self.wfile.write(data)
            except urllib.error.HTTPError as e:
                data = e.read()
                self.send_response(e.code)
                self.send_header("Content-Type", e.headers.get("Content-Type", "application/json"))
                self.send_header("Content-Length", str(len(data)))
                self.end_headers()
                self.wfile.write(data)
            except Exception as e:
                msg = ('{"error":"proxy: ' + str(e).replace('"', "'") + '"}').encode()
                self.send_response(502)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(msg)))
                self.end_headers()
                self.wfile.write(msg)
            return
        self.send_error(404)

socketserver.TCPServer.allow_reuse_address = True
with socketserver.TCPServer(("", PORT), Handler) as httpd:
    print("Vendora en ligne sur http://localhost:%d  (proxy Render actif)" % PORT)
    httpd.serve_forever()
