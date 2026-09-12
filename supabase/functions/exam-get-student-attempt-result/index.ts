// supabase/functions/exam-get-student-attempt-result/index.ts
// Deno Deploy Entrypoint for Student Exam Attempt Result Read BFF (Phase B2 - Student Result View V1)

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { handleGetStudentAttemptResultRequest } from './handler.ts';

serve(async (req: Request) => {
  return await handleGetStudentAttemptResultRequest(req);
});
