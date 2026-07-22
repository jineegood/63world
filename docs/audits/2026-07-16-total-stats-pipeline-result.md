# Total Stats Pipeline Result

## Outcome

Three versioned `computeTotalStats` wrappers and their aliases were removed. Total stats now use one explicit prepare/base/modifier pipeline.

## Preserved calculation order

1. V27 normalizes legacy pet, enhancement, and equipment fields.
2. Base calculation adds class, equipment, accessory possession, skill, flat skill, and frenzy effects.
3. V19 adds the original specialization bonus.
4. V23 adds the stronger specialization bonus cumulatively.
5. V27 adds the active-pet and weapon-enhancement bonuses.

## Bug fixed

With missing legacy equipment data, the former V27 wrapper calculated before normalizing fields. The first call omitted the default weapon (`힘 8`) and the second included it (`힘 9`). Preparation now runs first, so both calls return the same complete result.

## Verification

- Valid pre-refactor browser capture: 13 passed, 0 failed.
- Confirmed regression before fix: 13 passed, 1 failed; first and second strength differed.
- Focused pipeline after fix: 7 passed, 0 failed.
- Browser behavior after fix: 14 passed, 0 failed.
- HUD pipeline: 7 passed, 0 failed.
- Weapon tier: 4 passed, 0 failed.
- Combat rules: 18 passed, 0 failed.
- Full `npm.cmd test`: **205 passed, 0 failed** in **135.7 seconds**.

## File evidence

- `game.js`: 571,703 bytes; SHA-256 `3BEE759F478E92CA13F3A80A0798C596DD401956FD43695D111EC34381BC7EED`.
- `src/total-stats-pipeline.js`: 1,960 bytes; SHA-256 `1182361BD8526084E02CFC6F897D7935F3030F88D3838F939F3412438B2E8C79`.
- `tests/total-stats-pipeline.test.mjs`: 5,018 bytes; SHA-256 `6F4C2C17CCED45B9F61EA64BC17AC18E95B73CD3959D1E7AFF26F18E93CCAD52`.
- Remaining versioned function assignments: 129.
- Source scan: 0 `computeTotalStatsV*` assignments and 0 `oldComputeTotalStatsV*` aliases.

## Recovery

- Pre-change: `backups/2026-07-16-pre-total-stats-pipeline.zip`, SHA-256 `BFB47CAFF36AB5B5F0DE4F03D7D9CC1D73F9DFF06E161309250225752AE0BE91`.
- Post-change: see `backups/2026-07-16-post-total-stats-pipeline.sha256.txt`.
