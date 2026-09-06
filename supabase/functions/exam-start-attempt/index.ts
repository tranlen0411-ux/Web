// supabase/functions/exam-start-attempt/index.ts
// Deno Deploy Entrypoint for Student Start Attempt BFF

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { handleStartAttemptRequest } from './handler.ts';

serve(async (req: Request) => {
  return await handleStartAttemptRequest(req);
});
