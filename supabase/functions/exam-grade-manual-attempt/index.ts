// supabase/functions/exam-grade-manual-attempt/index.ts
// Exam Builder Protected Manual Grading BFF Entrypoint V1

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { handleGradeManualAttemptRequest } from './handler.ts';

serve((req: Request): Promise<Response> => handleGradeManualAttemptRequest(req));
