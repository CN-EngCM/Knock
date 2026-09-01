// 本地测试站：两页 HTML（含翻页）+ 多张图片（不同尺寸/格式），供从网址导入的端到端测试
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const PNG = fs.readFileSync(path.join(__dirname, "assets", "icon.png")); // 256x256
const SVG = Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="80"><rect width="100" height="80" fill="red"/></svg>',
);
const page = (n) =>
    Buffer.from(
        `<html><head><title>test-${n}</title></head><body><h1>page ${n}</h1>` +
            `<img src="/big.png"><img src="/icon.svg"><img src="/big.png?v=2"><a href="/linked.png">link</a>` +
            `<a href="/p${n + 1}.html">下一页 ›</a></body></html>`,
    );

const server = http.createServer((req, res) => {
    const route = (req.url ?? "/").split("?")[0];
    if (route === "/big.png" || route === "/linked.png") {
        res.writeHead(200, { "content-type": "image/png" });
        res.end(PNG);
    } else if (route === "/icon.svg") {
        res.writeHead(200, { "content-type": "image/svg+xml" });
        res.end(SVG);
    } else if (/^\/p\d+\.html$/.test(route)) {
        res.writeHead(200, { "content-type": "text/html" });
        res.end(page(Number(route.slice(2)) || 1));
    } else {
        res.writeHead(404);
        res.end("no");
    }
});
server.listen(37191, "127.0.0.1", () => console.log("test site on http://127.0.0.1:37191/p1.html"));
