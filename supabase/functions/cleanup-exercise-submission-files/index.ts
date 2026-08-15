import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

    // 1. Client với token JWT của Caller để gọi các RPC SECURITY DEFINER có phân quyền
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
    const jobIds = body?.job_ids;
    if (!Array.isArray(jobIds) || jobIds.length === 0) {
      return new Response(
        JSON.stringify({ success: true, deleted: [], still_referenced: [], failed: [], already_claimed: [], invalid_job_ids: [], missing_job_ids: [] }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (jobIds.length > 50) {
      return new Response(
        JSON.stringify({ success: false, message: 'Payload exceeds maximum limit of 50 job_ids per request' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const invalid_job_ids: string[] = [];
    const valid_requested_uuids: string[] = [];

    for (const rawId of jobIds) {
      if (typeof rawId === 'string' && UUID_REGEX.test(rawId)) {
        valid_requested_uuids.push(rawId);
      } else {
        invalid_job_ids.push(String(rawId));
      }
    }

    const uniqueJobIds = Array.from(new Set(valid_requested_uuids));
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

    const deleted: string[] = [];
    const still_referenced: string[] = [];
    const already_claimed: string[] = [];
    const missing_job_ids: string[] = [];
    const failed: Array<{ job_id: string; file_path?: string; reason: string }> = [];

    for (const jobId of uniqueJobIds) {
      // 2. KÍCH HOẠT RPC CLAIM NGUYÊN TỬ CSDL (CHỈ MỘT WORKER CLAIM THÀNH CÔNG VỚI QUYỀN CALLER)
      const { data: claimRes, error: claimErr } = await supabaseCaller.rpc('claim_exercise_file_cleanup_job', {
        p_job_id: jobId
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
        await supabaseCaller.rpc('finish_exercise_file_cleanup_job', {
          p_job_id: jobId,
          p_expected_attempt: claimedAttempt,
          p_status: 'failed',
          p_last_error: 'Invalid file path format'
        });
        failed.push({ job_id: jobId, file_path: String(filePath), reason: 'invalid_path_format' });
        continue;
      }

      // 3. FAIL-CLOSED SECURITY PATTERN: Kiểm tra tham chiếu CSDL với Service Role
      const { data: refCheck, error: refError } = await supabaseAdmin
        .from('academic_submission_answers')
        .select('id')
        .eq('file_url', filePath);

      if (refError) {
        console.error(`[Job ${jobId}] Ref check DB error:`, refError);
        await supabaseCaller.rpc('finish_exercise_file_cleanup_job', {
          p_job_id: jobId,
          p_expected_attempt: claimedAttempt,
          p_status: 'failed',
          p_last_error: refError.message
        });
        failed.push({ job_id: jobId, file_path: filePath, reason: 'reference_check_failed' });
        continue;
      }

      if (refCheck && refCheck.length > 0) {
        still_referenced.push(filePath);
        await supabaseCaller.rpc('finish_exercise_file_cleanup_job', {
          p_job_id: jobId,
          p_expected_attempt: claimedAttempt,
          p_status: 'still_referenced',
          p_last_error: null
        });
        continue;
      }

      // 4. CHÍNH THỨC GỌI SUPABASE STORAGE REMOVE() API CHUẨN XÁC NGUYÊN TỬ
      const { error: removeErr } = await supabaseAdmin.storage
        .from('exercise-submissions')
        .remove([filePath]);

      if (removeErr) {
        console.error(`[Job ${jobId}] Storage API remove error (${filePath}):`, removeErr);
        await supabaseCaller.rpc('finish_exercise_file_cleanup_job', {
          p_job_id: jobId,
          p_expected_attempt: claimedAttempt,
          p_status: 'failed',
          p_last_error: removeErr.message
        });
        failed.push({ job_id: jobId, file_path: filePath, reason: removeErr.message });
      } else {
        // 5. GỌI RPC FINISH_EXERCISE_FILE_CLEANUP_JOB CẬP NHẬT TRẠNG THÁI DELETED
        const { data: finishRes, error: finishErr } = await supabaseCaller.rpc('finish_exercise_file_cleanup_job', {
          p_job_id: jobId,
          p_expected_attempt: claimedAttempt,
          p_status: 'deleted',
          p_last_error: null
        });

        if (finishErr || !finishRes?.success) {
          console.error(`[Job ${jobId}] Finish job RPC failed after storage remove:`, finishErr || finishRes?.message);
          failed.push({
            job_id: jobId,
            file_path: filePath,
            reason: 'storage_deleted_job_update_failed'
          });
        } else {
          deleted.push(filePath);
        }
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
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
      JSON.stringify({ success: false, message: err.message || 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
