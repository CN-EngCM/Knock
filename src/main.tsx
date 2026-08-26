import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { I18nProvider } from "./i18n";
import { ErrorBoundary } from "./components/ErrorBoundary";
import App from "./App";
import "./index.css";

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
