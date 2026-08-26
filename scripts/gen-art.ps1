# AsciiSplash art generator (dev tool, run manually after renaming/logo change):
# render text via GDI to a bitmap, convert pixels to half-block chars (2 pixel
# rows per char cell: U+2588/U+2580/U+2584/space), write UTF-8 text for
# AsciiSplash.tsx to embed. Windows only (System.Drawing). Keep this file pure
# ASCII: PS 5.1 reads BOM-less .ps1 as ANSI and mangles non-ASCII bytes.
# Usage: powershell -NoProfile -ExecutionPolicy Bypass -File scripts/gen-art.ps1
Add-Type -AssemblyName System.Drawing

function Render-Art([string]$text, [string]$fontName, [float]$em, [string]$path) {
  $font = New-Object System.Drawing.Font($fontName, $em, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
  $probe = New-Object System.Drawing.Bitmap(1, 1)
  $g0 = [System.Drawing.Graphics]::FromImage($probe)
  $sz = $g0.MeasureString($text, $font)
  $w = [int][Math]::Ceiling($sz.Width) + 4
  $h = [int][Math]::Ceiling($sz.Height) + 4
  $bmp = New-Object System.Drawing.Bitmap($w, $h)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::SingleBitPerPixelGridFit
  $g.Clear([System.Drawing.Color]::Black)
  $g.DrawString($text, $font, [System.Drawing.Brushes]::White, 0.0, 0.0)
  Write-Output "  debug: textLen=$($text.Length) bmp=${w}x${h}"

  $minx = $w; $maxx = -1; $miny = $h; $maxy = -1; $lit = 0
  for ($y = 0; $y -lt $h; $y++) {
    for ($x = 0; $x -lt $w; $x++) {
      if ($bmp.GetPixel($x, $y).R -gt 96) {
        $lit++
        if ($x -lt $minx) { $minx = $x }; if ($x -gt $maxx) { $maxx = $x }
        if ($y -lt $miny) { $miny = $y }; if ($y -gt $maxy) { $maxy = $y }
      }
    }
  }
  Write-Output "  debug: lit=$lit"

  $lines = New-Object System.Collections.Generic.List[string]
  for ($y = $miny; $y -le $maxy; $y += 2) {
    $sb = New-Object System.Text.StringBuilder
    for ($x = $minx; $x -le $maxx; $x++) {
      $top = ($bmp.GetPixel($x, $y).R -gt 96)
      $bot = (($y + 1) -le $maxy) -and ($bmp.GetPixel($x, ($y + 1)).R -gt 96)
      $c = if ($top -and $bot) { [char]0x2588 } elseif ($top) { [char]0x2580 } elseif ($bot) { [char]0x2584 } else { ' ' }
      [void]$sb.Append($c)
    }
    $lines.Add(($sb.ToString()).TrimEnd())
  }
  [System.IO.File]::WriteAllLines($path, $lines, (New-Object System.Text.UTF8Encoding $false))
  Write-Output "$path : $($maxx - $minx + 1) cols x $($lines.Count) rows"
}

# qiao (knock) = U+6572, built from codepoint to stay ASCII
$qiao2 = [string][char]0x6572 + [char]0x6572
Render-Art $qiao2 'Microsoft YaHei UI' 40 "$PSScriptRoot\art-zh.txt"
Render-Art 'KNOCK' 'Consolas' 33 "$PSScriptRoot\art-en.txt"
