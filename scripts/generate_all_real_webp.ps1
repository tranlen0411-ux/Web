Add-Type -AssemblyName System.Drawing;

$games = @(
    @{ name = "train-numbers"; title = "DOAN TAU SO HOC"; bg = [System.Drawing.Color]::DeepSkyBlue; fg = [System.Drawing.Color]::Gold; text = "1   2   3   4   5" },
    @{ name = "bee-math"; title = "ONG TIM PHEP TINH"; bg = [System.Drawing.Color]::Khaki; fg = [System.Drawing.Color]::DarkOrange; text = "5 + 2 = 7" },
    @{ name = "fish-compare"; title = "CA CON SO SANH SO"; bg = [System.Drawing.Color]::DodgerBlue; fg = [System.Drawing.Color]::OrangeRed; text = "15 > 12" },
    @{ name = "rhyme-garden"; title = "KHU VUON AM VAN"; bg = [System.Drawing.Color]::MediumSeaGreen; fg = [System.Drawing.Color]::LightYellow; text = "b + an = ban" },
    @{ name = "squirrel-reading"; title = "SOC CON DOC HIEU"; bg = [System.Drawing.Color]::DarkOrange; fg = [System.Drawing.Color]::White; text = "Doc Hieu Van Ban" },
    @{ name = "speed-racing-100"; title = "DUONG DUA PHAM VI 100"; bg = [System.Drawing.Color]::DarkSlateGray; fg = [System.Drawing.Color]::Crimson; text = "35 + 24 = 59" },
    @{ name = "multiplication-treasure"; title = "THAM HIEM BANG NHAN"; bg = [System.Drawing.Color]::Goldenrod; fg = [System.Drawing.Color]::SaddleBrown; text = "2 x 5 = 10" },
    @{ name = "smart-clock"; title = "DONG HO THONG MINH"; bg = [System.Drawing.Color]::DarkOrchid; fg = [System.Drawing.Color]::Gold; text = "7:15 - Xem Gio" },
    @{ name = "sentence-factory"; title = "NHA MAY CAU VAN"; bg = [System.Drawing.Color]::LightSkyBlue; fg = [System.Drawing.Color]::DarkGreen; text = "Em rat yeu truong!" },
    @{ name = "jungle-discovery"; title = "RUNG XANH KY THU"; bg = [System.Drawing.Color]::ForestGreen; fg = [System.Drawing.Color]::Gold; text = "Dong Vat & Thuc Vat" }
)

$outDir = "d:\2026-2027\Cacduanweb\Web\public\images\games"
if (!(Test-Path $outDir)) {
    New-Item -ItemType Directory -Path $outDir -Force | Out-Null
}

$cwebp = "libwebp_tools\libwebp-1.3.2-windows-x64\bin\cwebp.exe"
$dwebp = "libwebp_tools\libwebp-1.3.2-windows-x64\bin\dwebp.exe"

Write-Host "🎨 Bat dau render va ma hoa 10 anh WebP binary real 1280x720..."

foreach ($g in $games) {
    $width = 1280
    $height = 720

    $bmp = New-Object System.Drawing.Bitmap($width, $height)
    $graphics = [System.Drawing.Graphics]::FromImage($bmp)
    $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias

    # Background
    $graphics.Clear($g.bg)

    # Outer Decorative Border
    $borderPen = New-Object System.Drawing.Pen([System.Drawing.Color]::White, 16)
    $graphics.DrawRectangle($borderPen, 20, 20, $width - 40, $height - 40)

    # Banner Box
    $bannerBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(230, 255, 255, 255))
    $graphics.FillRectangle($bannerBrush, 150, 100, 980, 140)
    $bannerPen = New-Object System.Drawing.Pen($g.fg, 8)
    $graphics.DrawRectangle($bannerPen, 150, 100, 980, 140)

    # Title Text
    $titleFont = New-Object System.Drawing.Font("Arial", 42, [System.Drawing.FontStyle]::Bold)
    $titleBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(30, 41, 59))
    $sf = New-Object System.Drawing.StringFormat
    $sf.Alignment = [System.Drawing.StringAlignment]::Center
    $sf.LineAlignment = [System.Drawing.StringAlignment]::Center
    $graphics.DrawString($g.title, $titleFont, $titleBrush, (New-Object System.Drawing.RectangleF(150, 100, 980, 140)), $sf)

    # Feature Graphic Box
    $boxBrush = New-Object System.Drawing.SolidBrush($g.fg)
    $graphics.FillRectangle($boxBrush, 200, 320, 880, 280)
    $boxPen = New-Object System.Drawing.Pen([System.Drawing.Color]::White, 6)
    $graphics.DrawRectangle($boxPen, 200, 320, 880, 280)

    # Feature Text
    $textFont = New-Object System.Drawing.Font("Arial", 46, [System.Drawing.FontStyle]::Bold)
    $textBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::White)
    $graphics.DrawString($g.text, $textFont, $textBrush, (New-Object System.Drawing.RectangleF(200, 320, 880, 280)), $sf)

    $graphics.Dispose()

    # Save PNG temporary
    $tempPng = Join-Path $env:TEMP "$($g.name).png"
    $bmp.Save($tempPng, [System.Drawing.Imaging.ImageFormat]::Png)
    $bmp.Dispose()

    # Convert PNG to REAL WebP binary using cwebp
    $targetWebp = Join-Path $outDir "$($g.name).webp"
    & $cwebp -q 85 $tempPng -o $targetWebp | Out-Null

    Remove-Item $tempPng -ErrorAction SilentlyContinue

    # Verify decoding with dwebp
    $tempDecoded = Join-Path $env:TEMP "$($g.name)_decoded.png"
    & $dwebp $targetWebp -o $tempDecoded | Out-Null

    if (Test-Path $tempDecoded) {
        $size = (Get-Item $targetWebp).Length
        Write-Host "  ✅ $($g.name).webp: $size bytes | Giai ma va khoi tao pixel thanh cong 100%!"
        Remove-Item $tempDecoded -ErrorAction SilentlyContinue
    } else {
        Write-Error "  ❌ Giai ma $($g.name).webp THAT BAI!"
    }
}

Write-Host "🎉 Hoan thanh render va kiem tra 10/10 anh WebP real!"
