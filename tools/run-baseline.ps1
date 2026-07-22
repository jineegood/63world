param(
  [ValidateSet('all', 'check', 'baseline', 'core-utils', 'player-store', 'input-router', 'world-interaction-registry', 'world-navigation-registry', 'world-render-pipeline', 'hud-update-pipeline', 'total-stats-pipeline', 'combat-entry-pipeline', 'combat-frame-pipeline', 'audio-volume-pipeline', 'combat-rules', 'combat-sequence-controller', 'combat-flow', 'combat-fx', 'sfx-map', 'audio-manifest', 'audio-dispatcher', 'weapon-tier', 'game-data', 'quest-data', 'patch-data', 'refactor-health', 'current-data', 'safety-net', 'extract-data', 'build-workbook')]
  [string]$Mode = 'all'
)

$ErrorActionPreference = 'Stop'

function Resolve-Node {
  $systemNode = Get-Command node -ErrorAction SilentlyContinue
  if ($systemNode) {
    return $systemNode.Source
  }

  $bundledNode = Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe'
  if (Test-Path -LiteralPath $bundledNode) {
    return $bundledNode
  }

  throw 'Node.js executable not found. Install Node.js or run inside the Codex desktop runtime.'
}

function Ensure-ToolNodeModules {
  $link = Join-Path $PSScriptRoot 'node_modules'
  if (Test-Path -LiteralPath $link) {
    return
  }

  $target = Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\node\node_modules'
  if (!(Test-Path -LiteralPath $target)) {
    throw 'Bundled node_modules directory not found. Run inside the Codex desktop runtime.'
  }

  New-Item -ItemType Junction -Path $link -Target $target | Out-Null
}

function Invoke-CheckedNode {
  param(
    [string]$NodeExe,
    [string[]]$Arguments
  )

  & $NodeExe @Arguments
  if ($LASTEXITCODE -ne 0) {
    exit $LASTEXITCODE
  }
}

$nodeExe = Resolve-Node

if ($Mode -eq 'extract-data') {
  Invoke-CheckedNode -NodeExe $nodeExe -Arguments @('tools/extract-game-data.mjs')
}

if ($Mode -eq 'build-workbook') {
  Ensure-ToolNodeModules
  Invoke-CheckedNode -NodeExe $nodeExe -Arguments @('tools/build-current-workbook.mjs')
}

