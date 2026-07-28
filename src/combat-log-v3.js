/* 서버가 보낸 전투 결과를 예전 로컬 전투와 똑같은 '연출 지시서'로 번역한다.
 *
 * 서버 판정으로 바뀌면서 이 번역이 빠져 전투 로그가 통째로 사라졌었다.
 * 순서와 시간 규칙은 이미 있는 것(YuksamCombatRules.buildCombatSequence)을 그대로 태우므로,
 * 여기서는 '어떤 이름표를 달고, 어떤 글자·시간·연출·효과음·데미지 숫자를 붙일지'만 정한다.
 *
 * 화면을 직접 건드리지 않는 순수 계산이다.
 */
(function installCombatLogV3(global) {
  'use strict';

  // game.js의 전투 대기 시간과 같은 값 (여기 한 곳에서만 정의해 서로 어긋나지 않게 한다)
  const DURATIONS = Object.freeze({
    correctAnswer:800,     // CORRECT_ANSWER_NOTICE_DELAY_V48
    wrongAnswer:2200,
    playerAttack:1000,     // PLAYER_ATTACK_NOTICE_DELAY_V46
    skillAttack:2000,      // 스킬은 +1000
    notice:2120,           // COMBAT_NOTICE_DELAY_V25
    dot:2200,              // DOT_NOTICE_DELAY_V25
    support:1000,
  });

  const STATUS_LABELS = Object.freeze({
    stun:'기절',
    chill:'냉기',
    poison:'중독',
    shadow:'암흑',
    burn:'화상',
  });

  const int = (value) => Math.max(0, Math.floor(Number(value) || 0));

  function statusLabel(status) {
    const key = String(status || '').trim();
    return STATUS_LABELS[key] || key;
  }

  /* 서버 이벤트 목록을 예전 형식의 알림 목록으로 바꾼다.
     context: { monsterName, monsterId, correctAnswer, batchId, isSkill, fxProfile, monsterFxProfile, audioId } */
  function translate(serverEvents, context) {
    const events = Array.isArray(serverEvents) ? serverEvents : [];
    const ctx = context || {};
    const monsterName = String(ctx.monsterName || '몬스터');
    const combatId = String(ctx.monsterId || 'combat');
    const batchId = String(ctx.batchId || 'v3');
    const attackDuration = ctx.isSkill ? DURATIONS.skillAttack : DURATIONS.playerAttack;
    const playerFx = ctx.fxProfile || null;
    const monsterFx = ctx.monsterFxProfile || null;

    const notices = [];
    let damagingHits = 0;   // 다단히트에서 몇 번째 타격인지
    let totalDamage = 0;
    let sawMonsterAction = false;

    const effectId = () => `${batchId}:${notices.length}`;

    for (const event of events) {
      const type = String(event?.type || '');
      const amount = int(event?.amount);

      switch (type) {
        case 'answer-correct':
          notices.push({
            type:'answer-correct',
            text:'정답!',
            duration:DURATIONS.correctAnswer,
            preserveDuration:true,
          });
          break;

        case 'answer-wrong':
          notices.push({
            type:'answer-wrong',
            text:`오답입니다. 정답은 ${String(ctx.correctAnswer || '')}`,
            duration:Math.max(DURATIONS.wrongAnswer, int(event?.minimumDurationMs)),
            tone:'correct-answer',
            preserveDuration:true,
          });
          break;

        // 내가 몬스터를 때린 것 — 예전에는 player-hit / 추가타는 player-extra-hit 였다
        case 'monster-damage': {
          const first = damagingHits === 0;
          damagingHits += 1;
          totalDamage += amount;
          const notice = {
            type:first ? 'player-hit' : 'player-extra-hit',
            text:`${event?.critical ? '💥 치명타! ' : ''}${amount}의 피해를 주었다!`,
            duration:first ? attackDuration : DURATIONS.playerAttack,
            effect:{
              id:effectId(),
              type:'monster-damage',
              combatId,
              amount,
              ...(event?.critical === true ? { critical:true } : {}),
              ...(event?.execute === true ? { ignoreShield:true } : {}),
            },
          };
          if (playerFx) notice.fx = { ...playerFx, hitIndex:damagingHits - 1, hitStage:first ? 'primary' : 'extra' };
          if (first && ctx.audioId) notice.audioId = String(ctx.audioId);
          notices.push(notice);
          break;
        }

        case 'player-miss':
          notices.push({
            type:damagingHits === 0 ? 'player-hit' : 'player-extra-hit',
            text:'공격이 빗나갔다!',
            duration:DURATIONS.playerAttack,
            ...(playerFx ? { fx:{ ...playerFx, hitStage:'primary' } } : {}),
          });
          break;

        case 'monster-dot':
          notices.push({
            type:'player-extra-hit',
            text:`암흑 중첩이 ${monsterName}에게 ${amount}의 피해!`,
            duration:DURATIONS.playerAttack,
            effect:{ id:effectId(), type:'monster-dot', combatId, amount },
          });
          break;

        case 'monster-status': {
          const status = String(event?.status || '').trim();
          const effect = {
            id:effectId(),
            type:'monster-status',
            combatId,
            status,
            turns:int(event?.turns),
          };
          // 암흑은 중첩으로 쌓인다 — 중첩 수가 없으면 효과가 무시되므로 최소 1을 준다
          if (status === 'shadow') {
            effect.stacks = Math.max(1, int(event?.stacks));
            effect.mode = 'add';
          } else {
            effect.mode = 'max';
          }
          notices.push({
            type:'enemy-status',
            text:`${monsterName}이(가) ${statusLabel(status)} 상태가 되었다!`,
            duration:DURATIONS.support,
            ...(status ? { effect } : {}),
          });
          break;
        }

        case 'monster-shield':
          notices.push({
            type:'enemy-status',
            text:`${monsterName}이(가) 보호막을 펼쳤다!`,
            duration:DURATIONS.support,
            effect:{ id:effectId(), type:'monster-shield', combatId, amount },
          });
          break;

        case 'player-shield':
          notices.push({
            type:'player-support',
            text:`보호막 +${amount}`,
            duration:DURATIONS.support,
            effect:{ id:effectId(), type:'player-support', combatId, kind:'shield', amount },
          });
          break;

        case 'player-heal':
          notices.push({
            type:'player-support',
            text:`HP +${amount}`,
            duration:DURATIONS.support,
            effect:{ id:effectId(), type:'player-support', combatId, kind:'heal', amount },
          });
          break;

        case 'player-action':
          notices.push({
            type:'player-support-before',
            text:event?.action === 'charge' ? '힘을 모으고 있다!' : '기운을 끌어올렸다!',
            duration:DURATIONS.support,
          });
          break;

        // 여기서부터 몬스터 차례
        case 'monster-action':
          sawMonsterAction = true;
          notices.push({
            type:'monster-action',
            text:`${monsterName}의 공격!`,
            duration:DURATIONS.notice,
            ...(monsterFx ? { fx:{ ...monsterFx, phase:'wind-up', mode:'wind-up' } } : {}),
          });
          break;

        case 'monster-miss':
          notices.push({
            type:'player-damage',
            text:`${monsterName}의 공격이 빗나갔다!`,
            duration:DURATIONS.playerAttack,
            tone:'enemy-action',
          });
          break;

        case 'player-damage': {
          const notice = {
            type:'player-damage',
            text:`${amount}의 피해를 받았다!`,
            duration:DURATIONS.notice,
            tone:'enemy-action',
            effect:{ id:effectId(), type:'player-damage', combatId, amount },
          };
          if (monsterFx) notice.fx = { ...monsterFx, phase:'impact', mode:'projectile' };
          notices.push(notice);
          break;
        }

        case 'player-dot':
          notices.push({
            type:'player-dot',
            text:`중독 피해 ${amount}`,
            duration:DURATIONS.dot,
            tone:'enemy-action',
            effect:{ id:effectId(), type:'player-dot', combatId, amount },
          });
          break;

        case 'player-status': {
          const status = String(event?.status || '').trim();
          notices.push({
            type:'player-status',
            text:`${statusLabel(status)}에 걸렸다!`,
            duration:DURATIONS.support,
            tone:'enemy-action',
            ...(status ? {
              effect:{ id:effectId(), type:'player-status', combatId, status, turns:int(event?.turns) },
            } : {}),
          });
          break;
        }

        default:
          break; // rewards, surrender 등은 다른 곳에서 처리한다
      }
    }

    // 여러 대를 때렸을 때만 합계를 보여준다 (예전과 같은 규칙)
    if (damagingHits > 1 && totalDamage > 0) {
      notices.push({
        type:'player-total',
        text:`총 ${totalDamage}의 피해를 주었다!`,
        duration:DURATIONS.playerAttack,
      });
    }

    return { notices, totalDamage, hits:damagingHits, sawMonsterAction };
  }

  global.YuksamCombatLogV3 = Object.freeze({ translate, DURATIONS, STATUS_LABELS });
})(window);
