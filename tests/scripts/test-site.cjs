// 本地测试站：两页 HTML（含翻页）+ 多张图片（不同尺寸/格式），供图库「从网址导入」手测。
// 运行：node tests/scripts/test-site.cjs，然后在图库里导入 http://127.0.0.1:37191/p1.html
// 另有几条用来验证抓取的异常路径（都在 http://127.0.0.1:37191 下）：
//   /slow.html        HTML 立刻返回，含一张永不返回的图（/hang.jpg）和几张正常图——测慢页面到点就收集
//   /stall.jpg        发一点数据后挂住不结束——测下载超时
//   /huge.jpg         声明 2GB 的 content-length 后挂住——测体积上限不等读完就返回 too-large
//   /endless.jpg      不声明长度、源源不断地发数据——测边读边累计超限就取消（服务端连接被关掉）
//   /echo-headers.png 返回一张图并记下本次请求头；/last-headers 以 JSON 读出最近一次（看 referer、cookie）
//   /redirect.png     302 到 /big.png——测下载跟随重定向
//   /set-cookie.html  响应头种一个 cookie（k=v）——先用隐藏窗口渲染它，再取 /echo-headers.png 看 cookie 有没有带上
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const PNG = fs.readFileSync(path.join(__dirname, "..", "..", "assets", "icon.png")); // 256x256
const SVG = Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="80"><rect width="100" height="80" fill="red"/></svg>',
);
const page = (n) =>
    Buffer.from(
        `<html><head><title>test-${n}</title></head><body><h1>page ${n}</h1>` +
            `<img src="/big.png"><img src="/icon.svg"><img src="/big.png?v=2"><a href="/linked.png">link</a>` +
            `${n < 2 ? `<a href="/p${n + 1}.html">下一页 ›</a>` : ""}</body></html>`,
    );

// 最近一次 /echo-headers.png 的请求头
let lastHeaders = {};

const server = http.createServer((req, res) => {
    const route = (req.url ?? "/").split("?")[0];
    if (route === "/slow.html") {
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        res.end(
            "<html><head><title>slow-page</title></head><body><h1>slow</h1>" +
                `<img src="/hang.jpg" width="400" height="300"><img src="/big.png?s=1"><img src="/big.png?s=2"><img src="/icon.svg?s=3">` +
                "</body></html>",
        );
    } else if (route === "/hang.jpg") {
        // 收到请求后既不回头也不回体：页面的 load 事件永远等不到
    } else if (route === "/stall.jpg") {
        res.writeHead(200, { "content-type": "image/jpeg", "content-length": "1000000" });
        res.write(Buffer.alloc(1024, 0xff)); // 发一点就挂住，不 end
    } else if (route === "/huge.jpg") {
        res.writeHead(200, { "content-type": "image/jpeg", "content-length": "2000000000" });
        res.write(Buffer.alloc(1024, 0xff));
    } else if (route === "/endless.jpg") {
        res.writeHead(200, { "content-type": "image/jpeg" });
        const timer = setInterval(() => res.write(Buffer.alloc(65536, 0xff)), 10);
        res.on("close", () => {
            clearInterval(timer);
            console.log("/endless.jpg 连接已被客户端关闭");
        });
    } else if (route === "/echo-headers.png") {
        lastHeaders = {
            referer: req.headers.referer ?? "",
            cookie: req.headers.cookie ?? "",
            ua: req.headers["user-agent"] ?? "",
        };
        res.writeHead(200, { "content-type": "image/png" });
        res.end(PNG);
    } else if (route === "/last-headers") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify(lastHeaders));
    } else if (route === "/set-cookie.html") {
        res.writeHead(200, { "content-type": "text/html; charset=utf-8", "set-cookie": "k=v; Path=/" });
        res.end("<html><head><title>cookie</title></head><body>ok</body></html>");
    } else if (route === "/redirect.png") {
        res.writeHead(302, { location: "/big.png" });
        res.end();
    } else if (route === "/big.png" || route === "/linked.png") {
        res.writeHead(200, { "content-type": "image/png" });
        res.end(PNG);
    } else if (route === "/icon.svg") {
        res.writeHead(200, { "content-type": "image/svg+xml" });
        res.end(SVG);
    } else if (/^\/p\d+\.html$/.test(route)) {
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        res.end(page(parseInt(route.slice(2), 10) || 1));
    } else {
        res.writeHead(404);
        res.end("no");
    }
});
server.listen(37191, "127.0.0.1", () => console.log("test site on http://127.0.0.1:37191/p1.html"));
