# Third-party notices

本文件记录敲敲（Knock）实际复制的第三方代码与配色来源。组件源码接入自 GaN.UI（`D:\MyCode\GaN.UI`，源码基线 v1.5.4，提交 `0edf835`），声明条目随复制范围保留。

## shadcn/ui

`src/renderer/src/components/ui/` 下的界面组件（button / input / input-group / label / textarea / select / switch / dialog / alert-dialog / context-menu / menu / tooltip / kbd / empty / spinner / sonner / tabs / badge / card / field / item / marker / separator / toolbar / statusbar / progress / toggle / toggle-group / alert / titlebar / action-bar / combobox / tree / dock-layout）改自 shadcn/ui 的 Radix Nova 注册表源码。来源：https://github.com/shadcn-ui/ui

GaN.UI v1.5.4 默认使用 MiSans（npm `misans`）与 Geist Mono（npm `@fontsource-variable/geist-mono`）字体；敲敲**未引入**这两套字体，界面仍使用项目自有的 Outfit（可变）与 IBM Plex Mono 本地内嵌 woff2，因此本文件不含相关字体授权条目。若日后改用 MiSans，须按《MiSans 字体知识产权许可协议》署名且不得将字体文件入库。

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

`src/renderer/src/index.css` 中浅色主题的色阶结构承自 GaN.UI v1.5.4 的浅色体系：上游默认浅色「冷灰」的表面、文字、边框、强调与按钮色阶取自 Darwin UI 样式表在固定提交 `17777097f271f779cca380da851ee8f45f559665` 处，本项目采用同体系的「薄雾」配色。仅参考色值；未包含 Darwin UI 的组件、圆角、阴影结构、动画或全局样式。来源：https://github.com/surajmandalcell/darwin-ui

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

## 图标库

条目图标选择器里的图标，图标数据随安装包分发（构建时打进产物，按需懒加载）。除文件类的 Material Icon Theme（npm `material-icon-theme`）外，其余四个以 npm 包 `@iconify-json/<库>` 引入，均在 `devDependencies`。

| 库 | 作者 | 授权 | 来源 |
| --- | --- | --- | --- |
| Material Icon Theme | Material Extensions | MIT | https://github.com/material-extensions/vscode-material-icon-theme |
| SVG Logos | Gil Barbara | CC0 1.0 | https://github.com/gilbarbara/logos |
| Fluent UI System Color Icons | Microsoft Corporation | MIT | https://github.com/microsoft/fluentui-system-icons |
| Material Design Icons | Pictogrammers | Apache License 2.0 | https://github.com/Templarian/MaterialDesign |
| Siemens Industrial Experience Icons | Siemens AG | MIT | https://github.com/siemens/ix-icons |

SVG Logos 里的品牌 logo，商标归各自的所有者；本应用只在启动器里用它标识对应的网站和软件。CC0 授权不要求署名，此处列出仅为说明来源。

Material Design Icons 的图标按 Apache License 2.0 分发（上游 Pictogrammers Free License 的说明），许可证全文见 https://www.apache.org/licenses/LICENSE-2.0 。

以下三个 MIT 授权的库共用同一份许可文本，版权行分别为：

- Copyright (c) 2025 Material Extensions（Material Icon Theme）
- Copyright (c) 2020 Microsoft Corporation（Fluent UI System Color Icons）
- Copyright (c) 2022 Siemens AG（Siemens Industrial Experience Icons）

MIT License

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

## pinyin-pro

搜索框的拼音匹配（`src/renderer/src/lib/pinyinMatch.ts`）使用 npm 包 `pinyin-pro`，在 `devDependencies`；它的字典随构建打进产物。来源：https://github.com/zh-lx/pinyin-pro

MIT License

Copyright (c) 2022-present zh-lx

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