if ($Mode -eq 'all' -or $Mode -eq 'check') {
  Invoke-CheckedNode -NodeExe $nodeExe -Arguments @('--check', 'src/core-utils.js')
  Invoke-CheckedNode -NodeExe $nodeExe -Arguments @('--check', 'src/player-store.js')
  Invoke-CheckedNode -NodeExe $nodeExe -Arguments @('--check', 'src/input-router.js')
  Invoke-CheckedNode -NodeExe $nodeExe -Arguments @('--check', 'src/world-interaction-registry.js')
  Invoke-CheckedNode -NodeExe $nodeExe -Arguments @('--check', 'src/world-navigation-registry.js')
  Invoke-CheckedNode -NodeExe $nodeExe -Arguments @('--check', 'src/world-render-pipeline.js')
  Invoke-CheckedNode -NodeExe $nodeExe -Arguments @('--check', 'src/hud-update-pipeline.js')
  Invoke-CheckedNode -NodeExe $nodeExe -Arguments @('--check', 'src/total-stats-pipeline.js')
  Invoke-CheckedNode -NodeExe $nodeExe -Arguments @('--check', 'src/combat-entry-pipeline.js')
  Invoke-CheckedNode -NodeExe $nodeExe -Arguments @('--check', 'src/combat-frame-pipeline.js')
  Invoke-CheckedNode -NodeExe $nodeExe -Arguments @('--check', 'src/audio-volume-pipeline.js')
  if (Test-Path -LiteralPath 'src/game-data.js') {
    Invoke-CheckedNode -NodeExe $nodeExe -Arguments @('--check', 'src/game-data.js')
  }
  if (Test-Path -LiteralPath 'src/quest-data.js') {
    Invoke-CheckedNode -NodeExe $nodeExe -Arguments @('--check', 'src/quest-data.js')
  }
  if (Test-Path -LiteralPath 'src/patch-data.js') {
    Invoke-CheckedNode -NodeExe $nodeExe -Arguments @('--check', 'src/patch-data.js')
  }
  if (Test-Path -LiteralPath 'src/combat-rules.js') {
    Invoke-CheckedNode -NodeExe $nodeExe -Arguments @('--check', 'src/combat-rules.js')
  }
  Invoke-CheckedNode -NodeExe $nodeExe -Arguments @('--check', 'src/combat-sequence-controller.js')
  if (Test-Path -LiteralPath 'src/combat-fx.js') {
    Invoke-CheckedNode -NodeExe $nodeExe -Arguments @('--check', 'src/combat-fx.js')
  }
  Invoke-CheckedNode -NodeExe $nodeExe -Arguments @('--check', 'src/audio-manifest.js')
  Invoke-CheckedNode -NodeExe $nodeExe -Arguments @('--check', 'src/audio-dispatcher.js')
  Invoke-CheckedNode -NodeExe $nodeExe -Arguments @('--check', 'game.js')
  Invoke-CheckedNode -NodeExe $nodeExe -Arguments @('--check', 'src/admin-dashboard.js')
  Invoke-CheckedNode -NodeExe $nodeExe -Arguments @('--check', 'src/combat-keys.js')
  Invoke-CheckedNode -NodeExe $nodeExe -Arguments @('--check', 'src/ui-tooltip.js')
  Invoke-CheckedNode -NodeExe $nodeExe -Arguments @('--check', 'src/map-decor.js')
  Invoke-CheckedNode -NodeExe $nodeExe -Arguments @('--check', 'src/ultimate-fx.js')
  Invoke-CheckedNode -NodeExe $nodeExe -Arguments @('--check', 'src/sfx-map.js')
  Invoke-CheckedNode -NodeExe $nodeExe -Arguments @('--check', 'src/skillpoint-hint.js')
  Invoke-CheckedNode -NodeExe $nodeExe -Arguments @('--check', 'src/cheat-panel.js')
  Invoke-CheckedNode -NodeExe $nodeExe -Arguments @('--check', 'src/hall-of-fame.js')
  Invoke-CheckedNode -NodeExe $nodeExe -Arguments @('--check', 'src/cloud-config.js')
  Invoke-CheckedNode -NodeExe $nodeExe -Arguments @('--check', 'src/cloud-sync.js')
  Invoke-CheckedNode -NodeExe $nodeExe -Arguments @('--check', 'src/multiplayer.js')
  Invoke-CheckedNode -NodeExe $nodeExe -Arguments @('--check', 'src/tutorial.js')
  Invoke-CheckedNode -NodeExe $nodeExe -Arguments @('--check', 'src/costume-data.js')
  Invoke-CheckedNode -NodeExe $nodeExe -Arguments @('--check', 'src/costume-ui.js')
}

if ($Mode -eq 'all' -or $Mode -eq 'baseline') {
  Invoke-CheckedNode -NodeExe $nodeExe -Arguments @('--test', 'tests/baseline.test.mjs')
}

if ($Mode -eq 'all' -or $Mode -eq 'core-utils') {
  Invoke-CheckedNode -NodeExe $nodeExe -Arguments @('--test', 'tests/core-utils.test.mjs')
}

if ($Mode -eq 'all' -or $Mode -eq 'player-store') {
  Invoke-CheckedNode -NodeExe $nodeExe -Arguments @('--test', 'tests/player-store.test.mjs')
}

if ($Mode -eq 'all' -or $Mode -eq 'input-router') {
  Invoke-CheckedNode -NodeExe $nodeExe -Arguments @('--test', 'tests/input-router.test.mjs')
}

if ($Mode -eq 'all' -or $Mode -eq 'world-interaction-registry') {
  Invoke-CheckedNode -NodeExe $nodeExe -Arguments @('--test', 'tests/world-interaction-registry.test.mjs')
}

if ($Mode -eq 'all' -or $Mode -eq 'world-navigation-registry') {
  Invoke-CheckedNode -NodeExe $nodeExe -Arguments @('--test', 'tests/world-navigation-registry.test.mjs')
}

if ($Mode -eq 'all' -or $Mode -eq 'world-render-pipeline') {
  Invoke-CheckedNode -NodeExe $nodeExe -Arguments @('--test', 'tests/world-render-pipeline.test.mjs')
}

