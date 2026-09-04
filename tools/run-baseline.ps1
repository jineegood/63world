param(
  [ValidateSet('all', 'check', 'baseline', 'core-utils', 'player-store', 'input-router', 'world-interaction-registry', 'raid-dungeon', 'raid-rules', 'raid-run', 'raid-run-ui', 'raid-visual-lab', 'raid-combat-rules', 'raid-entry-ui', 'raid-party-client', 'raid-room-backend', 'raid-multiplayer-integration', 'hall-of-fame-gear', 'world-announcements', 'world-channels', 'swamp-monster-balance', 'world-navigation-registry', 'click-movement', 'click-movement-integration', 'world-render-pipeline', 'hud-update-pipeline', 'total-stats-pipeline', 'combat-entry-pipeline', 'combat-frame-pipeline', 'audio-volume-pipeline', 'combat-rules', 'combat-sequence-controller', 'combat-flow', 'combat-fx', 'sfx-map', 'audio-manifest', 'audio-dispatcher', 'weapon-tier', 'game-data', 'costume-shop', 'quest-data', 'quest-text', 'patch-data', 'gameplay-polish-v2', 'early-game-polish-v2', 'wrong-answer-polish-v2', 'world-healing-polish-v2', 'reward-presentation-v2', 'tutorial-quests-polish-v2', 'tutorial-highlight-v1', 'help-ui', 'multiplayer', 'avatar-visual-sync', 'pvp-rules', 'pvp-policy-v1', 'pvp-function-v1', 'pvp-client', 'pvp-profile-ui', 'pvp-battle-ui', 'pvp-reconnect-v1', 'supabase-security-v2', 'cloud-sync-v2', 'student-access-v2', 'secure-student-login-v2', 'secure-shared-student-v2', 'admin-auth-v2', 'teacher-reset-function', 'secure-teacher-auth-v2', 'secure-shared-teacher-v2', 'admin-data-v2', 'student-reward-grants-v2', 'teacher-delete-function', 'secure-cloud-student-admin-v2', 'shared-state-policy-v2', 'shared-state-v2', 'refactor-health', 'current-data', 'safety-net', 'extract-data', 'build-workbook')]
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
  Invoke-CheckedNode -NodeExe $nodeExe -Arguments @('--check', 'src/production-guard.js')
  Invoke-CheckedNode -NodeExe $nodeExe -Arguments @('--check', 'src/world-interaction-registry.js')
  Invoke-CheckedNode -NodeExe $nodeExe -Arguments @('--check', 'src/world-navigation-registry.js')
  Invoke-CheckedNode -NodeExe $nodeExe -Arguments @('--check', 'src/click-movement.js')
  Invoke-CheckedNode -NodeExe $nodeExe -Arguments @('--check', 'src/world-render-pipeline.js')
  Invoke-CheckedNode -NodeExe $nodeExe -Arguments @('--check', 'src/hud-update-pipeline.js')
  Invoke-CheckedNode -NodeExe $nodeExe -Arguments @('--check', 'src/total-stats-pipeline.js')
  Invoke-CheckedNode -NodeExe $nodeExe -Arguments @('--check', 'src/combat-entry-pipeline.js')
  Invoke-CheckedNode -NodeExe $nodeExe -Arguments @('--check', 'src/combat-frame-pipeline.js')
  Invoke-CheckedNode -NodeExe $nodeExe -Arguments @('--check', 'src/audio-volume-pipeline.js')
  Invoke-CheckedNode -NodeExe $nodeExe -Arguments @('--check', 'src/audio-defaults.js')
  if (Test-Path -LiteralPath 'src/game-data.js') {
    Invoke-CheckedNode -NodeExe $nodeExe -Arguments @('--check', 'src/game-data.js')
  }
  if (Test-Path -LiteralPath 'src/quest-data.js') {
    Invoke-CheckedNode -NodeExe $nodeExe -Arguments @('--check', 'src/quest-data.js')
  }
  Invoke-CheckedNode -NodeExe $nodeExe -Arguments @('--check', 'src/quest-text.js')
  Invoke-CheckedNode -NodeExe $nodeExe -Arguments @('--check', 'src/quest-tutorial-polish-v3.js')
  Invoke-CheckedNode -NodeExe $nodeExe -Arguments @('--check', 'src/quest-dialogue-theme.js')
  Invoke-CheckedNode -NodeExe $nodeExe -Arguments @('--check', 'src/wrong-answer-review.js')
  if (Test-Path -LiteralPath 'src/patch-data.js') {
    Invoke-CheckedNode -NodeExe $nodeExe -Arguments @('--check', 'src/patch-data.js')
  }
  if (Test-Path -LiteralPath 'src/gameplay-polish-v2.js') {
    Invoke-CheckedNode -NodeExe $nodeExe -Arguments @('--check', 'src/gameplay-polish-v2.js')
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
  Invoke-CheckedNode -NodeExe $nodeExe -Arguments @('--check', 'src/avatar-visual-sync.js')
  Invoke-CheckedNode -NodeExe $nodeExe -Arguments @('--check', 'src/admin-dashboard.js')
  Invoke-CheckedNode -NodeExe $nodeExe -Arguments @('--check', 'src/combat-keys.js')
  Invoke-CheckedNode -NodeExe $nodeExe -Arguments @('--check', 'src/ui-tooltip.js')
  Invoke-CheckedNode -NodeExe $nodeExe -Arguments @('--check', 'src/map-decor.js')
  Invoke-CheckedNode -NodeExe $nodeExe -Arguments @('--check', 'src/spec-prompt.js')
  Invoke-CheckedNode -NodeExe $nodeExe -Arguments @('--check', 'src/raid-progress.js')
  Invoke-CheckedNode -NodeExe $nodeExe -Arguments @('--check', 'src/raid-combat-rules.js')
  Invoke-CheckedNode -NodeExe $nodeExe -Arguments @('--check', 'src/raid-rules.js')
  Invoke-CheckedNode -NodeExe $nodeExe -Arguments @('--check', 'src/raid-run.js')
  Invoke-CheckedNode -NodeExe $nodeExe -Arguments @('--check', 'src/raid-nameplates.js')
  Invoke-CheckedNode -NodeExe $nodeExe -Arguments @('--check', 'src/raid-run-ui.js')
  Invoke-CheckedNode -NodeExe $nodeExe -Arguments @('--check', 'tools/raid-visual-lab.js')
  Invoke-CheckedNode -NodeExe $nodeExe -Arguments @('--check', 'src/raid-entry-ui.js')
  Invoke-CheckedNode -NodeExe $nodeExe -Arguments @('--check', 'src/raid-party-client.js')
  Invoke-CheckedNode -NodeExe $nodeExe -Arguments @('--check', 'src/raid-dungeon.js')
  Invoke-CheckedNode -NodeExe $nodeExe -Arguments @('--check', 'src/ultimate-fx.js')
  Invoke-CheckedNode -NodeExe $nodeExe -Arguments @('--check', 'src/sfx-map.js')
  Invoke-CheckedNode -NodeExe $nodeExe -Arguments @('--check', 'src/skillpoint-hint.js')
  Invoke-CheckedNode -NodeExe $nodeExe -Arguments @('--check', 'src/cheat-panel.js')
  Invoke-CheckedNode -NodeExe $nodeExe -Arguments @('--check', 'src/hall-of-fame.js')
  Invoke-CheckedNode -NodeExe $nodeExe -Arguments @('--check', 'src/cloud-config.js')
  Invoke-CheckedNode -NodeExe $nodeExe -Arguments @('--check', 'vendor/supabase-client.bundle.js')
  Invoke-CheckedNode -NodeExe $nodeExe -Arguments @('--check', 'src/cloud-sync.js')
  Invoke-CheckedNode -NodeExe $nodeExe -Arguments @('--check', 'src/auth-v2.js')
  Invoke-CheckedNode -NodeExe $nodeExe -Arguments @('--check', 'src/cloud-sync-v2.js')
  Invoke-CheckedNode -NodeExe $nodeExe -Arguments @('--check', 'src/student-access-v2.js')
  Invoke-CheckedNode -NodeExe $nodeExe -Arguments @('--check', 'src/pvp-client.js')
  Invoke-CheckedNode -NodeExe $nodeExe -Arguments @('--check', 'src/pvp-ui.js')
  Invoke-CheckedNode -NodeExe $nodeExe -Arguments @('--check', 'src/pvp-battle.js')
  Invoke-CheckedNode -NodeExe $nodeExe -Arguments @('--check', 'src/admin-auth-v2.js')
  Invoke-CheckedNode -NodeExe $nodeExe -Arguments @('--check', 'src/admin-data-v2.js')
  Invoke-CheckedNode -NodeExe $nodeExe -Arguments @('--check', 'src/shared-state-v2.js')
  Invoke-CheckedNode -NodeExe $nodeExe -Arguments @('--check', 'src/workbook-import.js')
  Invoke-CheckedNode -NodeExe $nodeExe -Arguments @('--check', 'src/chatgpt-prompt.js')
  Invoke-CheckedNode -NodeExe $nodeExe -Arguments @('--check', 'src/multiplayer-core.js')
  Invoke-CheckedNode -NodeExe $nodeExe -Arguments @('--check', 'src/remote-motion.js')
  Invoke-CheckedNode -NodeExe $nodeExe -Arguments @('--check', 'src/multiplayer.js')
  Invoke-CheckedNode -NodeExe $nodeExe -Arguments @('--check', 'src/world-announcements.js')
  Invoke-CheckedNode -NodeExe $nodeExe -Arguments @('--check', 'src/login-keys.js')
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

if ($Mode -eq 'all' -or $Mode -eq 'hall-of-fame-gear') {
  Invoke-CheckedNode -NodeExe $nodeExe -Arguments @('--test', 'tests/hall-of-fame-gear.test.mjs')
}

if ($Mode -eq 'all' -or $Mode -eq 'world-announcements') {
  Invoke-CheckedNode -NodeExe $nodeExe -Arguments @('--test', 'tests/world-announcements.test.mjs')
}

if ($Mode -eq 'all' -or $Mode -eq 'world-channels') {
  Invoke-CheckedNode -NodeExe $nodeExe -Arguments @('--test', 'tests/world-channels.test.mjs')
}

if ($Mode -eq 'all' -or $Mode -eq 'swamp-monster-balance') {
  Invoke-CheckedNode -NodeExe $nodeExe -Arguments @('--test', 'tests/swamp-monster-balance.test.mjs')
}

if ($Mode -eq 'all' -or $Mode -eq 'raid-rules') {
  Invoke-CheckedNode -NodeExe $nodeExe -Arguments @('--test', 'tests/raid-rules.test.mjs')
}

if ($Mode -eq 'all' -or $Mode -eq 'raid-run') {
  Invoke-CheckedNode -NodeExe $nodeExe -Arguments @('--test', 'tests/raid-run.test.mjs')
}

if ($Mode -eq 'all' -or $Mode -eq 'raid-combat-rules') {
  Invoke-CheckedNode -NodeExe $nodeExe -Arguments @('--test', 'tests/raid-combat-rules.test.mjs')
}

if ($Mode -eq 'all' -or $Mode -eq 'raid-entry-ui') {
  Invoke-CheckedNode -NodeExe $nodeExe -Arguments @('--test', 'tests/raid-entry-ui.test.mjs')
}

if ($Mode -eq 'all' -or $Mode -eq 'raid-party-client') {
  Invoke-CheckedNode -NodeExe $nodeExe -Arguments @('--test', 'tests/raid-party-client.test.mjs')
}

if ($Mode -eq 'all' -or $Mode -eq 'raid-room-backend') {
  Invoke-CheckedNode -NodeExe $nodeExe -Arguments @('--test', 'tests/raid-room-backend.test.mjs')
}

if ($Mode -eq 'all' -or $Mode -eq 'raid-multiplayer-integration') {
  Invoke-CheckedNode -NodeExe $nodeExe -Arguments @('--test', 'tests/raid-multiplayer-integration.test.mjs')
}

if ($Mode -eq 'all' -or $Mode -eq 'raid-run-ui') {
  Invoke-CheckedNode -NodeExe $nodeExe -Arguments @('--test', 'tests/raid-run-ui.test.mjs')
}

if ($Mode -eq 'all' -or $Mode -eq 'raid-visual-lab') {
  Invoke-CheckedNode -NodeExe $nodeExe -Arguments @('--test', 'tests/raid-visual-lab.test.mjs')
}

if ($Mode -eq 'all' -or $Mode -eq 'raid-dungeon') {
  Invoke-CheckedNode -NodeExe $nodeExe -Arguments @('--test', 'tests/raid-dungeon.test.mjs')
}

if ($Mode -eq 'all' -or $Mode -eq 'world-navigation-registry') {
  Invoke-CheckedNode -NodeExe $nodeExe -Arguments @('--test', 'tests/world-navigation-registry.test.mjs')
}

if ($Mode -eq 'all' -or $Mode -eq 'click-movement') {
  Invoke-CheckedNode -NodeExe $nodeExe -Arguments @('--test', 'tests/click-movement.test.mjs')
}

if ($Mode -eq 'all' -or $Mode -eq 'click-movement-integration') {
  Invoke-CheckedNode -NodeExe $nodeExe -Arguments @('--test', 'tests/click-movement-integration.test.mjs')
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

if ($Mode -eq 'all' -or $Mode -eq 'costume-shop') {
  Invoke-CheckedNode -NodeExe $nodeExe -Arguments @('--test', 'tests/costume-shop.test.mjs')
}

if ($Mode -eq 'all' -or $Mode -eq 'quest-data') {
  Invoke-CheckedNode -NodeExe $nodeExe -Arguments @('--test', 'tests/quest-data.test.mjs')
}

if ($Mode -eq 'all' -or $Mode -eq 'quest-text') {
  Invoke-CheckedNode -NodeExe $nodeExe -Arguments @('--test', 'tests/quest-text.test.mjs')
}

if ($Mode -eq 'all' -or $Mode -eq 'patch-data') {
  Invoke-CheckedNode -NodeExe $nodeExe -Arguments @('--test', 'tests/patch-data.test.mjs')
}

if ($Mode -eq 'all' -or $Mode -eq 'gameplay-polish-v2') {
  Invoke-CheckedNode -NodeExe $nodeExe -Arguments @('--test', 'tests/gameplay-polish-v2.test.mjs')
}

if ($Mode -eq 'all' -or $Mode -eq 'early-game-polish-v2') {
  Invoke-CheckedNode -NodeExe $nodeExe -Arguments @('--test', 'tests/early-game-polish-v2.test.mjs')
}

if ($Mode -eq 'all' -or $Mode -eq 'wrong-answer-polish-v2') {
  Invoke-CheckedNode -NodeExe $nodeExe -Arguments @('--test', 'tests/wrong-answer-polish-v2.test.mjs')
}

if ($Mode -eq 'all' -or $Mode -eq 'world-healing-polish-v2') {
  Invoke-CheckedNode -NodeExe $nodeExe -Arguments @('--test', 'tests/world-healing-polish-v2.test.mjs')
}

if ($Mode -eq 'all' -or $Mode -eq 'reward-presentation-v2') {
  Invoke-CheckedNode -NodeExe $nodeExe -Arguments @('--test', 'tests/reward-presentation-v2.test.mjs')
}

if ($Mode -eq 'all' -or $Mode -eq 'tutorial-quests-polish-v2') {
  Invoke-CheckedNode -NodeExe $nodeExe -Arguments @('--test', 'tests/tutorial-quests-polish-v2.test.mjs')
}

if ($Mode -eq 'all' -or $Mode -eq 'tutorial-highlight-v1') {
  Invoke-CheckedNode -NodeExe $nodeExe -Arguments @('--test', 'tests/tutorial-highlight-v1.test.mjs')
}

if ($Mode -eq 'all' -or $Mode -eq 'help-ui') {
  Invoke-CheckedNode -NodeExe $nodeExe -Arguments @('--test', 'tests/help-ui.test.mjs')
}

if ($Mode -eq 'all' -or $Mode -eq 'multiplayer') {
  Invoke-CheckedNode -NodeExe $nodeExe -Arguments @('--test', 'tests/multiplayer.test.mjs')
}

if ($Mode -eq 'all' -or $Mode -eq 'avatar-visual-sync') {
  Invoke-CheckedNode -NodeExe $nodeExe -Arguments @('--test', 'tests/avatar-visual-sync.test.mjs')
}

if ($Mode -eq 'all' -or $Mode -eq 'pvp-rules') {
  Invoke-CheckedNode -NodeExe $nodeExe -Arguments @('--test', 'tests/pvp-rules.test.mjs')
}

if ($Mode -eq 'all' -or $Mode -eq 'pvp-policy-v1') {
  Invoke-CheckedNode -NodeExe $nodeExe -Arguments @('--test', 'tests/pvp-policy-v1.test.mjs')
}

if ($Mode -eq 'all' -or $Mode -eq 'pvp-function-v1') {
  Invoke-CheckedNode -NodeExe $nodeExe -Arguments @('--test', 'tests/pvp-function-v1.test.mjs')
}

if ($Mode -eq 'all' -or $Mode -eq 'pvp-client') {
  Invoke-CheckedNode -NodeExe $nodeExe -Arguments @('--test', 'tests/pvp-client.test.mjs')
}

if ($Mode -eq 'all' -or $Mode -eq 'pvp-profile-ui') {
  Invoke-CheckedNode -NodeExe $nodeExe -Arguments @('--test', 'tests/pvp-profile-ui.test.mjs')
}

if ($Mode -eq 'all' -or $Mode -eq 'pvp-battle-ui') {
  Invoke-CheckedNode -NodeExe $nodeExe -Arguments @('--test', 'tests/pvp-battle-ui.test.mjs')
}

if ($Mode -eq 'all' -or $Mode -eq 'pvp-reconnect-v1') {
  Invoke-CheckedNode -NodeExe $nodeExe -Arguments @('--test', 'tests/pvp-reconnect-v1.test.mjs')
}

if ($Mode -eq 'all' -or $Mode -eq 'supabase-security-v2') {
  Invoke-CheckedNode -NodeExe $nodeExe -Arguments @('--test', 'tests/supabase-security-v2.test.mjs')
}

if ($Mode -eq 'all' -or $Mode -eq 'cloud-sync-v2') {
  Invoke-CheckedNode -NodeExe $nodeExe -Arguments @('--test', 'tests/cloud-sync-v2.test.mjs')
}

if ($Mode -eq 'all' -or $Mode -eq 'student-access-v2') {
  Invoke-CheckedNode -NodeExe $nodeExe -Arguments @('--test', 'tests/student-access-v2.test.mjs')
}

if ($Mode -eq 'all' -or $Mode -eq 'secure-student-login-v2') {
  Invoke-CheckedNode -NodeExe $nodeExe -Arguments @('--test', 'tests/secure-student-login-v2.test.mjs')
}
if ($Mode -eq 'all' -or $Mode -eq 'secure-shared-student-v2') {
  Invoke-CheckedNode -NodeExe $nodeExe -Arguments @('--test', 'tests/secure-shared-student-v2.test.mjs')
}

if ($Mode -eq 'all' -or $Mode -eq 'admin-auth-v2') {
  Invoke-CheckedNode -NodeExe $nodeExe -Arguments @('--test', 'tests/admin-auth-v2.test.mjs')
}

if ($Mode -eq 'all' -or $Mode -eq 'teacher-reset-function') {
  Invoke-CheckedNode -NodeExe $nodeExe -Arguments @('--test', 'tests/teacher-reset-function.test.mjs')
}

if ($Mode -eq 'all' -or $Mode -eq 'secure-teacher-auth-v2') {
  Invoke-CheckedNode -NodeExe $nodeExe -Arguments @('--test', 'tests/secure-teacher-auth-v2.test.mjs')
}
if ($Mode -eq 'all' -or $Mode -eq 'secure-shared-teacher-v2') {
  Invoke-CheckedNode -NodeExe $nodeExe -Arguments @('--test', 'tests/secure-shared-teacher-v2.test.mjs')
}

if ($Mode -eq 'all' -or $Mode -eq 'admin-data-v2') {
  Invoke-CheckedNode -NodeExe $nodeExe -Arguments @('--test', 'tests/admin-data-v2.test.mjs')
}

if ($Mode -eq 'all' -or $Mode -eq 'student-reward-grants-v2') {
  Invoke-CheckedNode -NodeExe $nodeExe -Arguments @('--test', 'tests/student-reward-grants-v2.test.mjs')
}

if ($Mode -eq 'all' -or $Mode -eq 'teacher-delete-function') {
  Invoke-CheckedNode -NodeExe $nodeExe -Arguments @('--test', 'tests/teacher-delete-function.test.mjs')
}

if ($Mode -eq 'all' -or $Mode -eq 'secure-cloud-student-admin-v2') {
  Invoke-CheckedNode -NodeExe $nodeExe -Arguments @('--test', 'tests/secure-cloud-student-admin-v2.test.mjs')
}

if ($Mode -eq 'all' -or $Mode -eq 'shared-state-policy-v2') {
  Invoke-CheckedNode -NodeExe $nodeExe -Arguments @('--test', 'tests/shared-state-policy-v2.test.mjs')
}

if ($Mode -eq 'all' -or $Mode -eq 'shared-state-v2') {
  Invoke-CheckedNode -NodeExe $nodeExe -Arguments @('--test', 'tests/shared-state-v2.test.mjs')
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

# 전용 실행 모드는 없지만 기본 전체 검사에서 반드시 실행해야 하는 독립 검사들.
# 새 테스트가 이 목록을 포함한 러너 어디에도 등록되지 않으면 baseline 검사가 막는다.
if ($Mode -eq 'all') {
  $standaloneTestFiles = @(
    'tests/audio-defaults.test.mjs'
    'tests/chatgpt-prompt.test.mjs'
    'tests/login-bgm-flow.test.mjs'
    'tests/login-keys.test.mjs'
    'tests/production-guard.test.mjs'
    'tests/profile-portrait.test.mjs'
    'tests/profile-security-audit-v1.test.mjs'
    'tests/quest-dialogue-theme.test.mjs'
    'tests/raid-lock-order.test.mjs'
    'tests/raid-pattern-effects.test.mjs'
    'tests/raid-progress.test.mjs'
    'tests/raid-transport-pressure.test.mjs'
    'tests/recovery-ui-features.test.mjs'
    'tests/remote-motion.test.mjs'
    'tests/safe-server-boundary-v2.test.mjs'
    'tests/teacher-cheat-function.test.mjs'
    'tests/teacher-cheat-ui.test.mjs'
    'tests/usability-polish-v62.test.mjs'
    'tests/workbook-import.test.mjs'
    'tests/world-presence-lock.test.mjs'
  )
  foreach ($testFile in $standaloneTestFiles) {
    Invoke-CheckedNode -NodeExe $nodeExe -Arguments @('--test', $testFile)
  }
}
