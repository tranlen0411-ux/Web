import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function finishJobOrReport(
  supabaseAdmin: any,
  jobId: string,
  expectedAttempt: number,
  status: string,
  lastError: string | null,
  userId: string
): Promise<{ success: boolean; alreadyFinished?: boolean; errorReason?: string }> {
  const { data: finishRes, error: finishErr } = await supabaseAdmin.rpc('finish_exercise_file_cleanup_job', {
    p_job_id: jobId,
    p_expected_attempt: expectedAttempt,
    p_status: status,
    p_last_error: lastError,
    p_requesting_user_id: userId,
  });

  if (finishErr || !finishRes?.success) {
    console.error(`[Job ${jobId}] finish_exercise_file_cleanup_job RPC error:`, finishErr || finishRes?.message);
    if (finishRes?.already_finished) {
      return { success: true, alreadyFinished: true };
    }
    return { success: false, errorReason: finishRes?.reason || 'finish_rpc_failed' };
  }
  return { success: true, alreadyFinished: !!finishRes.already_finished };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(
        JSON.stringify({ success: false, message: 'Missing Authorization header' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

    if (!supabaseUrl || !supabaseServiceKey) {
      return new Response(
        JSON.stringify({ success: false, message: 'Server environment missing Supabase configuration' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 1. Client với token JWT của Caller ĐƯỢC DÙNG DUY NHẤT để xác minh user token
    const supabaseCaller = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error: userError } = await supabaseCaller.auth.getUser();
    if (userError || !user) {
      return new Response(
        JSON.stringify({ success: false, message: 'Unauthorized: Invalid user token' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const body = await req.json();
    const rawJobIds = Array.isArray(body?.job_ids) ? body.job_ids : [];
    const requested_count = rawJobIds.length;

    if (requested_count === 0) {
      return new Response(
        JSON.stringify({
          success: true,
          partial_success: false,
          requested_count: 0,
          completed_count: 0,
          unresolved_count: 0,
          deleted: [],
          still_referenced: [],
          failed: [],
          already_claimed: [],
          invalid_job_ids: [],
          missing_job_ids: []
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (requested_count > 50) {
      return new Response(
        JSON.stringify({ success: false, message: 'Payload exceeds maximum limit of 50 job_ids per request' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const invalid_job_ids: string[] = [];
    const valid_requested_uuids: string[] = [];
    const seen_raw_ids = new Set<string>();

    for (const rawId of rawJobIds) {
      const strId = String(rawId);
      if (seen_raw_ids.has(strId)) continue;
      seen_raw_ids.add(strId);

      if (typeof rawId === 'string' && UUID_REGEX.test(rawId)) {
        valid_requested_uuids.push(rawId);
      } else {
        invalid_job_ids.push(strId);
      }
    }

    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

    const deleted: string[] = [];
    const still_referenced: string[] = [];
    const already_claimed: string[] = [];
    const missing_job_ids: string[] = [];
    const failed: Array<{ job_id: string; file_path?: string; reason: string }> = [];

    for (const jobId of valid_requested_uuids) {
      // 3. THỰC THI RPC CLAIM_EXERCISE_FILE_CLEANUP_JOB QUA SUPABASEADMIN (SERVICE_ROLE KEY)
      const { data: claimRes, error: claimErr } = await supabaseAdmin.rpc('claim_exercise_file_cleanup_job', {
        p_job_id: jobId,
        p_requesting_user_id: user.id
      });

      if (claimErr || !claimRes?.success) {
        const reason = claimRes?.reason || 'claim_failed';
        if (reason === 'missing_job') {
          missing_job_ids.push(jobId);
        } else if (reason === 'already_claimed') {
          already_claimed.push(jobId);
        } else {
          failed.push({ job_id: jobId, reason });
        }
        continue;
      }

      const job = claimRes.job;
      const filePath = job.file_path;
      const claimedAttempt = job.attempts;

      // Validate format path
      if (
        typeof filePath !== 'string' ||
        !filePath.trim() ||
        filePath.includes('..') ||
        filePath.startsWith('/') ||
        filePath.length > 500
      ) {
        const finRes = await finishJobOrReport(supabaseAdmin, jobId, claimedAttempt, 'failed', 'Invalid file path format', user.id);
        failed.push({ job_id: jobId, file_path: String(filePath), reason: finRes.errorReason || 'invalid_path_format' });
        continue;
      }

      // 4. FAIL-CLOSED SECURITY PATTERN: Kiểm tra tham chiếu CSDL với Service Role
      const { data: refCheck, error: refError } = await supabaseAdmin
        .from('academic_submission_answers')
        .select('id')
        .eq('file_url', filePath);

      if (refError) {
        console.error(`[Job ${jobId}] Ref check DB error:`, refError);
        const finRes = await finishJobOrReport(supabaseAdmin, jobId, claimedAttempt, 'failed', refError.message, user.id);
        failed.push({ job_id: jobId, file_path: filePath, reason: finRes.errorReason || 'reference_check_failed' });
        continue;
      }

      if (refCheck && refCheck.length > 0) {
        const finRes = await finishJobOrReport(supabaseAdmin, jobId, claimedAttempt, 'still_referenced', null, user.id);
        if (finRes.success) {
          still_referenced.push(filePath);
        } else {
          failed.push({ job_id: jobId, file_path: filePath, reason: finRes.errorReason || 'still_referenced_finish_failed' });
        }
        continue;
      }

      // 5. CHÍNH THỨC GỌI SUPABASE STORAGE REMOVE() API CHUẨN XÁC NGUYÊN TỬ
      const { error: removeErr } = await supabaseAdmin.storage
        .from('exercise-submissions')
        .remove([filePath]);

      if (removeErr) {
        console.error(`[Job ${jobId}] Storage API remove error (${filePath}):`, removeErr);
        const finRes = await finishJobOrReport(supabaseAdmin, jobId, claimedAttempt, 'failed', removeErr.message, user.id);
        failed.push({ job_id: jobId, file_path: filePath, reason: finRes.errorReason || removeErr.message });
      } else {
        // 6. GỌI FINISH_EXERCISE_FILE_CLEANUP_JOB QUA SUPABASEADMIN (SERVICE_ROLE KEY) FIRST
        const finRes = await finishJobOrReport(supabaseAdmin, jobId, claimedAttempt, 'deleted', null, user.id);

        if (!finRes.success) {
          console.error(`[Job ${jobId}] Finish job RPC failed after storage remove. Running reconciliation...`);
          
          // Thử đối soát CSDL (Reconciliation Idempotent)
          const { data: reconRes, error: reconErr } = await supabaseAdmin.rpc('reconcile_exercise_file_cleanup_job', {
            p_job_id: jobId,
            p_expected_attempt: claimedAttempt,
            p_requesting_user_id: user.id
          });

          if (!reconErr && reconRes?.success && reconRes?.already_finished) {
            deleted.push(filePath);
          } else {
            const markRes = await finishJobOrReport(
              supabaseAdmin, jobId, claimedAttempt, 'storage_deleted_job_update_failed', 'Storage deleted but status update failed', user.id
            );

            failed.push({
              job_id: jobId,
              file_path: filePath,
              reason: markRes.success ? 'storage_deleted_job_update_failed' : 'database_reconciliation_failed'
            });
          }
        } else {
          deleted.push(filePath);
        }
      }
    }

    const completed_count = deleted.length + still_referenced.length;
    const unresolved_count = failed.length + missing_job_ids.length + invalid_job_ids.length + already_claimed.length;

    let overallSuccess = unresolved_count === 0;
    const partialSuccess = completed_count > 0 && unresolved_count > 0;

    // Kiểm tra bất biến số đếm trước khi trả response
    if (requested_count !== completed_count + unresolved_count) {
      console.error(`Invariant mismatch: requested (${requested_count}) != completed (${completed_count}) + unresolved (${unresolved_count})`);
      overallSuccess = false;
    }

    return new Response(
      JSON.stringify({
        success: overallSuccess,
        partial_success: partialSuccess,
        requested_count,
        completed_count,
        unresolved_count,
        deleted,
        still_referenced,
        already_claimed,
        failed,
        invalid_job_ids,
        missing_job_ids,
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (err: any) {
    console.error('Edge Function exception:', err);
    return new Response(
      JSON.stringify({ success: false, partial_success: false, message: err.message || 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
