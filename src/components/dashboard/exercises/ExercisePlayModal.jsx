import React, { useState, useEffect, useRef } from 'react';
import { 
  X, CheckCircle2, AlertCircle, Upload, FileText, Image as ImageIcon, 
  Send, Save, Clock, Star, Loader2, ArrowLeft, ArrowRight, RotateCcw, ChevronRight 
} from 'lucide-react';
import { supabase } from '../../../lib/supabase';
import { useAuth } from '../../../context/AuthContext';

export const ExercisePlayModal = ({ exercise, onClose }) => {
  const { profile } = useAuth();
  
  const [submissionId, setSubmissionId] = useState(null);
  const [questions, setQuestions] = useState([]);
  const [answersMap, setAnswersMap] = useState({});
  const [fileUrlsMap, setFileUrlsMap] = useState({});
  const [signedUrlsMap, setSignedUrlsMap] = useState({});

  // DÙNG USEREF ĐỂ TRÁNH ASYNCHRONOUS STATE RACE CONDITION KHI ROLLBACK FILE
  const newlyUploadedPathsRef = useRef([]);
  const pendingOldFileDeletionsRef = useRef([]);
  const previousFileUrlsMapRef = useRef({});
  const previousSignedUrlsMapRef = useRef({});

  const [currentQIndex, setCurrentQIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [successResult, setSuccessResult] = useState(null);

  const [historySubmissions, setHistorySubmissions] = useState([]);
  const [selectedAttemptTab, setSelectedAttemptTab] = useState(null);

  useEffect(() => {
    initExerciseSession();
  }, [exercise.id, profile?.id]);

  const initExerciseSession = async () => {
    setLoading(true);
    setErrorMsg('');

    try {
      // 1. Tải danh sách câu hỏi
      const { data: qData, error: qErr } = await supabase
        .from('academic_exercise_questions')
        .select('*')
        .eq('exercise_id', exercise.id)
        .order('question_number', { ascending: true });

      if (qErr || !qData) throw new Error('Không thể tải danh sách câu hỏi.');
      setQuestions(qData);

      // 2. Tải lịch sử các lượt nộp bài
      const { data: subData } = await supabase
        .from('academic_submissions')
        .select('*, academic_submission_answers(*)')
        .eq('exercise_id', exercise.id)
        .eq('student_id', profile?.id)
        .order('attempt_number', { ascending: true });

      if (subData && subData.length > 0) {
        setHistorySubmissions(subData);
        const lastSub = subData[subData.length - 1];

        if (lastSub.status === 'draft' || lastSub.status === 'revision_requested') {
          setSubmissionId(lastSub.id);
          setSelectedAttemptTab(lastSub.attempt_number);
          populateAnswersFromSubmission(lastSub, qData);
        } else {
          setSelectedAttemptTab(lastSub.attempt_number);
          populateAnswersFromSubmission(lastSub, qData);
        }
      } else {
        // BẮT BỘC TẠO DRAFT TỪ CRATE_OR_GET_SUBMISSION_DRAFT TRƯỚC KHI CHO NỘP FILE
        const { data: draftRes, error: draftErr } = await supabase.rpc('create_or_get_submission_draft', {
          p_exercise_id: exercise.id
        });

        if (draftErr || !draftRes?.success) {
          throw new Error(draftErr?.message || draftRes?.message || 'Lỗi khi khởi tạo lượt làm bài.');
        }

        setSubmissionId(draftRes.submission_id);
      }

    } catch (err) {
      console.error('Init exercise session error:', err);
      setErrorMsg(err.message || 'Lỗi kết nối khi nạp bài tập.');
    } finally {
      setLoading(false);
    }
  };

  const populateAnswersFromSubmission = async (subObj, qList) => {
    const initAns = {};
    const initFiles = {};
    const signedMap = {};

    if (subObj.academic_submission_answers) {
      for (const ans of subObj.academic_submission_answers) {
        if (ans.student_answer_json !== null) {
          initAns[ans.question_id] = ans.student_answer_json;
        }
        if (ans.file_url) {
          initFiles[ans.question_id] = ans.file_url;
          try {
            const { data: signRes } = await supabase.storage
              .from('exercise-submissions')
              .createSignedUrl(ans.file_url, 900);
            if (signRes?.signedUrl) {
              signedMap[ans.question_id] = signRes.signedUrl;
            }
          } catch (e) {
            console.error('Sign URL error:', e);
          }
        }
      }
    }

    setAnswersMap(initAns);
    setFileUrlsMap(initFiles);
    setSignedUrlsMap(signedMap);
    previousFileUrlsMapRef.current = { ...initFiles };
    previousSignedUrlsMapRef.current = { ...signedMap };
  };

  // QUY TRÌNH THAY FILE NGUYÊN TỬ: BƯỚC 1 UPLOAD FILE MỚI, BƯỚC 2 BẢO TỒN FILE CŨ
  const handleFileUpload = async (qId, file) => {
    if (!submissionId) {
      alert('Chưa có lượt làm bài (submission_id). Đang tự động khởi tạo...');
      const { data: draftRes } = await supabase.rpc('create_or_get_submission_draft', {
        p_exercise_id: exercise.id
      });
      if (draftRes?.submission_id) {
        setSubmissionId(draftRes.submission_id);
      } else {
        alert('Không thể tạo lượt nộp bài.');
        return;
      }
    }

    const currentSubId = submissionId;
    const fileExt = file.name.split('.').pop();
    const filePath = `${profile.id}/${currentSubId}/${qId}_${Date.now()}.${fileExt}`;

    setSubmitting(true);
    try {
      // 1. Upload file mới
      const { data: uploadData, error: uploadErr } = await supabase.storage
        .from('exercise-submissions')
        .upload(filePath, file, { upsert: true });

      if (uploadErr) throw uploadErr;

      const newFilePath = uploadData.path;
      newlyUploadedPathsRef.current.push(newFilePath);

      // 2. Giữ nguyên file cũ trong CSDL và Storage (chưa xóa)
      const oldPath = fileUrlsMap[qId];
      if (oldPath && oldPath !== newFilePath) {
        pendingOldFileDeletionsRef.current.push(oldPath);
      }

      // 3. Tạo Signed URL xem trước
      const { data: signData } = await supabase.storage
        .from('exercise-submissions')
        .createSignedUrl(newFilePath, 900);

      previousFileUrlsMapRef.current = { ...fileUrlsMap };
      previousSignedUrlsMapRef.current = { ...signedUrlsMap };

      setFileUrlsMap(prev => ({ ...prev, [qId]: newFilePath }));
      if (signData?.signedUrl) {
        setSignedUrlsMap(prev => ({ ...prev, [qId]: signData.signedUrl }));
      }

    } catch (err) {
      console.error('Upload file error:', err);
      alert('Tải file lên thất bại: ' + (err.message || 'Lỗi mạng'));
    } finally {
      setSubmitting(false);
    }
  };

  const handleSaveOrSubmit = async (isDraft = false) => {
    if (submitting) return;

    setSubmitting(true);
    setErrorMsg('');

    try {
      const formattedAnswers = questions.map(q => ({
        question_id: q.id,
        answer: answersMap[q.id] !== undefined ? answersMap[q.id] : null,
        file_url: fileUrlsMap[q.id] || null
      }));

      // BƯỚC 3: GỌI RPC NỘP/LƯU BÀI VỚI FILE MỚI
      const { data: submitRes, error: submitErr } = await supabase.rpc('submit_academic_exercise', {
        p_exercise_id: exercise.id,
        p_answers: formattedAnswers,
        p_is_draft: isDraft
      });

      // BƯỚC 4: XỬ LÝ THEO KẾT QUẢ RPC
      if (submitErr || !submitRes?.success) {
        // NẾU RPC THẤT BẠI: Xóa file mới, khôi phục UI về file cũ!
        if (newlyUploadedPathsRef.current.length > 0) {
          const { error: removeErr } = await supabase.storage
            .from('exercise-submissions')
            .remove(newlyUploadedPathsRef.current);
          if (removeErr) console.error('Remove newly uploaded paths error:', removeErr);
        }

        // Khôi phục UI về trạng thái file cũ
        setFileUrlsMap({ ...previousFileUrlsMapRef.current });
        setSignedUrlsMap({ ...previousSignedUrlsMapRef.current });

        newlyUploadedPathsRef.current = [];
        pendingOldFileDeletionsRef.current = [];
        throw new Error(submitErr?.message || submitRes?.message || 'Lỗi khi nộp bài tập.');
      }

      // NẾU RPC THÀNH CÔNG: Mới xóa các file cũ bị thay thế!
      if (pendingOldFileDeletionsRef.current.length > 0) {
        const { error: removeOldErr } = await supabase.storage
          .from('exercise-submissions')
          .remove(pendingOldFileDeletionsRef.current);
        if (removeOldErr) console.error('Remove old replaced paths error:', removeOldErr);
      }

      // Cập nhật mảng tham chiếu cũ
      previousFileUrlsMapRef.current = { ...fileUrlsMap };
      previousSignedUrlsMapRef.current = { ...signedUrlsMap };
      newlyUploadedPathsRef.current = [];
      pendingOldFileDeletionsRef.current = [];

      if (isDraft) {
        alert('Đã lưu bản nháp bài làm thành công!');
      } else {
        setSuccessResult(submitRes);
      }

    } catch (err) {
      console.error('Submit exercise error:', err);
      setErrorMsg(err.message || 'Lỗi hệ thống khi gửi bài nộp.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleCloseModal = async () => {
    // Chỉ xóa newlyUploadedPaths nếu đóng modal mà CHƯA bấm Lưu/Nộp bài thành công!
    if (newlyUploadedPathsRef.current.length > 0 && !successResult) {
      try {
        const { error: removeErr } = await supabase.storage
          .from('exercise-submissions')
          .remove(newlyUploadedPathsRef.current);
        if (removeErr) console.error('Cleanup newly uploaded files on close error:', removeErr);
      } catch (err) {
        console.error('Rollback session files exception:', err);
      }
    }
    onClose();
  };

  if (!exercise) return null;

  const currentQ = questions[currentQIndex];
  const activeSub = historySubmissions.find(s => s.attempt_number === selectedAttemptTab);
  const isViewingHistory = activeSub && activeSub.status !== 'draft' && activeSub.status !== 'revision_requested';

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-white w-full max-w-4xl rounded-3xl border-4 border-amber-300 shadow-2xl p-6 sm:p-8 animate-fadeIn max-h-[90vh] flex flex-col justify-between">
        
        {/* HEADER */}
        <div>
          <div className="flex items-center justify-between pb-4 border-b-2 border-amber-100">
            <div>
              <span className="px-3 py-1 bg-amber-100 text-amber-900 font-black text-xs rounded-xl border border-amber-300">
                Môn {exercise.subject} - {exercise.classes?.name ? `Lớp ${exercise.classes.name}` : 'Mọi lớp'}
              </span>
              <h2 className="text-xl font-black text-slate-800 mt-2">{exercise.title}</h2>
            </div>
            <button
              onClick={handleCloseModal}
              className="p-2 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-2xl transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* TAB LƯỢT LÀM BÀI LỊCH SỬ */}
          {historySubmissions.length > 0 && (
            <div className="flex items-center gap-2 mt-3 overflow-x-auto pb-1">
              <span className="text-xs font-bold text-slate-500 shrink-0">Lượt làm:</span>
              {historySubmissions.map(sub => (
                <button
                  key={sub.id}
                  onClick={() => {
                    setSelectedAttemptTab(sub.attempt_number);
                    populateAnswersFromSubmission(sub, questions);
                  }}
                  className={`px-3 py-1 rounded-xl text-xs font-black transition-all ${
                    selectedAttemptTab === sub.attempt_number
                      ? 'bg-amber-500 text-white shadow-sm'
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
                >
                  Lượt {sub.attempt_number} ({sub.status})
                </button>
              ))}
            </div>
          )}
        </div>

        {/* CONTENT */}
        {loading ? (
          <div className="p-12 text-center text-xs font-bold text-slate-400">
            <Loader2 className="w-8 h-8 animate-spin text-amber-500 mx-auto mb-2" /> Đang chuẩn bị bài tập...
          </div>
        ) : successResult ? (
          <div className="p-8 text-center bg-emerald-50 rounded-3xl border-2 border-emerald-300 my-4 space-y-4">
            <CheckCircle2 className="w-16 h-16 text-emerald-500 mx-auto" />
            <h3 className="text-xl font-black text-emerald-950">Nộp Bài Thành Công!</h3>
            <p className="text-xs font-bold text-emerald-800">{successResult.message}</p>
            
            <div className="inline-flex items-center gap-4 bg-white p-4 rounded-2xl border border-emerald-200">
              <div>
                <span className="block text-[11px] font-bold text-slate-400">Điểm Trắc Nghiệm</span>
                <span className="text-lg font-black text-emerald-600">{successResult.objective_score}/{successResult.max_score}</span>
              </div>
              {successResult.reward_stars_awarded > 0 && (
                <div className="pl-4 border-l border-slate-200 flex items-center gap-1">
                  <Star className="w-6 h-6 fill-amber-400 text-amber-500" />
                  <span className="text-base font-black text-amber-900">+{successResult.reward_stars_awarded} Sao</span>
                </div>
              )}
            </div>

            <div>
              <button
                onClick={onClose}
                className="px-6 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-black text-xs rounded-2xl shadow-md"
              >
                Hoàn Tất & Đóng
              </button>
            </div>
          </div>
        ) : (
          <div className="my-4 space-y-4 overflow-y-auto max-h-[60vh] pr-1">
            {errorMsg && (
              <div className="p-3 bg-rose-50 border border-rose-300 text-rose-800 rounded-xl text-xs font-bold flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0 text-rose-600" />
                <span>{errorMsg}</span>
              </div>
            )}

            {/* THANH ĐIỀU HƯỚNG CÂU HỎI */}
            <div className="flex items-center gap-1.5 overflow-x-auto pb-2">
              {questions.map((q, idx) => {
                const isAnswered = answersMap[q.id] !== undefined || fileUrlsMap[q.id];
                return (
                  <button
                    key={q.id}
                    onClick={() => setCurrentQIndex(idx)}
                    className={`w-8 h-8 rounded-xl font-black text-xs shrink-0 transition-all ${
                      currentQIndex === idx
                        ? 'bg-amber-500 text-white shadow-md scale-105'
                        : isAnswered
                        ? 'bg-emerald-100 text-emerald-800 border border-emerald-300'
                        : 'bg-slate-100 text-slate-600 border border-slate-200'
                    }`}
                  >
                    {idx + 1}
                  </button>
                );
              })}
            </div>

            {/* NỘI DUNG CÂU HỎI HIỆN TẠI */}
            {currentQ && (
              <div className="bg-amber-50/50 p-5 rounded-3xl border-2 border-amber-200 space-y-4">
                <div className="flex items-center justify-between">
                  <span className="px-3 py-1 bg-amber-500 text-white font-black text-xs rounded-xl">
                    Câu {currentQIndex + 1} / {questions.length} ({currentQ.points} điểm)
                  </span>
                  <span className="text-xs font-bold text-amber-800">Loại: {currentQ.question_type}</span>
                </div>

                <h3 className="text-base font-black text-slate-800">{currentQ.prompt}</h3>

                {/* KHU VỰC TRẢ LỜI THEO TYPE */}
                {currentQ.question_type === 'single_choice' && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    {currentQ.options_json?.map((opt, oIdx) => {
                      const isSelected = answersMap[currentQ.id] === opt;
                      return (
                        <button
                          key={oIdx}
                          disabled={isViewingHistory}
                          onClick={() => setAnswersMap(prev => ({ ...prev, [currentQ.id]: opt }))}
                          className={`p-3 rounded-2xl text-left font-bold text-xs transition-all border-2 ${
                            isSelected
                              ? 'bg-amber-500 text-white border-amber-600 shadow-md'
                              : 'bg-white text-slate-700 border-amber-200 hover:bg-amber-100/50'
                          }`}
                        >
                          {opt}
                        </button>
                      );
                    })}
                  </div>
                )}

                {currentQ.question_type === 'multiple_choice' && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    {currentQ.options_json?.map((opt, oIdx) => {
                      const currentArr = Array.isArray(answersMap[currentQ.id]) ? answersMap[currentQ.id] : [];
                      const isSelected = currentArr.includes(opt);
                      return (
                        <button
                          key={oIdx}
                          disabled={isViewingHistory}
                          onClick={() => {
                            let newArr = isSelected ? currentArr.filter(x => x !== opt) : [...currentArr, opt];
                            setAnswersMap(prev => ({ ...prev, [currentQ.id]: newArr }));
                          }}
                          className={`p-3 rounded-2xl text-left font-bold text-xs transition-all border-2 ${
                            isSelected
                              ? 'bg-amber-500 text-white border-amber-600 shadow-md'
                              : 'bg-white text-slate-700 border-amber-200 hover:bg-amber-100/50'
                          }`}
                        >
                          {isSelected ? '✓ ' : ''}{opt}
                        </button>
                      );
                    })}
                  </div>
                )}

                {(currentQ.question_type === 'fill_blank' || currentQ.question_type === 'short_answer') && (
                  <div>
                    <input
                      type="text"
                      disabled={isViewingHistory}
                      placeholder="Nhập câu trả lời của bé vào đây..."
                      value={answersMap[currentQ.id] || ''}
                      onChange={(e) => {
                        const val = e.target.value;
                        setAnswersMap(prev => ({ ...prev, [currentQ.id]: val }));
                      }}
                      className="w-full p-3 bg-white border-2 border-amber-200 rounded-2xl text-xs font-bold text-slate-800 focus:outline-none focus:border-amber-500"
                    />
                  </div>
                )}

                {currentQ.question_type === 'essay' && (
                  <div>
                    <textarea
                      rows="4"
                      disabled={isViewingHistory}
                      placeholder="Viết bài làm tự luận của bé tại đây..."
                      value={answersMap[currentQ.id] || ''}
                      onChange={(e) => {
                        const val = e.target.value;
                        setAnswersMap(prev => ({ ...prev, [currentQ.id]: val }));
                      }}
                      className="w-full p-3 bg-white border-2 border-amber-200 rounded-2xl text-xs font-bold text-slate-800 focus:outline-none focus:border-amber-500"
                    ></textarea>
                  </div>
                )}

                {(currentQ.question_type === 'image_upload' || currentQ.question_type === 'file_upload') && (
                  <div className="space-y-3">
                    {!isViewingHistory && (
                      <label className="flex flex-col items-center justify-center p-4 bg-white border-2 border-dashed border-amber-300 rounded-2xl cursor-pointer hover:bg-amber-50 transition-colors">
                        <Upload className="w-6 h-6 text-amber-500 mb-1" />
                        <span className="text-xs font-black text-amber-900">Nhấp để chọn ảnh / file bài làm</span>
                        <span className="text-[10px] font-bold text-slate-400">Định dạng JPG, PNG, WEBP, PDF, DOCX (Tối đa 10MB)</span>
                        <input
                          type="file"
                          accept="image/*,.pdf,.doc,.docx"
                          className="hidden"
                          onChange={(e) => {
                            if (e.target.files && e.target.files[0]) {
                              handleFileUpload(currentQ.id, e.target.files[0]);
                            }
                          }}
                        />
                      </label>
                    )}

                    {signedUrlsMap[currentQ.id] && (
                      <div className="p-3 bg-white border border-amber-200 rounded-2xl flex items-center justify-between">
                        <span className="text-xs font-bold text-emerald-800 flex items-center gap-1.5">
                          <CheckCircle2 className="w-4 h-4 text-emerald-600" /> Đã tải file bài làm
                        </span>
                        <a
                          href={signedUrlsMap[currentQ.id]}
                          target="_blank"
                          rel="noreferrer"
                          className="px-3 py-1 bg-amber-500 text-white font-black text-xs rounded-xl hover:bg-amber-600"
                        >
                          Xem File Nộp
                        </a>
                      </div>
                    )}
                  </div>
                )}

              </div>
            )}
          </div>
        )}

        {/* FOOTER ACTIONS */}
        {!successResult && (
          <div className="pt-4 border-t border-slate-200 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setCurrentQIndex(prev => Math.max(0, prev - 1))}
                disabled={currentQIndex === 0}
                className="px-3.5 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs rounded-xl flex items-center gap-1 disabled:opacity-40"
              >
                <ArrowLeft className="w-3.5 h-3.5" /> Câu Trước
              </button>
              <button
                type="button"
                onClick={() => setCurrentQIndex(prev => Math.min(questions.length - 1, prev + 1))}
                disabled={currentQIndex === questions.length - 1}
                className="px-3.5 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs rounded-xl flex items-center gap-1 disabled:opacity-40"
              >
                Câu Tiếp <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>

            {!isViewingHistory && (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => handleSaveOrSubmit(true)}
                  disabled={submitting}
                  className="px-4 py-2 bg-slate-200 hover:bg-slate-300 text-slate-800 font-bold text-xs rounded-xl flex items-center gap-1 disabled:opacity-50"
                >
                  <Save className="w-3.5 h-3.5" /> Lưu Nháp
                </button>
                <button
                  type="button"
                  onClick={() => handleSaveOrSubmit(false)}
                  disabled={submitting}
                  className="px-6 py-2 bg-amber-500 hover:bg-amber-600 text-white font-black text-xs rounded-xl shadow-md flex items-center gap-1.5 disabled:opacity-50"
                >
                  {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                  {submitting ? 'Đang Nộp Bài...' : 'Nộp Bài Ngay'}
                </button>
              </div>
            )}
          </div>
        )}

      </div>
    </div>
  );
};
