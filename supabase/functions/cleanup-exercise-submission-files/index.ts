import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function updateJobStatus(
  supabaseAdmin: any,
  jobId: string,
  status: string,
  attempts?: number,
  lastError?: string | null
): Promise<{ success: boolean; error?: any }> {
  const updatePayload: any = {
    status,
    processed_at: new Date().toISOString(),
  };
  if (attempts !== undefined) updatePayload.attempts = attempts;
  if (lastError !== undefined) updatePayload.last_error = lastError;

  const { error } = await supabaseAdmin
    .from('exercise_file_cleanup_jobs')
    .update(updatePayload)
    .eq('id', jobId);

  if (error) {
    console.error(`[Job ${jobId}] Failed to update status to '${status}':`, error);
    return { success: false, error };
  }
  return { success: true };
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

    // 1. Client với token JWT của Caller để xác minh danh tính
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
        JSON.stringify({ success: true, deleted: [], still_referenced: [], failed: [], invalid_job_ids: [], missing_job_ids: [] }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Giới hạn tối đa 50 job IDs mỗi payload request
    if (jobIds.length > 50) {
      return new Response(
        JSON.stringify({ success: false, message: 'Payload exceeds maximum limit of 50 job_ids per request' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Filter và validate định dạng UUID
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

    // 2. Client Service Role chỉ dùng trong môi trường Edge Function bảo mật
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

    // Lấy thông tin role người dùng và kiểm tra lỗi profileError
    const { data: profile, error: profileError } = await supabaseAdmin
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single();

    if (profileError) {
      console.error('Profile fetch error:', profileError);
      return new Response(
        JSON.stringify({ success: false, message: 'Failed to verify user profile' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const isAdmin = profile?.role === 'admin';

    // 3. Truy vấn các jobs thực tế từ Bảng Hàng Đợi exercise_file_cleanup_jobs
    const { data: jobs, error: jobsError } = await supabaseAdmin
      .from('exercise_file_cleanup_jobs')
      .select('*')
      .in('id', uniqueJobIds);

    if (jobsError) {
      console.error('Jobs fetch error:', jobsError);
      return new Response(
        JSON.stringify({ success: false, message: 'Failed to query cleanup jobs' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const fetchedJobIds = new Set((jobs || []).map((j: any) => j.id));
    const missing_job_ids = uniqueJobIds.filter((id) => !fetchedJobIds.has(id));

    const deleted: string[] = [];
    const still_referenced: string[] = [];
    const failed: Array<{ job_id: string; file_path?: string; reason: string }> = [];

    const STALE_THRESHOLD_MS = 15 * 60 * 1000; // 15 phút
    const nowMs = Date.now();

    for (const job of jobs || []) {
      const jobId = job.id;
      const filePath = job.file_path;

      // Giới hạn max attempts = 5
      if (job.attempts >= 5) {
        await updateJobStatus(supabaseAdmin, jobId, 'permanent_failed', job.attempts, 'Max retry limit reached (5 attempts)');
        failed.push({ job_id: jobId, file_path: filePath, reason: 'permanent_failed_max_retries' });
        continue;
      }

      // Kiểm tra bucket_id hợp lệ
      if (job.bucket_id !== 'exercise-submissions') {
        await updateJobStatus(supabaseAdmin, jobId, 'failed', job.attempts, 'Invalid bucket_id');
        failed.push({ job_id: jobId, file_path: filePath, reason: 'invalid_bucket' });
        continue;
      }

      // Kiểm tra quyền chủ sở hữu
      if (!isAdmin && job.requested_by !== user.id) {
        failed.push({ job_id: jobId, file_path: filePath, reason: 'unauthorized_job_owner' });
        continue;
      }

      // Kiểm tra status xử lý (hỗ trợ stale processing recovery > 15 phút)
      let canClaim = ['pending', 'failed'].includes(job.status);
      if (job.status === 'processing' && job.processed_at) {
        const lastProcessedMs = new Date(job.processed_at).getTime();
        if (nowMs - lastProcessedMs > STALE_THRESHOLD_MS) {
          canClaim = true;
        }
      }

      if (!canClaim) {
        failed.push({ job_id: jobId, file_path: filePath, reason: 'job_already_processing_or_invalid_status' });
        continue;
      }

      // Validate format file_path trong CSDL
      if (
        typeof filePath !== 'string' ||
        !filePath.trim() ||
        filePath.includes('..') ||
        filePath.startsWith('/') ||
        filePath.length > 500
      ) {
        await updateJobStatus(supabaseAdmin, jobId, 'failed', job.attempts, 'Invalid file path format');
        failed.push({ job_id: jobId, file_path: String(filePath), reason: 'invalid_path_format' });
        continue;
      }

      // Claim job status = 'processing' nguyên tử và tăng attempts
      const nextAttempts = (job.attempts || 0) + 1;
      const { data: claimData, error: claimErr } = await supabaseAdmin
        .from('exercise_file_cleanup_jobs')
        .update({
          status: 'processing',
          attempts: nextAttempts,
          processed_at: new Date().toISOString(),
        })
        .eq('id', jobId)
        .select('id');

      if (claimErr || !claimData || claimData.length === 0) {
        console.error(`[Job ${jobId}] Claim error:`, claimErr);
        failed.push({ job_id: jobId, file_path: filePath, reason: 'job_claim_failed' });
        continue;
      }

      // FAIL-CLOSED SECURITY PATTERN: Kiểm tra tham chiếu CSDL với Service Role
      const { data: refCheck, error: refError } = await supabaseAdmin
        .from('academic_submission_answers')
        .select('id')
        .eq('file_url', filePath);

      // BẤT KỲ LỖI TRUY VẤN CSDL NÀO ĐỀU PHẢI CHẶN VÀ KHÔNG XÓA FILE (FAIL-CLOSED)
      if (refError) {
        console.error(`[Job ${jobId}] Ref check DB error (${filePath}):`, refError);
        failed.push({ job_id: jobId, file_path: filePath, reason: 'reference_check_failed' });
        await updateJobStatus(supabaseAdmin, jobId, 'failed', nextAttempts, refError.message);
        continue;
      }

      if (refCheck && refCheck.length > 0) {
        still_referenced.push(filePath);
        await updateJobStatus(supabaseAdmin, jobId, 'still_referenced', nextAttempts, null);
        continue;
      }

      // CHÍNH THỨC GỌI SUPABASE STORAGE REMOVE() API
      const { error: removeErr } = await supabaseAdmin.storage
        .from('exercise-submissions')
        .remove([filePath]);

      if (removeErr) {
        console.error(`[Job ${jobId}] Storage API remove error (${filePath}):`, removeErr);
        failed.push({ job_id: jobId, file_path: filePath, reason: removeErr.message });
        await updateJobStatus(supabaseAdmin, jobId, 'failed', nextAttempts, removeErr.message);
      } else {
        // Cập nhật trạng thái job thành deleted
        const updateRes = await updateJobStatus(supabaseAdmin, jobId, 'deleted', nextAttempts, null);
        if (!updateRes.success) {
          // Xóa Storage thành công nhưng cập nhật job status thất bại -> Báo lỗi kiểm soát storage_deleted_job_update_failed
          failed.push({
            job_id: jobId,
            file_path: filePath,
            reason: 'storage_deleted_job_update_failed',
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
