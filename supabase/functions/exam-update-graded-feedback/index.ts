// supabase/functions/exam-update-graded-feedback/index.ts
// Entry point for exam-update-graded-feedback Edge Function

import { handleUpdateGradedFeedbackRequest } from './handler.ts';

// @ts-ignore Deno.serve is standard in Edge Runtime
Deno.serve(async (req: Request) => {
  return await handleUpdateGradedFeedbackRequest(req);
});
