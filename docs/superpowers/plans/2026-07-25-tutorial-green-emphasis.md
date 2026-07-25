# Tutorial Green Emphasis Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Highlight approved controls, NPC names, combat phrases, and numeric milestones in the first-character tutorial with the same bold green treatment used by quest text.

**Architecture:** Keep the tutorial's trusted static HTML structure and add a tiny explicit renderer for highlighted text fragments rather than running a one-character regex over raw HTML. Reuse the existing `quest-keyword-green` CSS class so no parallel color system is introduced.

**Tech Stack:** Browser JavaScript, Node.js test runner, existing modal and quest-highlight CSS

## Global Constraints

- Highlight only the approved phrases: `명진쌤`, `W A S D`, `방향키`, `E`, `N`, `C`, `문제를 맞히면 공격`, and `5레벨`.
- Do not search or replace inside raw HTML strings.
- Do not highlight one-letter shortcuts inside unrelated Korean or HTML text.
- Preserve the existing three-step tutorial, buttons, modal behavior, and one-time character-creation trigger.

---

### Task 1: Explicit Tutorial Highlight Markup

**Files:**
- Modify: `src/tutorial.js`
- Create: `tests/tutorial-highlight-v1.test.mjs`
- Modify: `tools/run-baseline.ps1`
- Modify: `package.json`

**Interfaces:**
- Consumes: Trusted static tutorial copy and the existing `.quest-keyword-green` CSS class.
- Produces: `tutorialGreenV1(text): string`, used only with hard-coded tutorial phrases.

- [ ] **Step 1: Write the failing tutorial markup test**

Create `tests/tutorial-highlight-v1.test.mjs`:

```js
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';

const root = path.resolve(import.meta.dirname, '..');
const source = fs.readFileSync(path.join(root, 'src/tutorial.js'), 'utf8');

test('first-character tutorial uses explicit quest-green emphasis', () => {
  const opened = [];
  const window = {
    openModal:(html, options) => opened.push({ html, options }),
  };
  vm.runInNewContext(source, { window });
  window.startTutorialV53();
  window.__tutorialStepV53(1);
  window.__tutorialStepV53(2);
  const html = opened.map((entry) => entry.html).join('\n');
  for (const text of ['명진쌤', 'W A S D', '방향키', 'E', 'N', 'C', '문제를 맞히면 공격', '5레벨']) {
    assert.match(html, new RegExp(`quest-keyword-green[^>]*>${text.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')}<`));
  }
  assert.doesNotMatch(html, /<strong[^>]*><strong/);
});

test('tutorial green helper escapes text and never accepts raw html', () => {
  const window = {};
  vm.runInNewContext(source, { window });
  assert.equal(
    window.tutorialGreenV1('<img src=x>'),
    '<strong class="quest-keyword-green">&lt;img src=x&gt;</strong>',
  );
});
```

- [ ] **Step 2: Run the test and verify the red state**

Run:

```powershell
node --test tests/tutorial-highlight-v1.test.mjs
```

Expected: FAIL because `tutorialGreenV1` and explicit green spans do not exist.

- [ ] **Step 3: Implement the safe explicit helper and replace approved phrases**

At the top of `src/tutorial.js`, inside the IIFE, add:

```js
  function escapeTutorialTextV1(value) {
    return String(value ?? '').replace(/[&<>"']/g, (char) => ({
      '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;',
    })[char]);
  }
  function tutorialGreenV1(value) {
    return `<strong class="quest-keyword-green">${escapeTutorialTextV1(value)}</strong>`;
  }
  window.tutorialGreenV1 = tutorialGreenV1;
```

Build the existing `STEPS` bodies with explicit helper calls, for example:

```js
body: `<p>여기는 문제를 풀며 성장하는 세계입니다.</p>
  <p class="muted">먼저 ${tutorialGreenV1('명진쌤')}에게 가서 말을 걸어 첫 번째 퀘스트를 받아보세요.</p>`
```

```js
<li>${tutorialGreenV1('W A S D')} 또는 ${tutorialGreenV1('방향키')} — 캐릭터 이동</li>
<li>${tutorialGreenV1('E')} — NPC·문·포탈과 상호작용</li>
<li>${tutorialGreenV1('N')} — 스킬창 / ${tutorialGreenV1('C')} — 장비창</li>
```

```js
<p>몬스터에게 다가가면 전투가 시작됩니다. ${tutorialGreenV1('문제를 맞히면 공격')}하고, 틀리면 반격을 받아요.</p>
<p class="muted">${tutorialGreenV1('5레벨')}이 되면 전문화를 고를 수 있습니다.</p>
```

- [ ] **Step 4: Register the focused test in the default runner**

Add `tutorial-highlight-v1` to the `ValidateSet` in `tools/run-baseline.ps1`, then add:

```powershell
if ($Mode -eq 'all' -or $Mode -eq 'tutorial-highlight-v1') {
  Invoke-CheckedNode -NodeExe $nodeExe -Arguments @('--test', 'tests/tutorial-highlight-v1.test.mjs')
}
```

Add to `package.json`:

```json
"test:tutorial-highlight-v1": "powershell -NoProfile -ExecutionPolicy Bypass -File tools/run-baseline.ps1 tutorial-highlight-v1"
```

- [ ] **Step 5: Run focused and baseline tests**

Run:

```powershell
npm.cmd run test:tutorial-highlight-v1
npm.cmd run test:baseline
```

Expected: Both commands exit `0`; the focused file reports two passing tests.

- [ ] **Step 6: Commit**

```powershell
git add -- src/tutorial.js tests/tutorial-highlight-v1.test.mjs tools/run-baseline.ps1 package.json
git commit -m "feat: highlight first tutorial guidance"
```
