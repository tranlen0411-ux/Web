import React, { useState, useEffect } from 'react';
import { X, Send, CheckCircle2, Clock, FileText, AlertCircle, Loader2, Star, Upload, Save, Eye, History } from 'lucide-react';
import { supabase } from '../../../lib/supabase';
import { useAuth } from '../../../context/AuthContext';

export const ExercisePlayModal = ({ exercise, onClose }) => {
  const { profile, refreshProfile } = useAuth();

  const [questions, setQuestions] = useState([]);
  const [submissionsList, setSubmissionsList] = useState([]);
  const [submission, setSubmission] = useState(null);
  const [answers, setAnswers] = useState({});
  const [fileUrls, setFileUrls] = useState({});
  const [signedUrlsMap, setSignedUrlsMap] = useState({});
  const [correctAnswersMap, setCorrectAnswersMap] = useState({});
  const [uploadingQId, setUploadingQId] = useState(null);

  const [loading, setLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitResult, setSubmitResult] = useState(null);

  useEffect(() => {
    fetchQuestionsAndSubmissions();
  }, [exercise.id]);

  // NẠP DỮ LIỆU ĐÚNG LƯỢT ĐƯỢC CHỌN TRONG LỊCH SỬ NỘP BÀI
  const loadSubmissionDetails = async (sub, allQuestions) => {
    setSubmission(sub);
    const ansMap = {};
    const fileMap = {};
    const signedMap = {};

    if (sub && sub.academic_submission_answers) {
      for (const a of sub.academic_submission_answers) {
        ansMap[a.question_id] = a.student_answer_json;
        if (a.file_url) {
          fileMap[a.question_id] = a.file_url;
          try {
            const { data: signedData } = await supabase.storage
              .from('exercise-submissions')
              .createSignedUrl(a.file_url, 900);
            if (signedData?.signedUrl) {
              signedMap[a.question_id] = signedData.signedUrl;
            }
          } catch (e) {
            console.error('Signed URL error:', e);
          }
        }
      }
    }

    setAnswers(ansMap);
    setFileUrls(fileMap);
    setSignedUrlsMap(signedMap);

    // Kiểm tra cờ show_correct_answers
    if (exercise.show_correct_answers && sub && ['submitted', 'pending_manual_grade', 'graded'].includes(sub.status)) {
      const { data: keyRes } = await supabase.rpc('get_submission_correct_answers', {
        p_submission_id: sub.id
      });

      if (keyRes?.success && keyRes.answers) {
        const keyMap = {};
        keyRes.answers.forEach(k => {
          keyMap[k.question_id] = k.correct_answer;
        });
        setCorrectAnswersMap(keyMap);
      }
    } else {
      setCorrectAnswersMap({});
    }
  };

  const fetchQuestionsAndSubmissions = async () => {
    setLoading(true);
    try {
      // 1. Lấy danh sách câu hỏi
      const { data: qData } = await supabase
        .from('academic_exercise_questions')
        .select('*')
        .eq('exercise_id', exercise.id)
        .order('question_number', { ascending: true });

      const loadedQuestions = qData || [];
      setQuestions(loadedQuestions);

      // 2. Lấy tất cả lượt nộp bài của học sinh
      const { data: subData } = await supabase
        .from('academic_submissions')
        .select('*, academic_submission_answers(*)')
        .eq('exercise_id', exercise.id)
        .eq('student_id', profile?.id)
        .order('attempt_number', { ascending: false });

      if (subData && subData.length > 0) {
        setSubmissionsList(subData);
        const activeSub = subData.find(s => s.status === 'draft' || s.status === 'revision_requested') || subData[0];
        await loadSubmissionDetails(activeSub, loadedQuestions);
      }
    } catch (err) {
      console.error('Fetch submission error:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleFileUpload = async (questionId, file) => {
    if (!file) return;

    const bannedExts = ['.svg', '.exe', '.bat', '.sh', '.js', '.html'];
    const fileName = file.name.toLowerCase();
    if (bannedExts.some(ext => fileName.endsWith(ext))) {
      alert('❌ Hệ thống từ chối file SVG và file thực thi vì lý do bảo mật.');
      return;
    }

    if (file.size > 10 * 1024 * 1024) {
      alert('❌ File nộp vượt quá dung lượng tối đa 10MB.');
      return;
    }

    setUploadingQId(questionId);
    try {
      let currentSubId = submission?.id;
      if (!currentSubId) {
        const { data: draftRes, error: draftErr } = await supabase.rpc('create_or_get_submission_draft', {
          p_exercise_id: exercise.id
        });

        if (draftErr || !draftRes?.success) {
          alert('Không thể tạo bản nháp bài làm: ' + (draftErr?.message || draftRes?.message));
          setUploadingQId(null);
          return;
        }

        currentSubId = draftRes.submission_id;
      }

      const cleanName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
      const filePath = `${profile.id}/${currentSubId}/${crypto.randomUUID()}_${cleanName}`;

      const { data, error } = await supabase.storage
        .from('exercise-submissions')
        .upload(filePath, file, { upsert: true });

      if (error) {
        alert('Lỗi upload file: ' + error.message);
      } else {
        setFileUrls(prev => ({ ...prev, [questionId]: filePath }));
        const { data: signedData } = await supabase.storage
          .from('exercise-submissions')
          .createSignedUrl(filePath, 900);
        if (signedData?.signedUrl) {
          setSignedUrlsMap(prev => ({ ...prev, [questionId]: signedData.signedUrl }));
        }
      }
    } catch (err) {
      console.error('File upload exception:', err);
      alert('Đã xảy ra lỗi khi tải file bài làm.');
    } finally {
      setUploadingQId(null);
    }
  };

  const handleSubmitExercise = async (isDraft = false) => {
    setIsSubmitting(true);
    setSubmitResult(null);

    try {
      const answersPayload = questions.map(q => ({
        question_id: q.id,
        answer: answers[q.id] || null,
        file_url: fileUrls[q.id] || null
      }));

      const { data: rpcRes, error: rpcErr } = await supabase.rpc('submit_academic_exercise', {
        p_exercise_id: exercise.id,
        p_answers: answersPayload,
        p_is_draft: isDraft
      });

      if (rpcErr || !rpcRes?.success) {
        setSubmitResult({
          success: false,
          message: rpcErr?.message || rpcRes?.message || 'Không thể nộp bài tập.'
        });
      } else {
        setSubmitResult(rpcRes);
        if (refreshProfile) await refreshProfile();
        fetchQuestionsAndSubmissions();
      }
    } catch (err) {
      console.error('Submit exercise error:', err);
      setSubmitResult({ success: false, message: err.message || 'Lỗi mạng khi nộp bài.' });
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!exercise) return null;

  const isGraded = submission?.status === 'graded';
  const isRevisionRequested = submission?.status === 'revision_requested';
  const canEdit = !submission || submission.status === 'draft' || isRevisionRequested;

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-white w-full max-w-3xl rounded-3xl border-4 border-amber-300 shadow-2xl p-6 sm:p-8 animate-fadeIn max-h-[90vh] flex flex-col">
        
        {/* HEADER */}
        <div className="flex items-center justify-between pb-4 border-b-2 border-amber-100 shrink-0">
          <div>
            <span className="px-2.5 py-0.5 bg-amber-100 text-amber-900 font-black text-xs rounded-lg">
              Môn {exercise.subject}
            </span>
            <h2 className="text-xl font-black text-slate-800 mt-1">{exercise.title}</h2>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-xl transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* BODY */}
        <div className="overflow-y-auto py-4 space-y-6 flex-1">
          
          {submitResult && (
            <div className={`p-4 rounded-2xl border text-xs font-bold ${submitResult.success ? 'bg-emerald-50 border-emerald-300 text-emerald-900' : 'bg-rose-50 border-rose-300 text-rose-900'}`}>
              <p className="font-black text-sm mb-1">{submitResult.message}</p>
              {submitResult.reward_stars_awarded > 0 && (
                <p className="text-amber-600 font-black mt-1 flex items-center gap-1">
                  🎉 Thưởng +{submitResult.reward_stars_awarded} sao! <Star className="w-4 h-4 fill-amber-400" />
                </p>
              )}
            </div>
          )}

          {/* LỊCH SỬ CÁC LẦN LÀM BÀI NẾU MAX_ATTEMPTS > 1 */}
          {submissionsList.length > 1 && (
            <div className="p-3 bg-slate-50 border border-slate-200 rounded-2xl flex items-center justify-between text-xs">
              <span className="font-black text-slate-700 flex items-center gap-1">
                <History className="w-4 h-4 text-amber-600" /> Lịch sử nộp bài ({submissionsList.length} lượt):
              </span>
              <div className="flex gap-1.5">
                {submissionsList.map(s => (
                  <button
                    key={s.id}
                    onClick={() => loadSubmissionDetails(s, questions)}
                    className={`px-2.5 py-1 rounded-lg font-bold text-[11px] ${submission?.id === s.id ? 'bg-amber-500 text-white' : 'bg-white text-slate-600 border border-slate-300'}`}
                  >
                    Lượt {s.attempt_number} ({s.status})
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* CẦN LÀM LẠI BÀI */}
          {isRevisionRequested && (
            <div className="bg-rose-50 p-4 rounded-2xl border-2 border-rose-300 text-rose-950 space-y-1">
              <h4 className="font-black text-sm text-rose-900 flex items-center gap-1.5">
                <AlertCircle className="w-5 h-5 text-rose-600" /> Giáo viên yêu cầu sửa và làm lại bài:
              </h4>
              <p className="text-xs font-bold text-slate-700">{submission.teacher_feedback || 'Bé hãy sửa lại bài làm nhé.'}</p>
            </div>
          )}

          {/* KẾT QUẢ VỚI SHOW_SCORE_AFTER_SUBMIT */}
          {isGraded && exercise.show_score_after_submit && (
            <div className="bg-emerald-50 p-4 rounded-2xl border-2 border-emerald-300 text-emerald-950 space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-black text-base flex items-center gap-1.5">
                  <CheckCircle2 className="w-5 h-5 text-emerald-600" /> Điểm Số Bài Làm:
                </span>
                <span className="text-2xl font-black text-emerald-600">
                  {submission.total_score} / {submission.max_score}
                </span>
              </div>
              {submission.teacher_feedback && (
                <p className="text-xs font-bold text-slate-700 bg-white p-3 rounded-xl border border-emerald-200">
                  💬 <strong>Nhận xét của Giáo viên:</strong> {submission.teacher_feedback}
                </p>
              )}
            </div>
          )}

          {/* HƯỚNG DẪN */}
          <div className="bg-amber-50/80 p-4 rounded-2xl border border-amber-200">
            <h4 className="text-xs font-black text-amber-900 uppercase mb-1">Hướng dẫn bài tập:</h4>
            <p className="text-xs font-bold text-slate-700">{exercise.description || 'Không có mô tả chi tiết.'}</p>
          </div>

          {/* RENDER CÂU HỎI */}
          {loading ? (
            <div className="p-8 text-center text-xs font-bold text-slate-400">Đang tải danh sách câu hỏi...</div>
          ) : (
            <div className="space-y-6">
              {questions.map((q, idx) => {
                const currentAnswer = answers[q.id];
                const correctAnswerKey = correctAnswersMap[q.id];

                return (
                  <div key={q.id} className="bg-slate-50 p-4 rounded-2xl border border-slate-200 space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="font-black text-xs text-slate-800">
                        Câu {idx + 1}: {q.prompt}
                      </span>
                      <span className="text-[11px] font-bold text-amber-600">
                        {q.points} điểm
                      </span>
                    </div>

                    {correctAnswerKey && (
                      <div className="p-2.5 bg-emerald-100/70 border border-emerald-300 rounded-xl text-xs font-bold text-emerald-900">
                        ✅ Đáp án đúng của hệ thống: <strong>{JSON.stringify(correctAnswerKey)}</strong>
                      </div>
                    )}

                    {/* 1. TRẮC NGHIỆM 1 ĐÁP ÁN */}
                    {q.question_type === 'single_choice' && (
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        {(q.options_json || []).map((opt, oIdx) => (
                          <button
                            key={oIdx}
                            type="button"
                            disabled={!canEdit}
                            onClick={() => setAnswers(prev => ({ ...prev, [q.id]: opt }))}
                            className={`p-3 rounded-xl font-bold text-xs text-left border-2 transition-all ${
                              currentAnswer === opt
                                ? 'bg-amber-500 text-white border-amber-600 shadow-sm'
                                : 'bg-white text-slate-700 border-slate-200 hover:bg-amber-50'
                            }`}
                          >
                            {opt}
                          </button>
                        ))}
                      </div>
                    )}

                    {/* 2. TRẮC NGHIỆM NHIỀU ĐÁP ÁN */}
                    {q.question_type === 'multiple_choice' && (
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        {(q.options_json || []).map((opt, oIdx) => {
                          const currentArr = Array.isArray(currentAnswer) ? currentAnswer : [];
                          const isChecked = currentArr.includes(opt);

                          return (
                            <button
                              key={oIdx}
                              type="button"
                              disabled={!canEdit}
                              onClick={() => {
                                let newArr;
                                if (isChecked) {
                                  newArr = currentArr.filter(item => item !== opt);
                                } else {
                                  newArr = [...currentArr, opt];
                                }
                                setAnswers(prev => ({ ...prev, [q.id]: newArr }));
                              }}
                              className={`p-3 rounded-xl font-bold text-xs text-left border-2 transition-all flex items-center justify-between ${
                                isChecked
                                  ? 'bg-amber-500 text-white border-amber-600 shadow-sm'
                                  : 'bg-white text-slate-700 border-slate-200 hover:bg-amber-50'
                              }`}
                            >
                              <span>{opt}</span>
                              <span className="text-xs font-black">{isChecked ? '✓' : ''}</span>
                            </button>
                          );
                        })}
                      </div>
                    )}

                    {/* 3 & 4. ĐIỀN TỪ HOẶC TRẢ LỜI NGẮN */}
                    {(q.question_type === 'fill_blank' || q.question_type === 'short_answer') && (
                      <input
                        type="text"
                        disabled={!canEdit}
                        placeholder="Nhập câu trả lời của bé..."
                        value={currentAnswer || ''}
                        onChange={(e) => {
                          const val = e.target.value;
                          setAnswers(prev => ({ ...prev, [q.id]: val }));
                        }}
                        className="w-full px-3.5 py-2 bg-white border-2 border-amber-200 rounded-xl text-xs font-bold text-slate-800"
                      />
                    )}

                    {/* 5. TỰ LUẬN */}
                    {q.question_type === 'essay' && (
                      <textarea
                        rows="3"
                        disabled={!canEdit}
                        placeholder="Viết bài làm tự luận của bé tại đây..."
                        value={currentAnswer || ''}
                        onChange={(e) => {
                          const val = e.target.value;
                          setAnswers(prev => ({ ...prev, [q.id]: val }));
                        }}
                        className="w-full px-3.5 py-2 bg-white border-2 border-amber-200 rounded-xl text-xs font-bold text-slate-800"
                      ></textarea>
                    )}

                    {/* 6 & 7. NỘP FILE BÀI LÀM */}
                    {(q.question_type === 'image_upload' || q.question_type === 'file_upload') && (
                      <div className="space-y-2">
                        {canEdit && (
                          <div className="flex items-center gap-2">
                            <label className="px-4 py-2 bg-amber-100 hover:bg-amber-200 text-amber-900 font-extrabold text-xs rounded-xl border border-amber-300 cursor-pointer flex items-center gap-1.5">
                              <Upload className="w-4 h-4" /> Tải Lên File Bài Làm (JPG, PNG, PDF, DOCX)
                              <input
                                type="file"
                                accept={q.question_type === 'image_upload' ? 'image/*' : '.pdf,.doc,.docx,image/*'}
                                onChange={(e) => handleFileUpload(q.id, e.target.files[0])}
                                className="hidden"
                              />
                            </label>
                            {uploadingQId === q.id && (
                              <span className="text-xs font-bold text-slate-500 flex items-center gap-1">
                                <Loader2 className="w-3.5 h-3.5 animate-spin" /> Đang tải file lên...
                              </span>
                            )}
                          </div>
                        )}

                        {fileUrls[q.id] && (
                          <div className="p-3 bg-white rounded-xl border border-amber-200 flex items-center justify-between text-xs">
                            <span className="font-bold text-slate-700 truncate max-w-[240px]">
                              📁 File đã nộp: {fileUrls[q.id]}
                            </span>
                            {signedUrlsMap[q.id] && (
                              <a
                                href={signedUrlsMap[q.id]}
                                target="_blank"
                                rel="noreferrer"
                                className="px-3 py-1 bg-sky-600 text-white font-bold text-[11px] rounded-lg flex items-center gap-1"
                              >
                                <Eye className="w-3.5 h-3.5" /> Xem File Private (Signed URL)
                              </a>
                            )}
                          </div>
                        )}
                      </div>
                    )}

                  </div>
                );
              })}
            </div>
          )}

        </div>

        {/* BUTTONS */}
        {canEdit && (
          <div className="pt-4 border-t border-slate-200 flex justify-end gap-2 shrink-0">
            <button
              onClick={() => handleSubmitExercise(true)}
              disabled={isSubmitting}
              className="px-4 py-2 bg-slate-200 hover:bg-slate-300 text-slate-800 font-extrabold text-xs rounded-xl flex items-center gap-1"
            >
              <Save className="w-4 h-4" /> Lưu Bản Nháp
            </button>
            <button
              onClick={() => handleSubmitExercise(false)}
              disabled={isSubmitting}
              className="px-6 py-2 bg-amber-500 hover:bg-amber-600 text-white font-black text-xs rounded-xl shadow-md flex items-center gap-1.5 disabled:opacity-50"
            >
              {isSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              {isSubmitting ? 'Đang Nộp Bài...' : 'Nộp Bài Tập'}
            </button>
          </div>
        )}

      </div>
    </div>
  );
};