if ($Mode -eq 'all' -or $Mode -eq 'hud-update-pipeline') {
  Invoke-CheckedNode -NodeExe $nodeExe -Arguments @('--test', 'tests/hud-update-pipeline.test.mjs')
}

if ($Mode -eq 'all' -or $Mode -eq 'total-stats-pipeline') {
  Invoke-CheckedNode -NodeExe $nodeExe -Arguments @('--test', 'tests/total-stats-pipeline.test.mjs')
}

if ($Mode -eq 'all' -or $Mode -eq 'combat-entry-pipeline') {
  Invoke-CheckedNode -NodeExe $nodeExe -Arguments @('--test', 'tests/combat-entry-pipeline.test.mjs')
}

if ($Mode -eq 'all' -or $Mode -eq 'combat-frame-pipeline') {
  Invoke-CheckedNode -NodeExe $nodeExe -Arguments @('--test', 'tests/combat-frame-pipeline.test.mjs')
}

if ($Mode -eq 'all' -or $Mode -eq 'audio-volume-pipeline') {
  Invoke-CheckedNode -NodeExe $nodeExe -Arguments @('--test', 'tests/audio-volume-pipeline.test.mjs')
}

if ($Mode -eq 'all' -or $Mode -eq 'combat-rules') {
  Invoke-CheckedNode -NodeExe $nodeExe -Arguments @('--test', 'tests/combat-rules.test.mjs')
}

if ($Mode -eq 'all' -or $Mode -eq 'combat-sequence-controller') {
  Invoke-CheckedNode -NodeExe $nodeExe -Arguments @('--test', 'tests/combat-sequence-controller.test.mjs')
}

if ($Mode -eq 'all' -or $Mode -eq 'combat-flow') {
  Invoke-CheckedNode -NodeExe $nodeExe -Arguments @('--test', 'tests/combat-flow.test.mjs')
}

if ($Mode -eq 'all' -or $Mode -eq 'combat-fx') {
  Invoke-CheckedNode -NodeExe $nodeExe -Arguments @('--test', 'tests/combat-fx.test.mjs')
}

if ($Mode -eq 'all' -or $Mode -eq 'sfx-map') {
  Invoke-CheckedNode -NodeExe $nodeExe -Arguments @('--test', 'tests/sfx-map.test.mjs')
}

if ($Mode -eq 'all' -or $Mode -eq 'audio-manifest') {
  Invoke-CheckedNode -NodeExe $nodeExe -Arguments @('--test', 'tests/audio-manifest.test.mjs')
}

if ($Mode -eq 'all' -or $Mode -eq 'audio-dispatcher') {
  Invoke-CheckedNode -NodeExe $nodeExe -Arguments @('--test', 'tests/audio-dispatcher.test.mjs')
}

if ($Mode -eq 'all' -or $Mode -eq 'weapon-tier') {
  Invoke-CheckedNode -NodeExe $nodeExe -Arguments @('--test', 'tests/weapon-tier.test.mjs')
}

if ($Mode -eq 'all' -or $Mode -eq 'game-data') {
  Invoke-CheckedNode -NodeExe $nodeExe -Arguments @('--test', 'tests/game-data.test.mjs')
}

if ($Mode -eq 'all' -or $Mode -eq 'quest-data') {
  Invoke-CheckedNode -NodeExe $nodeExe -Arguments @('--test', 'tests/quest-data.test.mjs')
}

if ($Mode -eq 'all' -or $Mode -eq 'patch-data') {
  Invoke-CheckedNode -NodeExe $nodeExe -Arguments @('--test', 'tests/patch-data.test.mjs')
}

if ($Mode -eq 'all' -or $Mode -eq 'refactor-health') {
  Invoke-CheckedNode -NodeExe $nodeExe -Arguments @('--test', 'tests/refactor-health.test.mjs')
}

if ($Mode -eq 'all' -or $Mode -eq 'current-data') {
  Invoke-CheckedNode -NodeExe $nodeExe -Arguments @('--test', 'tests/current-data.test.mjs')
}

if ($Mode -eq 'all' -or $Mode -eq 'safety-net') {
  Invoke-CheckedNode -NodeExe $nodeExe -Arguments @('--test', 'tests/safety-net.test.mjs')
}
