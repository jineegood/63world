const http = require('http');
const fs = require('fs');
const path = require('path');

const root = path.resolve(process.argv[2] || path.join(__dirname, '..', '..'));
const port = Number(process.argv[3] || 4173);
const contentTypes = { '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.css':'text/css; charset=utf-8' };

http.createServer((request, response) => {
  const pathname = decodeURIComponent(String(request.url || '/').split('?')[0]);
  const requested = pathname === '/' ? '/index.html' : pathname;
  const file = path.resolve(root, `.${requested}`);
  if (!file.startsWith(root)) {
    response.writeHead(403).end();
    return;
  }
  fs.readFile(file, (error, data) => {
    if (error) {
      response.writeHead(404).end();
      return;
    }
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Content-Type', contentTypes[path.extname(file)] || 'application/octet-stream');
    response.end(data);
  });
}).listen(port, '127.0.0.1');
