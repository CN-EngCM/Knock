// 应用内网页面板的本地测试站：不依赖外网，验证 cookie / localStorage 落盘、UA、新开窗口、非 http 跳转被拦。
// 运行：node tests/scripts/web-test-site.cjs [端口，默认 7788]
// 路由：
//   /          写 cookie 与 localStorage，页内有两个链接（target=_blank、普通跳转）
//   /second    第二个页面，标题 "second"
//   /ua        把请求头里的 User-Agent 当正文返回
//   /slow      5 秒后才响应，用来看加载中的状态
const http = require("node:http");

const port = Number(process.argv[2] ?? 7788);

const page = (title, body) => `<!doctype html><meta charset="utf-8"><title>${title}</title>${body}`;

http.createServer((req, res) => {
    const url = new URL(req.url, `http://127.0.0.1:${port}`);
    if (url.pathname === "/ua") {
        res.setHeader("Content-Type", "text/plain; charset=utf-8");
        res.end(req.headers["user-agent"] ?? "");
        return;
    }
    if (url.pathname === "/slow") {
        setTimeout(() => {
            res.setHeader("Content-Type", "text/html; charset=utf-8");
            res.end(page("slow", "slow done"));
        }, 5000);
        return;
    }
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    if (url.pathname === "/second") {
        res.end(page("second", "<p>second page</p>"));
        return;
    }
    res.setHeader("Set-Cookie", "knock_test=1; Max-Age=86400; Path=/");
    res.end(
        page(
            "home",
            `<script>localStorage.setItem("knock_test", "1")</script>
<a id="blank" href="/second" target="_blank">blank</a>
<a id="plain" href="/second">plain</a>
<a id="mailto" href="mailto:a@b.com">mailto</a>`,
        ),
    );
}).listen(port, "127.0.0.1", () => console.log(`web-test-site: http://127.0.0.1:${port}/`));
