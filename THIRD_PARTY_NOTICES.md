# Third-party notices

本文件记录敲敲（Knock）实际复制的第三方代码与配色来源。组件源码接入自 GaN.UI（`D:\MyCode\GaN.UI`，源码基线 v1.0.0，提交 `e7e52dc`），声明条目随复制范围保留。

## shadcn/ui

`src/renderer/src/components/ui/` 下的界面组件（button / input / input-group / label / textarea / select / switch / dialog / alert-dialog / context-menu / menu / tooltip / popover / kbd / empty / spinner / sonner / tabs / badge / card / field / item / marker / separator / toolbar / statusbar / progress / toggle / toggle-group / alert / titlebar / action-bar）改自 shadcn/ui 的 Radix Nova 注册表源码。来源：https://github.com/shadcn-ui/ui

GaN.UI v1.0.0 默认使用 MiSans（npm `misans`）与 Geist Mono（npm `@fontsource-variable/geist-mono`）字体；敲敲**未引入**这两套字体，界面仍使用项目自有的 Outfit（可变）与 IBM Plex Mono 本地内嵌 woff2，因此本文件不含相关字体授权条目。若日后改用 MiSans，须按《MiSans 字体知识产权许可协议》署名且不得将字体文件入库。

MIT License

Copyright (c) 2023 shadcn

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

## Darwin UI

`src/renderer/src/index.css` 中浅色主题的色值（表面、文字、边框、强调与按钮色阶）经 GaN.UI v1.0.0 默认浅色（冷灰）承接 Darwin UI 样式表在固定提交 `17777097f271f779cca380da851ee8f45f559665` 处的取色。仅参考色值；未包含 Darwin UI 的组件、圆角、阴影结构、动画或全局样式。来源：https://github.com/surajmandalcell/darwin-ui

MIT License

Copyright (c) 2025 Suraj Mandal

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
