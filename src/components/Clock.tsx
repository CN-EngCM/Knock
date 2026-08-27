import { useEffect, useState } from "react";

// 时钟独立成组件：每秒的重渲染被隔离在组件内部，不牵动整棵 App 树。
export function Clock() {
    const [now, setNow] = useState(() => new Date());
    useEffect(() => {
        const id = setInterval(() => setNow(new Date()), 1000);
        return () => clearInterval(id);
    }, []);
    const time = [now.getHours(), now.getMinutes(), now.getSeconds()].map((n) => String(n).padStart(2, "0")).join(":");
    return <span>{time}</span>;
}
