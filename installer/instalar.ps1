# Nexus installer — windowed setup for friends (no Python required)
if ([Threading.Thread]::CurrentThread.GetApartmentState() -ne "STA") {
    & powershell -NoProfile -STA -ExecutionPolicy Bypass -File $PSCommandPath @args
    exit $LASTEXITCODE
}
$ErrorActionPreference = "Stop"
Add-Type -AssemblyName PresentationFramework
Add-Type -AssemblyName PresentationCore
Add-Type -AssemblyName WindowsBase
Add-Type -AssemblyName System.Drawing

$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$defaultUrl = "https://nexus-ca9i.onrender.com"
$urlFile = Join-Path $here "app.url"
$cloudUrl = $defaultUrl
if (Test-Path $urlFile) {
    $line = (Get-Content -LiteralPath $urlFile -TotalCount 1).Trim()
    if ($line) { $cloudUrl = $line }
}

$installDir = Join-Path $env:LOCALAPPDATA "Nexus"
$profileDir = Join-Path $installDir "profile"
$iconPath = Join-Path $installDir "nexus.ico"
$pngPath = Join-Path $installDir "nexus.png"

function Find-Browser {
    $candidates = @(
        "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe",
        "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe",
        "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
        "$env:LocalAppData\Google\Chrome\Application\chrome.exe"
    )
    foreach ($p in $candidates) {
        if (Test-Path -LiteralPath $p) { return $p }
    }
    return $null
}

function Save-NexusIcon {
    $bmp = New-Object System.Drawing.Bitmap 256, 256
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::ClearTypeGridFit
    $g.Clear([System.Drawing.Color]::FromArgb(7, 8, 13))

    $path = New-Object System.Drawing.Drawing2D.GraphicsPath
    $r = 58
    $path.AddArc(8, 8, $r, $r, 180, 90)
    $path.AddArc(256 - 8 - $r, 8, $r, $r, 270, 90)
    $path.AddArc(256 - 8 - $r, 256 - 8 - $r, $r, $r, 0, 90)
    $path.AddArc(8, 256 - 8 - $r, $r, $r, 90, 90)
    $path.CloseFigure()

    $brush = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
        (New-Object System.Drawing.Point 20, 8),
        (New-Object System.Drawing.Point 236, 248),
        [System.Drawing.Color]::FromArgb(123, 147, 255),
        [System.Drawing.Color]::FromArgb(61, 92, 240)
    )
    $g.FillPath($brush, $path)

    $font = New-Object System.Drawing.Font "Segoe UI", 110, ([System.Drawing.FontStyle]::Bold)
    $sf = New-Object System.Drawing.StringFormat
    $sf.Alignment = [System.Drawing.StringAlignment]::Center
    $sf.LineAlignment = [System.Drawing.StringAlignment]::Center
    $g.DrawString("N", $font, [System.Drawing.Brushes]::White, (New-Object System.Drawing.RectangleF 0, 8, 256, 248), $sf)
    $g.Dispose()

    $bmp.Save($pngPath, [System.Drawing.Imaging.ImageFormat]::Png)

    $png = [IO.File]::ReadAllBytes($pngPath)
    $fs = [IO.File]::Create($iconPath)
    $bw = New-Object IO.BinaryWriter $fs
    $bw.Write([uint16]0)
    $bw.Write([uint16]1)
    $bw.Write([uint16]1)
    $bw.Write([byte]0)
    $bw.Write([byte]0)
    $bw.Write([byte]0)
    $bw.Write([byte]0)
    $bw.Write([uint16]1)
    $bw.Write([uint16]32)
    $bw.Write([uint32]$png.Length)
    $bw.Write([uint32]22)
    $bw.Write($png)
    $bw.Close()
    $bmp.Dispose()
}

