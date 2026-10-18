import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { I18nProvider } from "./i18n";
import { ErrorBoundary } from "./components/ErrorBoundary";
import App from "./App";
import { api } from "./api/client";
import { applyTheme } from "./lib/theme";
import "./index.css";

// 主题在内容出现前确定：先读持久化值（settings 表，脏值/失败回落深色），
// 套好 .dark 类再挂 React——首帧即带主题，无闪变。旧 bgColor 调色已废弃，
// 顺手清掉残留键，不转换成任何新主题值。
async function boot(): Promise<void> {
    localStorage.removeItem("bgColor");
    try {
        const r = await api.getTheme();
        applyTheme(r.ok && r.data.theme === "light" ? "light" : "dark");
    } catch {
        applyTheme("dark");
    }
    // 非空断言 !：index.html 里必然存在 #root，
    // 若缺失则说明页面结构被破坏，直接抛错比静默渲染更诚实。
    createRoot(document.getElementById("root")!).render(
        <StrictMode>
            <ErrorBoundary>
                <I18nProvider>
                    <App />
                </I18nProvider>
            </ErrorBoundary>
        </StrictMode>,
    );
}

void boot();
