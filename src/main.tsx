import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { I18nProvider } from "./i18n";
import { ErrorBoundary } from "./components/ErrorBoundary";
import App from "./App";
import { applyBgColor, loadBgColor } from "./lib/theme";
import "./index.css";

// 背景色偏好先于首帧应用:用户改过的底色在这里覆盖 CSS 默认值,避免闪一下默认色
applyBgColor(loadBgColor());

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
