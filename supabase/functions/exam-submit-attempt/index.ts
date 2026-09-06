// supabase/functions/exam-submit-attempt/index.ts
// Deno Deploy Entrypoint for Student Submit Attempt BFF

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { handleSubmitAttemptRequest } from './handler.ts';

serve(async (req: Request) => {
  return await handleSubmitAttemptRequest(req);
});
