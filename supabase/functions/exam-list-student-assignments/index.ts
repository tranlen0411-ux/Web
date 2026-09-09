// supabase/functions/exam-list-student-assignments/index.ts
// Deno Deploy Entrypoint for Student Exam Assignment List Read BFF

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { handleListStudentAssignmentsRequest } from './handler.ts';

serve(async (req: Request) => {
  return await handleListStudentAssignmentsRequest(req);
});
