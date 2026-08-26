// electron-builder afterPack 钩子（目录版瘦身，pnpm dist 时自动执行）。
// 删的都是运行用不到的文件；一旦哪天用了 WebGPU/拼写检查异常，从这里找原因。
//   locales/*      —— Chromium 界面语言包，只留中英文（UI 文案本来走自家 i18n）
//   LICENSES.chromium.html —— 19MB 纯许可证汇编（个人自用；对外分发请保留）
//   dxcompiler/dxil —— Dawn(WebGPU) 的着色器编译器，本应用纯 DOM 界面用不到
//   elevate.exe    —— 仅 NSIS/portable 目标的提权辅助，dir 目标无用
const fs = require('node:fs')
const path = require('node:path')

const KEEP_LOCALES = new Set(['en-US.pak', 'zh-CN.pak', 'zh-TW.pak'])

/** @param context {import('electron-builder').AfterPackContext} */
module.exports = function afterPack(context) {
  const dir = context.appOutDir
  const drop = [
    path.join(dir, 'LICENSES.chromium.html'),
    path.join(dir, 'dxcompiler.dll'),
    path.join(dir, 'dxil.dll'),
    path.join(dir, 'resources', 'elevate.exe'),
  ]
  const localesDir = path.join(dir, 'locales')
  if (fs.existsSync(localesDir)) {
    for (const f of fs.readdirSync(localesDir)) {
      if (!KEEP_LOCALES.has(f)) drop.push(path.join(localesDir, f))
    }
  }
  let freed = 0
  for (const f of drop) {
    try {
      freed += fs.statSync(f).size
      fs.rmSync(f)
    } catch {
      /* 不存在就跳过 */
    }
  }
  console.log(`afterPack 瘦身：删除 ${drop.length} 个文件，释放约 ${Math.round(freed / 1048576)}MB`)
}