function Install-Nexus {
    param([System.Windows.Controls.ProgressBar]$Bar, [System.Windows.Controls.TextBlock]$Status)

    $browser = Find-Browser
    if (-not $browser) {
        throw "Nao achei o Microsoft Edge nem o Chrome. Instale o Edge e tente de novo."
    }

    $Status.Text = "Preparando pasta..."
    $Bar.Value = 15
    New-Item -ItemType Directory -Force -Path $installDir | Out-Null
    New-Item -ItemType Directory -Force -Path $profileDir | Out-Null

    $Status.Text = "Criando icone..."
    $Bar.Value = 35
    Save-NexusIcon

    $Status.Text = "Escrevendo atalho..."
    $Bar.Value = 60
    Set-Content -LiteralPath (Join-Path $installDir "app.url") -Value $cloudUrl -Encoding UTF8

    $launcher = Join-Path $installDir "Nexus.vbs"
    $vbs = @"
Set sh = CreateObject("WScript.Shell")
sh.Run Chr(34) & "$browser" & Chr(34) & " --app=" & Chr(34) & "$cloudUrl" & Chr(34) & " --user-data-dir=" & Chr(34) & "$profileDir" & Chr(34), 1, False
"@
    Set-Content -LiteralPath $launcher -Value $vbs -Encoding ASCII

    $uninst = Join-Path $installDir "desinstalar.bat"
    $uninstBody = @"
@echo off
taskkill /f /im msedge.exe /fi "WINDOWTITLE eq Nexus*" >nul 2>&1
rmdir /s /q "%LOCALAPPDATA%\Nexus"
del /q "%USERPROFILE%\Desktop\Nexus.lnk" 2>nul
del /q "%APPDATA%\Microsoft\Windows\Start Menu\Programs\Nexus.lnk" 2>nul
echo Nexus removido.
pause
"@
    Set-Content -LiteralPath $uninst -Value $uninstBody -Encoding ASCII

    $wsh = New-Object -ComObject WScript.Shell
    $desktop = [Environment]::GetFolderPath("Desktop")
    $start = Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs"
    foreach ($dest in @((Join-Path $desktop "Nexus.lnk"), (Join-Path $start "Nexus.lnk"))) {
        $sc = $wsh.CreateShortcut($dest)
        $sc.TargetPath = $browser
        $sc.Arguments = "--app=`"$cloudUrl`" --user-data-dir=`"$profileDir`""
        $sc.WorkingDirectory = $installDir
        $sc.WindowStyle = 1
        $sc.Description = "Nexus"
        $sc.IconLocation = "$iconPath,0"
        $sc.Save()
    }

    $Status.Text = "Pronto."
    $Bar.Value = 100
}

if ($args -contains "-Silent") {
    $bar = New-Object System.Windows.Controls.ProgressBar
    $status = New-Object System.Windows.Controls.TextBlock
    Install-Nexus -Bar $bar -Status $status
    exit 0
}

[xml]$xaml = @"
<Window xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation"
        xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml"
        Title="Nexus"
        Width="820" Height="520"
        WindowStartupLocation="CenterScreen"
        WindowStyle="None"
        AllowsTransparency="True"
        Background="Transparent"
        ResizeMode="NoResize">
  <Window.Resources>
    <Style x:Key="Ghost" TargetType="Button">
      <Setter Property="Background" Value="Transparent"/>
      <Setter Property="Foreground" Value="#9AA0B5"/>
      <Setter Property="BorderThickness" Value="0"/>
      <Setter Property="FontSize" Value="18"/>
      <Setter Property="Cursor" Value="Hand"/>
      <Setter Property="Template">
        <Setter.Value>
          <ControlTemplate TargetType="Button">
            <Border Background="{TemplateBinding Background}" CornerRadius="8" Padding="8,2">
              <ContentPresenter HorizontalAlignment="Center" VerticalAlignment="Center"/>
            </Border>
          </ControlTemplate>
        </Setter.Value>
      </Setter>
    </Style>
    <Style x:Key="Primary" TargetType="Button">
      <Setter Property="Foreground" Value="White"/>
      <Setter Property="FontWeight" Value="SemiBold"/>
      <Setter Property="FontSize" Value="15"/>
      <Setter Property="Cursor" Value="Hand"/>
      <Setter Property="BorderThickness" Value="0"/>
      <Setter Property="Template">
        <Setter.Value>
          <ControlTemplate TargetType="Button">
            <Border Background="#5B7CFA" CornerRadius="12" Padding="22,12">
              <ContentPresenter HorizontalAlignment="Center" VerticalAlignment="Center"/>
            </Border>
          </ControlTemplate>
        </Setter.Value>
      </Setter>
    </Style>
  </Window.Resources>
  <Border CornerRadius="20" Background="#0B0D14" BorderBrush="#28FFFFFF" BorderThickness="1">
    <Border.Effect>
      <DropShadowEffect BlurRadius="28" ShadowDepth="0" Color="#000000" Opacity="0.55"/>
    </Border.Effect>
    <Grid>
      <Grid.ColumnDefinitions>
        <ColumnDefinition Width="300"/>
        <ColumnDefinition Width="*"/>
      </Grid.ColumnDefinitions>

      <Border Grid.Column="0" CornerRadius="20,0,0,20">
        <Border.Background>
          <LinearGradientBrush StartPoint="0,0" EndPoint="1,1">
            <GradientStop Color="#1A2250" Offset="0"/>
            <GradientStop Color="#12141C" Offset="1"/>
          </LinearGradientBrush>
        </Border.Background>
        <Grid Margin="32">
          <StackPanel VerticalAlignment="Center">
            <Border Width="56" Height="56" CornerRadius="16" Background="#5B7CFA" HorizontalAlignment="Left">
              <TextBlock Text="N" Foreground="White" FontSize="28" FontWeight="Bold"
                         HorizontalAlignment="Center" VerticalAlignment="Center"/>
            </Border>
            <TextBlock Text="Nexus" Foreground="White" FontSize="34" FontWeight="Bold" Margin="0,22,0,6"/>
            <TextBlock TextWrapping="Wrap" Foreground="#A8B0C8" FontSize="14" LineHeight="22"
                       Text="O espaco do seu grupo. Chat, voz e convites numa janela so."/>
          </StackPanel>
          <TextBlock VerticalAlignment="Bottom" Foreground="#66708A" FontSize="11" Text="Instalacao local • sem Python"/>
        </Grid>
      </Border>

      <Grid Grid.Column="1" Margin="36,20,28,28">
        <Grid.RowDefinitions>
          <RowDefinition Height="Auto"/>
          <RowDefinition Height="*"/>
          <RowDefinition Height="Auto"/>
        </Grid.RowDefinitions>
        <DockPanel Grid.Row="0">
          <Button x:Name="CloseBtn" Style="{StaticResource Ghost}" Content="✕" DockPanel.Dock="Right"/>
          <TextBlock/>
        </DockPanel>

        <StackPanel Grid.Row="1" VerticalAlignment="Center" x:Name="WelcomePanel">
          <TextBlock Text="Instalar o app" Foreground="White" FontSize="28" FontWeight="Bold"/>
          <TextBlock Margin="0,10,0,0" TextWrapping="Wrap" Foreground="#9AA0B5" FontSize="14" LineHeight="22"
                     Text="Cria um atalho no Desktop e no Menu Iniciar. Seus amigos abrem o Nexus como um programa, sem navegador cheio de abas."/>
          <TextBlock Margin="0,22,0,6" Foreground="#6E7890" FontSize="11" Text="DESTINO"/>
          <TextBlock Foreground="#D5DBEA" FontSize="13" Text="$env:LOCALAPPDATA\Nexus"/>
        </StackPanel>

        <StackPanel Grid.Row="1" VerticalAlignment="Center" x:Name="ProgressPanel" Visibility="Collapsed">
          <TextBlock x:Name="StatusText" Text="Instalando..." Foreground="White" FontSize="22" FontWeight="SemiBold"/>
          <ProgressBar x:Name="Bar" Height="8" Margin="0,22,0,0" Minimum="0" Maximum="100" Value="8"
                       Foreground="#5B7CFA" Background="#1C2030" BorderThickness="0"/>
        </StackPanel>

        <StackPanel Grid.Row="1" VerticalAlignment="Center" x:Name="DonePanel" Visibility="Collapsed">
          <TextBlock Text="Pronto." Foreground="White" FontSize="28" FontWeight="Bold"/>
          <TextBlock Margin="0,10,0,0" TextWrapping="Wrap" Foreground="#9AA0B5" FontSize="14" LineHeight="22"
                     Text="O atalho Nexus esta na area de trabalho. A primeira abertura pode demorar um pouco se o servidor estiver acordando."/>
        </StackPanel>

        <DockPanel Grid.Row="2">
          <Button x:Name="PrimaryBtn" Style="{StaticResource Primary}" Content="Instalar Nexus" HorizontalAlignment="Right"/>
        </DockPanel>
      </Grid>
    </Grid>
  </Border>
