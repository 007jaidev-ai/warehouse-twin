param([string]$Src = "C:\Users\ASUS\Documents\Studies\ElectroSolve\ElectroSolve_2026_Warehouse_Digital_Twin.pptx",
      [string]$Out = "C:\Users\ASUS\Documents\Studies\ElectroSolve\build\render")
New-Item -ItemType Directory -Force $Out | Out-Null
$ppt = New-Object -ComObject PowerPoint.Application
$p = $ppt.Presentations.Open($Src, 0, 0, 0)
$p.Export($Out, "PNG", 1600, 900)
"slides: " + $p.Slides.Count
foreach ($s in $p.Slides) { "{0}: effect={1} dur={2}" -f $s.SlideIndex, $s.SlideShowTransition.EntryEffect, $s.SlideShowTransition.Duration }
$p.Close()
# only quit PowerPoint if we were its only user (never close someone's open decks)
if ($ppt.Presentations.Count -eq 0) { $ppt.Quit() }
