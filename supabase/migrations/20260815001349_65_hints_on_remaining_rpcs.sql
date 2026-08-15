-- Step 7g. Every user-facing raise now carries a machine code.
--
-- THE RULE, from migration 60: if a message is written to be read by a person,
-- it carries a HINT. That migration fixed the four functions about to get UI
-- callers and left nine. Since then `archive_circle` shipped raises nothing
-- translated, and `set_circle_deadline` acquired a second name for a condition
-- migration 53 had already named. This closes the set.
--
-- HOW THIS IS WRITTEN, and why it looks unusual.
--
-- The bodies must change ONLY inside their `using` clauses. Retyping nine
-- functions by hand cannot promise that; a stray character in a body would be
-- invisible in review and would ship. So the migration reads each existing
-- definition, splices the hint in by pattern, and re-executes the result. The
-- guarantee is structural rather than something to check afterwards.
--
-- Every substitution asserts it changed something. If a message is ever
-- reworded, this fails loudly at apply time rather than silently doing nothing
-- and leaving a raise unlabelled, which is the exact failure it exists to stop.
-- That guard already earned itself once, on the first attempt.
--
-- The pattern stops at the statement terminator, so it cannot reach past the
-- raise it targets. None of the messages contain regex metacharacters or
-- apostrophes, which is why they can be embedded literally.

do $migration$
declare
  -- signature, message the raise starts with, sqlstate, hint to attach
  v_specs text[][] := array[
    -- Not authenticated. The string match in lib/errors.ts exists only because
    -- these nine had no code; deleting it is the point of the exercise.
    ['complete_onboarding(text,text)',      'Not authenticated', 'insufficient_privilege', 'NOT_AUTHENTICATED'],
    ['create_circle(text,timestamp with time zone)', 'Not authenticated', 'insufficient_privilege', 'NOT_AUTHENTICATED'],
    ['export_user_data()',                  'Not authenticated', 'insufficient_privilege', 'NOT_AUTHENTICATED'],
    ['sync_checkin_timezone(text)',         'Not authenticated', 'insufficient_privilege', 'NOT_AUTHENTICATED'],
    ['cycle_continue(uuid,timestamp with time zone)', 'Not authenticated', 'insufficient_privilege', 'NOT_AUTHENTICATED'],
    ['cycle_reset(uuid,timestamp with time zone)',    'Not authenticated', 'insufficient_privilege', 'NOT_AUTHENTICATED'],
    ['resolve_streak_decision(uuid,boolean)',         'Not authenticated', 'insufficient_privilege', 'NOT_AUTHENTICATED'],
    ['transfer_ownership(uuid,uuid)',                 'Not authenticated', 'insufficient_privilege', 'NOT_AUTHENTICATED'],
    ['set_circle_deadline(uuid,timestamp with time zone)', 'Not authenticated', 'insufficient_privilege', 'NOT_AUTHENTICATED'],

    -- Onboarding and timezone. The timezone raise interpolates p_timezone, so
    -- today it echoes submitted text straight back through the 22023 branch.
    -- The hint makes the displayed copy fixed; the interpolated value stays in
    -- the Postgres log, where it is actually useful.
    ['complete_onboarding(text,text)', 'You can only change your username once every 14 days', 'invalid_parameter_value', 'USERNAME_RENAME_TOO_SOON'],
    ['complete_onboarding(text,text)', 'Unrecognised timezone', 'invalid_parameter_value', 'TIMEZONE_INVALID'],
    ['sync_checkin_timezone(text)',    'Unrecognised timezone', 'invalid_parameter_value', 'TIMEZONE_INVALID'],

    -- Cycles.
    ['cycle_continue(uuid,timestamp with time zone)', 'Only an owner or admin may renew a cycle', 'insufficient_privilege', 'NOT_ADMIN'],
    ['cycle_continue(uuid,timestamp with time zone)', 'Continuing a cycle can only extend', 'invalid_parameter_value', 'DEADLINE_BACKWARDS'],
    ['cycle_reset(uuid,timestamp with time zone)',    'Only an owner or admin may reset a cycle', 'insufficient_privilege', 'NOT_ADMIN'],
    ['cycle_reset(uuid,timestamp with time zone)',    'This circle has no active cycle', 'invalid_parameter_value', 'NO_ACTIVE_CYCLE'],

    -- Streak decision and ownership.
    ['resolve_streak_decision(uuid,boolean)', 'Only the circle owner can decide this', 'insufficient_privilege', 'NOT_OWNER'],
    ['resolve_streak_decision(uuid,boolean)', 'There is no pending streak decision', 'invalid_parameter_value', 'NO_PENDING_DECISION'],
    ['transfer_ownership(uuid,uuid)', 'Only the circle owner may transfer ownership', 'insufficient_privilege', 'NOT_OWNER'],
    ['transfer_ownership(uuid,uuid)', 'That person is not a member of this circle', 'invalid_parameter_value', 'NOT_A_MEMBER'],
    ['transfer_ownership(uuid,uuid)', 'You already own this circle', 'invalid_parameter_value', 'ALREADY_OWNER']
  ];
  v_sig text; v_msg text; v_code text; v_hint text;
  v_def text; v_new text; v_i int;
begin
  for v_i in 1 .. array_length(v_specs, 1) loop
    v_sig  := v_specs[v_i][1];
    v_msg  := v_specs[v_i][2];
    v_code := v_specs[v_i][3];
    v_hint := v_specs[v_i][4];

    v_def := pg_get_functiondef(('public.' || v_sig)::regprocedure);

    v_new := regexp_replace(
      v_def,
      '(' || v_msg || '[^;]*?errcode = ''' || v_code || ''')',
      '\1, hint = ''' || v_hint || '''',
      'g'
    );

    if v_new = v_def then
      raise exception
        'No raise matching % / % in %. The message was reworded; fix this migration rather than skipping it.',
        v_msg, v_code, v_sig;
    end if;

    execute v_new;
  end loop;
end
$migration$;

-- ---------------------------------------------------------------------------
-- The rename. `CIRCLE_NOT_ACTIVE` (migration 53) and `CIRCLE_INACTIVE`
-- (migration 60) are the same condition with byte-identical message text under
-- two names. The newer wins: `create_invite_link` already raises it and has a
-- live caller, so renaming that one would change shipped behaviour. Renaming
-- this one changes nothing, because `set_circle_deadline` has no caller at all.
-- ---------------------------------------------------------------------------
do $rename$
declare v_def text; v_new text;
begin
  v_def := pg_get_functiondef('public.set_circle_deadline(uuid,timestamp with time zone)'::regprocedure);
  v_new := replace(v_def, 'hint = ''CIRCLE_NOT_ACTIVE''', 'hint = ''CIRCLE_INACTIVE''');
  if v_new = v_def then
    raise exception 'CIRCLE_NOT_ACTIVE not found in set_circle_deadline; already renamed?';
  end if;
  execute v_new;
end
$rename$;;