</Window>
"@

$reader = New-Object System.Xml.XmlNodeReader $xaml
$window = [Windows.Markup.XamlReader]::Load($reader)
$window.Add_MouseLeftButtonDown({ $window.DragMove() })

$closeBtn = $window.FindName("CloseBtn")
$primaryBtn = $window.FindName("PrimaryBtn")
$welcome = $window.FindName("WelcomePanel")
$progress = $window.FindName("ProgressPanel")
$done = $window.FindName("DonePanel")
$bar = $window.FindName("Bar")
$status = $window.FindName("StatusText")

$script:phase = "welcome"
$closeBtn.Add_Click({ $window.Close() })

$primaryBtn.Add_Click({
    if ($script:phase -eq "done") {
        $launcher = Join-Path $installDir "Nexus.vbs"
        if (Test-Path $launcher) { Start-Process wscript.exe -ArgumentList "`"$launcher`"" }
        $window.Close()
        return
    }
    $welcome.Visibility = "Collapsed"
    $progress.Visibility = "Visible"
    $primaryBtn.IsEnabled = $false
    $primaryBtn.Content = "Aguarde..."
    $window.Dispatcher.Invoke([Action]{}, "Background")
    try {
        Install-Nexus -Bar $bar -Status $status
        $progress.Visibility = "Collapsed"
        $done.Visibility = "Visible"
        $primaryBtn.IsEnabled = $true
        $primaryBtn.Content = "Abrir o Nexus"
        $script:phase = "done"
    } catch {
        [System.Windows.MessageBox]::Show("$($_.Exception.Message)", "Nexus", "OK", "Error") | Out-Null
        $progress.Visibility = "Collapsed"
        $welcome.Visibility = "Visible"
        $primaryBtn.IsEnabled = $true
        $primaryBtn.Content = "Tentar de novo"
        $script:phase = "welcome"
    }
})

[void]$window.ShowDialog()
