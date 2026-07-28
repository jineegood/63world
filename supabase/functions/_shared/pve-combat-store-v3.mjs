function resultData(result) {
  if (result?.error) {
    const message = String(result.error.message || '');
    const error = new Error('COMBAT_STORE_ERROR');
    error.code = /^[A-Z][A-Z0-9_]{2,80}$/.test(message) ? message : 'COMBAT_STORE_ERROR';
    throw error;
  }
  const data = result?.data ?? null;
  if (data?.ok === false) {
    const rawCode = String(data.code || '');
    const error = new Error('COMBAT_STORE_ERROR');
    error.code = /^[A-Z][A-Z0-9_]{2,80}$/.test(rawCode) ? rawCode : 'COMBAT_STORE_ERROR';
    throw error;
  }
  return data;
}

export function createSupabasePveCombatStore(client) {
  if (!client?.rpc) throw new Error('Combat store client is required');
  return Object.freeze({
    async readCombatant(userId) {
      return resultData(await client.rpc('private_read_combatant_v3', {
        p_user_id:userId,
      }));
    },
    async start({ userId, monsterKey, expectedPlayerRevision, state, requestId }) {
      return resultData(await client.rpc('private_start_student_combat_v3', {
        p_user_id:userId,
        p_monster_key:monsterKey,
        p_expected_player_revision:expectedPlayerRevision,
        p_state:state,
        p_request_id:requestId,
      }));
    },
    async prepareTurn({ userId, questionToken, expectedSessionRevision, requestId }) {
      return resultData(await client.rpc('private_prepare_student_combat_turn_v3', {
        p_user_id:userId,
        p_question_token:questionToken,
        p_expected_session_revision:expectedSessionRevision,
        p_request_id:requestId,
      }));
    },
    async commitTurn({
      userId,
      expectedSessionRevision,
      expectedPlayerRevision,
      requestId,
      outcome,
    }) {
      return resultData(await client.rpc('private_commit_student_combat_turn_v3', {
        p_user_id:userId,
        p_expected_session_revision:expectedSessionRevision,
        p_expected_player_revision:expectedPlayerRevision,
        p_request_id:requestId,
        p_outcome:outcome,
      }));
    },
    async persistCooldowns({ userId, cooldowns }) {
      return resultData(await client.rpc('private_store_combat_cooldowns_v3', {
        p_user_id:userId,
        p_cooldowns:cooldowns || {},
      }));
    },
    async prepareEscape({ userId, expectedSessionRevision, requestId }) {
      return resultData(await client.rpc('private_prepare_student_combat_escape_v3', {
        p_user_id:userId,
        p_expected_session_revision:expectedSessionRevision,
        p_request_id:requestId,
      }));
    },
    async commitEscape({
      userId,
      expectedSessionRevision,
      expectedPlayerRevision,
      requestId,
      outcome,
    }) {
      return resultData(await client.rpc('private_commit_student_combat_escape_v3', {
        p_user_id:userId,
        p_expected_session_revision:expectedSessionRevision,
        p_expected_player_revision:expectedPlayerRevision,
        p_request_id:requestId,
        p_outcome:outcome,
      }));
    },
    async surrender({ userId, expectedSessionRevision, requestId }) {
      return resultData(await client.rpc('private_surrender_student_combat_v3', {
        p_user_id:userId,
        p_expected_session_revision:expectedSessionRevision,
        p_request_id:requestId,
      }));
    },
    async resume(userId) {
      return resultData(await client.rpc('private_resume_student_combat_v3', {
        p_user_id:userId,
      }));
    },
    async startHealing({ userId, expectedRevision, requestId }) {
      return resultData(await client.rpc('private_start_student_healing_v3', {
        p_user_id:userId,
        p_expected_revision:expectedRevision,
        p_request_id:requestId,
      }));
    },
    async submitHealing({ userId, questionToken, answer, expectedRevision, requestId }) {
      return resultData(await client.rpc('private_submit_student_healing_v3', {
        p_user_id:userId,
        p_question_token:questionToken,
        p_answer:answer,
        p_expected_revision:expectedRevision,
        p_request_id:requestId,
      }));
    },
  });
}
