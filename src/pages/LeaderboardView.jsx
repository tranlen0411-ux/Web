import { Trophy, Medal, Star, Sparkles, Award, BookOpen, Gamepad2, Filter, Users, CheckCircle2, ChevronRight, AlertCircle, Settings, Calendar, Lock, Activity } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { LoadingSkeleton } from '../components/common/LoadingSkeleton';
import { useSound } from '../context/SoundContext';
import { useAuth } from '../context/AuthContext';
import { RankingPeriodModal } from '../components/dashboard/RankingPeriodModal';
import { StudentPeriodSummaryModal } from '../components/dashboard/StudentPeriodSummaryModal';
import { getAcademicTimeRangeBounds } from '../config/academicYearConfig';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isValidClassId = (id) => {
  return Boolean(
    id &&
    typeof id === 'string' &&
    id !== 'ALL' &&
    id !== 'ALL_IN_GRADE' &&
    id !== 'NO_CLASS' &&
    UUID_REGEX.test(id.trim())
  );
};

export const GAME_SOURCE_OPTIONS = [
  { value: 'ALL', label: 'Tất cả (Kho game + Bài tập)' },
  { value: 'LIBRARY', label: 'Kho Game Học Tập' },
  { value: 'ASSIGNED', label: 'Bài tập được giao' }
];

const VALID_GAME_SOURCES = ['ALL', 'LIBRARY', 'ASSIGNED'];
const normalizeGameSource = (val) => VALID_GAME_SOURCES.includes(val) ? val : 'ALL';

export const LeaderboardView = () => {
  const { globalClassFilter, setGlobalClassFilter } = useAuth();
  const { triggerSound } = useSound();
  
  // Refs chống race condition khi chuyển lớp nhanh liên tục
  const latestGameReqIdRef = useRef(0);
  const latestAcademicReqIdRef = useRef(0);

  // Tab chế độ: 'game' (Xếp hạng Trò chơi) | 'academic' (Xếp hạng Học thuật)
  const [activeTab, setActiveTab] = useState('game');

  // --- THÔNG TIN THÀNH VIÊN VÀ TOÀN BỘ LỚP TRONG HỆ THỐNG ---
  const [currentUser, setCurrentUser] = useState(null);
  const [userProfile, setUserProfile] = useState(null);
  const [allSystemClasses, setAllSystemClasses] = useState([]);
  const [userMyClasses, setUserMyClasses] = useState([]);

  // --- STATE KỲ XẾP HẠNG (RANKING PERIODS V1) ---
  const [classPeriods, setClassPeriods] = useState([]);
  const [selectedPeriodId, setSelectedPeriodId] = useState('');
  const [isPeriodModalOpen, setIsPeriodModalOpen] = useState(false);
  
  // --- STATE TỔNG KẾT HỌC SINH (STUDENT PERIOD SUMMARY MODAL) ---
  const [summaryStudentId, setSummaryStudentId] = useState(null);
  const [isSummaryModalOpen, setIsSummaryModalOpen] = useState(false);

  // --- STATE BỘ LỌC 5 TẦNG TRÒ CHƠI ---
  const [gameGradeFilter, setGameGradeFilter] = useState('ALL');
  const [gameClassFilter, setGameClassFilter] = useState('ALL_IN_GRADE');
  const [gameSubjectFilter, setGameSubjectFilter] = useState('ALL');
  const [gameTimeRange, setGameTimeRange] = useState('ALL');
  const [gameSourceFilter, setGameSourceFilter] = useState('ALL');
  const [availableGameSubjects, setAvailableGameSubjects] = useState([]);
  const [gameStudents, setGameStudents] = useState([]);
  const [loadingGame, setLoadingGame] = useState(false);
  const [gameError, setGameError] = useState('');

  // --- STATE DÀNH CHO TAB HỌC THUẬT ---
  const [selectedAcademicClassId, setSelectedAcademicClassId] = useState('');
  const [academicSubject, setAcademicSubject] = useState('ALL');
  const [academicTimeRange, setAcademicTimeRange] = useState('ALL');
  const [academicData, setAcademicData] = useState(null);
  const [loadingAcademic, setLoadingAcademic] = useState(false);
  const [academicError, setAcademicError] = useState('');

  // 1. Load thông tin User đăng nhập & Toàn bộ danh sách Lớp học & Môn học
  useEffect(() => {
    fetchUserProfileAndClasses();
    fetchAvailableGameSubjects();
  }, []);

  // 1b. ĐỒNG BỘ 1 CHIỀU TỪ GLOBAL CLASS FILTER (AUTH CONTEXT) VÀO CÁC STATE PHỤ CỦA LEADERBOARD
  // LƯU Ý QUAN TRỌNG: TUYỆT ĐỐI KHÔNG GỌI setGlobalClassFilter TRONG EFFECT NÀY ĐỂ TRÁNH VÒNG LẶP STATE VÔ HẠN
  useEffect(() => {
    if (!allSystemClasses || allSystemClasses.length === 0) return;

    if (isValidClassId(globalClassFilter)) {
      const targetClass = allSystemClasses.find(c => c.id === globalClassFilter);
      if (targetClass) {
        // Phân quyền Teacher: chỉ đồng bộ nếu thuộc lớp phụ trách
        if (userProfile?.role === 'teacher') {
          const isManaged = userMyClasses.some(c => c.id === targetClass.id);
          if (!isManaged) return;
        }
        // Phân quyền Student: chỉ đồng bộ nếu là thành viên lớp
        if (userProfile?.role === 'student') {
          const isMember = userMyClasses.some(c => c.id === targetClass.id);
          if (!isMember) return;
        }

        setSelectedAcademicClassId(targetClass.id);
        setGameClassFilter(targetClass.id);
        if (targetClass.grade_level) {
          setGameGradeFilter(targetClass.grade_level);
        }
      }
    } else if (globalClassFilter === 'NO_CLASS') {
      setSelectedAcademicClassId('');
      setGameClassFilter('ALL_IN_GRADE');
      setGameGradeFilter('ALL');
    } else if (globalClassFilter === 'ALL') {
      setGameClassFilter('ALL_IN_GRADE');
      setGameGradeFilter('ALL');
      if (userProfile?.role === 'admin') {
        setSelectedAcademicClassId('');
      }
    }
  }, [globalClassFilter, allSystemClasses, userMyClasses, userProfile?.role]);

  const fetchUserProfileAndClasses = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      setCurrentUser(user);

      const { data: profile } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', user.id)
        .single();

      setUserProfile(profile);

      // Tải tất cả các lớp trong hệ thống
      const { data: sysClasses } = await supabase
        .from('classes')
        .select('*')
        .order('grade_level', { ascending: true })
        .order('name', { ascending: true });

      setAllSystemClasses(sysClasses || []);

      // Xác định các lớp gắn liền với vai trò người dùng
      if (profile?.role === 'student') {
        const { data: cm } = await supabase
          .from('class_members')
          .select('class_id, classes(*)')
          .eq('student_id', user.id);

        const myClasses = (cm || []).map(item => item.classes).filter(Boolean);
        setUserMyClasses(myClasses);
        if (!isValidClassId(globalClassFilter) && myClasses.length > 0) {
          setSelectedAcademicClassId(myClasses[0].id);
          fetchClassPeriods(myClasses[0].id, profile?.role);
        }
        if (!isValidClassId(globalClassFilter) && profile?.grade_level) {
          setGameGradeFilter(profile.grade_level);
        }

      } else if (profile?.role === 'teacher') {
        const myClasses = (sysClasses || []).filter(c => c.teacher_id === user.id);
        setUserMyClasses(myClasses);
        if (!isValidClassId(globalClassFilter) && myClasses.length > 0) {
          setSelectedAcademicClassId(myClasses[0].id);
          fetchClassPeriods(myClasses[0].id, profile?.role);
        }

      } else if (profile?.role === 'admin') {
        setUserMyClasses(sysClasses || []);
        if (!isValidClassId(globalClassFilter) && sysClasses && sysClasses.length > 0) {
          setSelectedAcademicClassId(sysClasses[0].id);
          fetchClassPeriods(sysClasses[0].id, profile?.role);
        }
      }
    } catch (err) {
      console.error('Fetch user profile and classes error:', err);
    }
  };

  // TẢI DANH SÁCH MÔN HỌC THẬT CỦA CÁC TRÒ CHƠI TỪ CSDL
  const fetchAvailableGameSubjects = async () => {
    try {
      const { data, error } = await supabase.from('games').select('subject');
      if (!error && data) {
        const subjects = Array.from(new Set(data.map(g => g.subject).filter(Boolean)));
        setAvailableGameSubjects(subjects);
      }
    } catch (err) {
      console.error('Fetch game subjects error:', err);
    }
  };

  // HÀM LẤY CLASS ID UUID HỢP LỆ (BẢO VỆ CHỐNG TRUYỀN ALL_IN_GRADE HOẶC NO_CLASS CHO RANKING PERIOD MODAL)
  const getValidManagedClassId = () => {
    if (isValidClassId(globalClassFilter)) {
      return globalClassFilter;
    }
    const targetId = activeTab === 'academic' ? selectedAcademicClassId : gameClassFilter;
    if (!isValidClassId(targetId)) {
      return '';
    }
    return targetId;
  };

  // 2. FETCH CÁC KỲ XẾP HẠNG THEO LỚP ĐƯỢC CHỌN (BẢO VỆ CHỐNG TRUYỀN ALL_IN_GRADE & PHÂN QUYỀN VAI TRÒ)
  const fetchClassPeriods = async (classId, roleParam) => {
    if (!isValidClassId(classId)) {
      setClassPeriods([]);
      setSelectedPeriodId('');
      return;
    }
    try {
      const currentRole = roleParam || userProfile?.role;
      let query = supabase
        .from('ranking_periods')
        .select('*')
        .eq('class_id', classId)
        .order('created_at', { ascending: false });

      // Học sinh chỉ được lấy kỳ ACTIVE và CLOSED, tuyệt đối không thấy DRAFT
      if (currentRole === 'student') {
        query = query.in('status', ['ACTIVE', 'CLOSED']);
      }

      const { data, error } = await query;

      if (!error && data) {
        // Filter bảo vệ thêm cho học sinh trên UI
        const visiblePeriods = (data || []).filter(p => currentRole !== 'student' || p.status !== 'DRAFT');
        setClassPeriods(visiblePeriods);

        const activePeriod = visiblePeriods.find(p => p.status === 'ACTIVE');
        if (activePeriod) {
          setSelectedPeriodId(activePeriod.id);
        } else {
          setSelectedPeriodId('');
        }
      }
    } catch (err) {
      console.error('Fetch class periods error:', err);
    }
  };

  useEffect(() => {
    const activeClassId = getValidManagedClassId();
    if (activeClassId) {
      fetchClassPeriods(activeClassId, userProfile?.role);
    } else {
      setClassPeriods([]);
      setSelectedPeriodId('');
    }
  }, [selectedAcademicClassId, gameClassFilter, activeTab, userProfile]);

  // 4. FETCH BẢNG XẾP HẠNG TRÒ CHƠI (TÍCH HỢP KỲ XẾP HẠNG V1 & BỘ LỌC 5 TẦNG & CHỐNG RACE CONDITION)
  useEffect(() => {
    if (activeTab === 'game') {
      fetchGameLeaderboard();
    }
  }, [activeTab, gameGradeFilter, gameClassFilter, gameSubjectFilter, gameTimeRange, gameSourceFilter, selectedPeriodId]);

  const fetchGameLeaderboard = async () => {
    const currentReqId = ++latestGameReqIdRef.current;
    setLoadingGame(true);
    setGameError('');
    try {
      // TRƯỜNG HỢP 1: ĐANG CHỌN MỘT KỲ XẾP HẠNG CỤ THỂ -> ƯU TIÊN DỮ LIỆU KỲ
      if (selectedPeriodId) {
        const currentPeriodObj = classPeriods.find(p => p.id === selectedPeriodId);
        // Với kỳ CLOSED: snapshot bất biến lưu tổng điểm -> truyền 'ALL'
        const rpcSource = currentPeriodObj?.status === 'CLOSED' ? 'ALL' : normalizeGameSource(gameSourceFilter);

        const { data: periodLeaderboard, error: periodErr } = await supabase.rpc('get_game_period_leaderboard', {
          p_period_id: selectedPeriodId,
          p_source: rpcSource
        });

        if (currentReqId !== latestGameReqIdRef.current) return;

        if (periodErr) {
          setGameError('Lỗi khi tải dữ liệu Kỳ xếp hạng: ' + periodErr.message);
          setGameStudents([]);
          return;
        }

        if (periodLeaderboard && !Array.isArray(periodLeaderboard) && periodLeaderboard.success === false) {
          setGameError(periodLeaderboard.message || 'Từ chối truy cập Kỳ xếp hạng.');
          setGameStudents([]);
          return;
        }

        if (Array.isArray(periodLeaderboard)) {
          setGameStudents(periodLeaderboard.map(st => ({
            id: st.student_id,
            full_name: st.full_name,
            avatar_url: st.avatar_url,
            student_code: st.student_code,
            total_stars: st.period_stars,
            accumulated_stars: st.total_stars,
            completed_count: st.completed_count,
            rank: st.rank,
            is_tied: st.is_tied
          })));
          return;
        }
      }

      // TRƯỜNG HỢP 2: KHÔNG CHỌN KỲ CỤ THỂ -> ÁP DỤNG BỘ LỌC 4 TẦNG (KHỐI -> LỚP -> MÔN -> THỜI GIAN NĂM HỌC 2026-2027)
      const timeBounds = getAcademicTimeRangeBounds(gameTimeRange);

      let validStudentProfiles = [];

      if (gameClassFilter !== 'ALL_IN_GRADE' && isValidClassId(gameClassFilter)) {
        if (userProfile?.role === 'teacher') {
          const isManaged = userMyClasses.some(c => c.id === gameClassFilter);
          if (!isManaged) {
            if (currentReqId === latestGameReqIdRef.current) {
              setGameStudents([]);
            }
            return;
          }
        }

        const { data: members } = await supabase
          .from('class_members')
          .select('student_id, class_id, profiles!inner(*), classes!inner(name, grade_level)')
          .eq('class_id', gameClassFilter)
          .eq('profiles.role', 'student');

        if (currentReqId !== latestGameReqIdRef.current) return;

        validStudentProfiles = (members || []).map(m => ({
          ...m.profiles,
          class_name: m.classes?.name,
          grade_level: m.classes?.grade_level || m.profiles?.grade_level
        }));

      } else {
        let query = supabase
          .from('profiles')
          .select('*')
          .eq('role', 'student');

        if (gameGradeFilter !== 'ALL') {
          query = query.eq('grade_level', parseInt(gameGradeFilter));
        }

        const { data: profiles } = await query;

        if (currentReqId !== latestGameReqIdRef.current) return;

        if (profiles && profiles.length > 0) {
          const studentIds = profiles.map(p => p.id);
          const { data: members } = await supabase
            .from('class_members')
            .select('student_id, classes(name)')
            .in('student_id', studentIds);

          if (currentReqId !== latestGameReqIdRef.current) return;

          const studentClassMap = {};
          (members || []).forEach(m => {
            if (m.classes?.name) studentClassMap[m.student_id] = m.classes.name;
          });

          validStudentProfiles = profiles.map(p => ({
            ...p,
            class_name: studentClassMap[p.id] || null
          }));
        }
      }

      if (validStudentProfiles.length === 0) {
        if (currentReqId === latestGameReqIdRef.current) {
          setGameStudents([]);
        }
        return;
      }

      // Xử lý bộ lọc môn học, nguồn hoạt động và thời gian
      const studentIds = validStudentProfiles.map(p => p.id);
      let progressQuery = supabase
        .from('student_progress')
        .select('student_id, stars_earned, completed_at, assignment_id, games!inner(subject)')
        .in('student_id', studentIds)
        .eq('status', 'completed');

      if (gameSubjectFilter !== 'ALL') {
        progressQuery = progressQuery.eq('games.subject', gameSubjectFilter);
      }

      if (gameSourceFilter === 'LIBRARY') {
        progressQuery = progressQuery.is('assignment_id', null);
      } else if (gameSourceFilter === 'ASSIGNED') {
        progressQuery = progressQuery.not('assignment_id', 'is', null);
      }

      if (timeBounds.start) {
        progressQuery = progressQuery.gte('completed_at', timeBounds.start);
      }
      if (timeBounds.end) {
        progressQuery = progressQuery.lt('completed_at', timeBounds.end);
      }

      const { data: progressData, error: progressErr } = await progressQuery;

      if (currentReqId !== latestGameReqIdRef.current) return;

      if (progressErr) {
        console.error('Fetch student progress error:', progressErr);
      }

      const studentStatsMap = {};
      (progressData || []).forEach(row => {
        const sid = row.student_id;
        if (!studentStatsMap[sid]) {
          studentStatsMap[sid] = { total_stars: 0, completed_count: 0 };
        }
        studentStatsMap[sid].total_stars += row.stars_earned || 0;
        studentStatsMap[sid].completed_count += 1;
      });

      const filteredStudents = validStudentProfiles.map(st => ({
        ...st,
        total_stars: studentStatsMap[st.id]?.total_stars || 0,
        completed_count: studentStatsMap[st.id]?.completed_count || 0,
        accumulated_stars: st.total_stars
      })).sort((a, b) => b.total_stars - a.total_stars || (b.total_coins || 0) - (a.total_coins || 0));

      let currentRank = 1;
      const rankedFiltered = filteredStudents.map((st, idx, arr) => {
        const isTied = idx > 0 && st.total_stars === arr[idx - 1].total_stars;
        if (!isTied) currentRank = idx + 1;
        return {
          ...st,
          rank: currentRank,
          is_tied: isTied || (idx < arr.length - 1 && st.total_stars === arr[idx + 1].total_stars)
        };
      });

      if (currentReqId === latestGameReqIdRef.current) {
        setGameStudents(rankedFiltered);
      }
    } catch (err) {
      if (currentReqId === latestGameReqIdRef.current) {
        console.error('Fetch game leaderboard error:', err);
        setGameError('Lỗi khi tải bảng xếp hạng: ' + err.message);
      }
    } finally {
      if (currentReqId === latestGameReqIdRef.current) {
        setLoadingGame(false);
      }
    }
  };

  // 5. FETCH BẢNG XẾP HẠNG HỌC THUẬT (MAPPING KHỚP 100% CHUẨN OUTPUT RPC THẬT & CHỐNG RACE CONDITION)
  useEffect(() => {
    if (activeTab === 'academic') {
      if (isValidClassId(selectedAcademicClassId)) {
        fetchAcademicLeaderboard();
      } else {
        setAcademicData(null);
      }
    }
  }, [activeTab, selectedAcademicClassId, academicSubject, academicTimeRange, selectedPeriodId]);

  const fetchAcademicLeaderboard = async () => {
    if (!isValidClassId(selectedAcademicClassId)) {
      setAcademicData(null);
      setLoadingAcademic(false);
      return;
    }
    const currentReqId = ++latestAcademicReqIdRef.current;
    setLoadingAcademic(true);
    setAcademicError('');

    try {
      // 1. Nếu chọn Kỳ Xếp Hạng cụ thể -> Gọi RPC get_academic_period_leaderboard
      if (selectedPeriodId) {
        const { data: periodAcademic, error: pErr } = await supabase.rpc('get_academic_period_leaderboard', {
          p_period_id: selectedPeriodId,
          p_subject: academicSubject
        });

        if (currentReqId !== latestAcademicReqIdRef.current) return;

        if (pErr) {
          setAcademicError('Lỗi khi tải dữ liệu Kỳ xếp hạng học thuật: ' + pErr.message);
          setAcademicData(null);
          return;
        }

        if (periodAcademic && !Array.isArray(periodAcademic) && periodAcademic.success === false) {
          setAcademicError(periodAcademic.message || 'Từ chối truy cập Kỳ xếp hạng học thuật.');
          setAcademicData(null);
          return;
        }

        if (Array.isArray(periodAcademic)) {
          setAcademicData({
            success: true,
            total_valid_exercises: periodAcademic[0]?.total_valid_count || 0,
            total_class_max_score: 100,
            leaderboard: periodAcademic.map(st => ({
              student_id: st.student_id,
              rank: st.rank,
              is_tied: st.is_tied,
              full_name: st.full_name,
              avatar_url: st.avatar_url,
              student_code: st.student_code,
              completed_count: st.completed_count,
              total_valid_count: st.total_valid_count,
              academic_score_pct: st.academic_score_pct,
              completion_rate_pct: st.completion_rate_pct,
              avg_score: st.avg_score !== undefined ? st.avg_score : (st.academic_score_pct / 10).toFixed(1),
              total_earned_score: st.total_earned_score !== undefined ? st.total_earned_score : st.academic_score_pct
            }))
          });
          return;
        }
      }

      // 2. Nếu không chọn kỳ cụ thể -> Gọi RPC get_academic_class_leaderboard tổng thể
      const { data: rpcRes, error: rpcErr } = await supabase.rpc('get_academic_class_leaderboard', {
        p_class_id: selectedAcademicClassId,
        p_time_range: academicTimeRange,
        p_subject: academicSubject
      });

      if (currentReqId !== latestAcademicReqIdRef.current) return;

      if (rpcErr) {
        let errMsg = rpcErr.message || 'Lỗi hệ thống khi tải bảng xếp hạng.';
        if (errMsg.includes('function') || rpcErr.code === 'PGRST202') {
          errMsg = '❌ CSDL chưa nạp RPC [get_academic_class_leaderboard].';
        }
        setAcademicError(errMsg);
        setAcademicData(null);
      } else if (rpcRes && rpcRes.success) {
        setAcademicData(rpcRes);
      } else {
        setAcademicError(rpcRes?.message || 'Không thể lấy dữ liệu Bảng xếp hạng Học thuật.');
        setAcademicData(null);
      }
    } catch (err) {
      if (currentReqId === latestAcademicReqIdRef.current) {
        console.error('Fetch academic leaderboard error:', err);
        setAcademicError('Lỗi kết nối: ' + err.message);
      }
    } finally {
      if (currentReqId === latestAcademicReqIdRef.current) {
        setLoadingAcademic(false);
      }
    }
  };

  const formatClassLabel = (name) => {
    if (!name) return 'Lớp Học';
    if (name.toLowerCase().startsWith('lớp') || name.toLowerCase().startsWith('khối')) return name;
    return `Lớp ${name}`;
  };

  // THAO TÁC 1: Đổi Khối trong Tab Game (Ghi nhận lên Header mở rộng thành ALL)
  const handleGameGradeChange = (newGrade) => {
    triggerSound('click');
    setGameGradeFilter(newGrade);
    setGameClassFilter('ALL_IN_GRADE');
    setGlobalClassFilter('ALL');
  };

  // THAO TÁC 2: Đổi Lớp trong Tab Game (Đồng bộ 2 chiều - Ghi ngược lên Header)
  const handleGameClassChange = (newClassId) => {
    triggerSound('click');
    if (newClassId === 'ALL_IN_GRADE') {
      setGameClassFilter('ALL_IN_GRADE');
      setGlobalClassFilter('ALL');
    } else if (isValidClassId(newClassId)) {
      if (userProfile?.role === 'teacher') {
        const isManaged = userMyClasses.some(c => c.id === newClassId);
        if (!isManaged) return;
      }
      setGlobalClassFilter(newClassId);
    }
  };

  // THAO TÁC 3: Đổi Lớp trong Tab Academic (Đồng bộ 2 chiều - Ghi ngược lên Header)
  const handleAcademicClassChange = (newClassId) => {
    triggerSound('click');
    if (isValidClassId(newClassId)) {
      if (userProfile?.role === 'teacher') {
        const isManaged = userMyClasses.some(c => c.id === newClassId);
        if (!isManaged) return;
      }
      setGlobalClassFilter(newClassId);
    } else if (newClassId === 'ALL' || newClassId === '') {
      setSelectedAcademicClassId('');
      setGlobalClassFilter('ALL');
    }
  };

  const getGameAvailableGrades = () => {
    if (userProfile?.role === 'admin') {
      return ['ALL', 1, 2, 3, 4, 5];
    } else if (userProfile?.role === 'teacher') {
      return [1, 2, 3, 4, 5];
    } else if (userProfile?.role === 'student') {
      return [userProfile?.grade_level || 1];
    }
    return [1, 2, 3, 4, 5];
  };

  // 6. KHÔI PHỤC CHÍNH XÁC PHÂN QUYỀN LỌC LỚP TRONG KHỐI
  const getGameClassesForSelectedGrade = () => {
    if (gameGradeFilter === 'ALL') {
      if (userProfile?.role === 'admin') return allSystemClasses;
      if (userProfile?.role === 'teacher') return userMyClasses;
      return userMyClasses;
    }
    const gradeNum = parseInt(gameGradeFilter);
    const classesInGrade = allSystemClasses.filter(c => c.grade_level === gradeNum);

    if (userProfile?.role === 'admin') {
      return classesInGrade;
    } else if (userProfile?.role === 'teacher') {
      return classesInGrade.filter(c => c.teacher_id === currentUser?.id);
    } else if (userProfile?.role === 'student') {
      return classesInGrade.filter(c => userMyClasses.some(mc => mc.id === c.id));
    }
    return classesInGrade;
  };

  const getGameLeaderboardTitle = () => {
    if (selectedPeriodId) {
      const pObj = classPeriods.find(p => p.id === selectedPeriodId);
      return `🏆 Bảng Xếp Hạng Thi Đua: ${pObj?.name || 'Kỳ xếp hạng'}`;
    }
    let titleStr = '🎮 Bảng Xếp Hạng Trò Chơi';
    if (gameGradeFilter === 'ALL') {
      titleStr += ' – Toàn Trường';
    } else if (gameClassFilter === 'ALL_IN_GRADE') {
      titleStr += ` – Khối ${gameGradeFilter} (Tất cả lớp)`;
    } else {
      const targetClass = allSystemClasses.find(c => c.id === gameClassFilter);
      titleStr += ` – ${formatClassLabel(targetClass?.name)}`;
    }

    if (gameSubjectFilter !== 'ALL') {
      titleStr += ` [Môn ${gameSubjectFilter}]`;
    }
    if (gameSourceFilter === 'LIBRARY') {
      titleStr += ' [Kho Game]';
    } else if (gameSourceFilter === 'ASSIGNED') {
      titleStr += ' [Bài tập được giao]';
    }
    if (gameTimeRange === 'WEEK') {
      titleStr += ' [Tuần này]';
    } else if (gameTimeRange === 'MONTH') {
      titleStr += ' [Tháng này]';
    } else if (gameTimeRange === 'HK1') {
      titleStr += ' [Học kỳ 1 (2026-2027)]';
    } else if (gameTimeRange === 'HK2') {
      titleStr += ' [Học kỳ 2 (2026-2027)]';
    } else if (gameTimeRange === 'FULL_YEAR') {
      titleStr += ' [Cả năm 2026-2027]';
    }

    return titleStr;
  };

  const getRankBadge = (rank, isTied = false) => {
    switch (rank) {
      case 1:
        return (
          <div className="flex flex-col items-center">
            <span className="text-3xl">🥇</span>
            {isTied && <span className="text-[10px] font-black text-amber-900 bg-amber-200 px-1.5 py-0.5 rounded-full">Đồng hạng</span>}
          </div>
        );
      case 2:
        return (
          <div className="flex flex-col items-center">
            <span className="text-3xl">🥈</span>
            {isTied && <span className="text-[10px] font-black text-slate-700 bg-slate-200 px-1.5 py-0.5 rounded-full">Đồng hạng</span>}
          </div>
        );
      case 3:
        return (
          <div className="flex flex-col items-center">
            <span className="text-3xl">🥉</span>
            {isTied && <span className="text-[10px] font-black text-orange-700 bg-orange-200 px-1.5 py-0.5 rounded-full">Đồng hạng</span>}
          </div>
        );
      default:
        return (
          <div className="flex flex-col items-center">
            <span className="w-8 h-8 rounded-full bg-amber-100 border-2 border-amber-300 flex items-center justify-center font-black text-amber-900 text-sm">
              {rank}
            </span>
            {isTied && <span className="text-[9px] font-black text-slate-600 bg-slate-100 px-1 py-0.2 rounded-full mt-0.5">Đồng hạng</span>}
          </div>
        );
    }
  };

  // NẠP VÀ BẢO VỆ PHÂN QUYỀN CLICK XEM SUMMARY
  const handleOpenStudentSummary = (targetStudentId) => {
    if (!selectedPeriodId) return;

    if (userProfile?.role === 'student') {
      if (targetStudentId !== currentUser?.id) {
        alert('Học sinh chỉ được phép xem nhận xét tổng kết của chính mình.');
        return;
      }
    } else if (userProfile?.role === 'teacher') {
      const activeClassId = activeTab === 'academic' ? selectedAcademicClassId : gameClassFilter;
      const isManaged = userMyClasses.some(c => c.id === activeClassId);
      if (!isManaged) {
        alert('Bạn không có quyền xem nhận xét lớp này.');
        return;
      }
    }

    setSummaryStudentId(targetStudentId);
    setIsSummaryModalOpen(true);
  };

  const canManagePeriods = userProfile?.role === 'admin' || userProfile?.role === 'teacher';
  const validManagedClassId = getValidManagedClassId();

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      
      {/* HEADER BẢNG XẾP HẠNG VỚI TAB CHUYỂN ĐỔI CHẾ ĐỘ */}
      <div className="bg-gradient-to-r from-amber-400 via-yellow-400 to-amber-500 rounded-3xl border-4 border-amber-600 p-6 sm:p-8 text-center text-amber-950 shadow-xl mb-6">
        <Trophy className="w-16 h-16 text-amber-900 mx-auto mb-2 animate-bounce" />
        <h1 className="text-3xl font-black">BẢNG XẾP HẠNG VUI HỌC TIỂU HỌC</h1>
        <p className="text-xs sm:text-sm font-bold text-amber-900 mt-1 max-w-md mx-auto">
          Tuyên dương các bé học sinh có điểm số xuất sắc và thành tích thi đua cao nhất!
        </p>

        {/* CHỌN TAB CHẾ ĐỘ */}
        <div className="mt-6 flex justify-center gap-2 max-w-md mx-auto p-1.5 bg-amber-950/20 backdrop-blur-md rounded-2xl border border-amber-600">
          <button
            type="button"
            onClick={() => { setActiveTab('game'); triggerSound('click'); }}
            className={`flex-1 py-2.5 px-4 rounded-xl font-black text-xs sm:text-sm transition-all flex items-center justify-center gap-2 ${
              activeTab === 'game'
                ? 'bg-amber-950 text-amber-300 shadow-md scale-105'
                : 'text-amber-950 hover:bg-white/20'
            }`}
          >
            <Gamepad2 className="w-4 h-4" /> 🎮 Xếp Hạng Trò Chơi
          </button>
          
          <button
            type="button"
            onClick={() => { setActiveTab('academic'); triggerSound('click'); }}
            className={`flex-1 py-2.5 px-4 rounded-xl font-black text-xs sm:text-sm transition-all flex items-center justify-center gap-2 ${
              activeTab === 'academic'
                ? 'bg-indigo-950 text-indigo-200 shadow-md scale-105'
                : 'text-amber-950 hover:bg-white/20'
            }`}
          >
            <BookOpen className="w-4 h-4 text-indigo-300" /> 📘 Xếp Hạng Học Thuật
          </button>
        </div>
      </div>

      {/* THANH KỲ XẾP HẠNG & NÚT QUẢN LÝ KỲ XẾP HẠNG (RANKING PERIOD V1) */}
      <div className="mb-6 p-4 bg-indigo-50/80 rounded-3xl border-2 border-indigo-200 flex flex-col sm:flex-row items-center justify-between gap-3 shadow-sm">
        <div className="flex items-center gap-2 w-full sm:w-auto">
          <Calendar className="w-5 h-5 text-indigo-600 shrink-0" />
          <span className="text-xs font-black text-indigo-950 shrink-0">Kỳ Xếp Hạng:</span>
          <select
            value={selectedPeriodId}
            onChange={(e) => setSelectedPeriodId(e.target.value)}
            className="w-full sm:w-auto p-2 bg-white border-2 border-indigo-200 rounded-xl text-xs font-black text-indigo-950 focus:outline-none"
          >
            <option value="">-- Toàn bộ thời gian (Tích lũy tổng) --</option>
            {classPeriods
              .filter(p => userProfile?.role !== 'student' || p.status !== 'DRAFT')
              .map(p => (
                <option key={p.id} value={p.id}>
                  {p.name} {p.status === 'ACTIVE' ? '🟢 (Đang diễn ra)' : p.status === 'CLOSED' ? '🔒 (Đã kết thúc)' : '📝 (Bản nháp)'}
                </option>
              ))}
          </select>
        </div>

        {canManagePeriods && (
          validManagedClassId ? (
            <button
              onClick={() => setIsPeriodModalOpen(true)}
              className="w-full sm:w-auto px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-2xl text-xs font-black transition-all flex items-center justify-center gap-1.5 shadow-md"
            >
              <Settings className="w-4 h-4 text-amber-300" /> ⚙️ Quản Lý Kỳ Xếp Hạng
            </button>
          ) : (
            <div className="w-full sm:w-auto px-3 py-1.5 bg-amber-100 border border-amber-300 rounded-2xl text-[11px] font-bold text-amber-900 text-center flex items-center justify-center gap-1">
              <span>⚠️ Chọn 1 lớp cụ thể để quản lý kỳ</span>
            </div>
          )
        )}
      </div>

      {/* ========================================================================= */}
      {/* TAB 1: BẢNG XẾP HẠNG TRÒ CHƠI                                              */}
      {/* ========================================================================= */}
      {activeTab === 'game' && (
        <div className="space-y-6">
          
          {/* BỘ LỌC 5 TẦNG TRÒ CHƠI KHUNG NĂM HỌC 2026-2027 */}
          <div className="bg-amber-50/80 p-5 rounded-3xl border-2 border-amber-200 space-y-4 shadow-sm">
            <div className="flex items-center justify-between border-b border-amber-200/60 pb-3">
              <h3 className="text-sm font-black text-amber-950 flex items-center gap-1.5">
                <Gamepad2 className="w-4 h-4 text-amber-600" /> {getGameLeaderboardTitle()}
              </h3>
              <span className="text-[11px] font-bold bg-amber-200 text-amber-950 px-2.5 py-0.5 rounded-full">
                {selectedPeriodId ? 'Xếp hạng theo Sao Kỳ ⭐' : 'Xếp hạng theo Sao Tích Lũy 🌟'}
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              
              {/* 1. BỘ LỌC KHỐI */}
              <div>
                <label className="block text-xs font-black text-amber-950 mb-1.5 flex items-center gap-1">
                  <Filter className="w-3.5 h-3.5 text-amber-600" /> 1. Chọn Khối Lớp:
                </label>
                <div className="flex items-center gap-1.5 flex-wrap">
                  {getGameAvailableGrades().map((g) => (
                    <button
                      key={g}
                      type="button"
                      onClick={() => handleGameGradeChange(g)}
                      className={`px-3 py-1.5 rounded-xl font-black text-xs transition-all ${
                        gameGradeFilter == g
                          ? 'bg-amber-950 text-amber-300 border-2 border-amber-900 shadow-sm'
                          : 'bg-white text-amber-900 hover:bg-amber-100 border border-amber-200'
                      }`}
                    >
                      {g === 'ALL' ? 'Toàn Trường' : `Khối ${g}`}
                    </button>
                  ))}
                </div>
              </div>

              {/* 2. BỘ LỌC LỚP PHỤ THUỘC THEO KHỐI ĐÃ CHỌN (ĐỒNG BỘ 2 CHIỀU VỚI HEADER) */}
              <div>
                <label className="block text-xs font-black text-amber-950 mb-1.5 flex items-center gap-1">
                  <Users className="w-3.5 h-3.5 text-amber-600" /> 2. Chọn Lớp Thuộc Khối:
                </label>

                {globalClassFilter === 'NO_CLASS' ? (
                  <div className="p-2.5 bg-amber-100/60 border border-amber-200 rounded-2xl text-xs font-bold text-amber-900 flex items-center justify-between">
                    <span>📌 Bài giảng chung</span>
                    <span className="text-[10px] text-amber-700 font-extrabold">Toàn trường</span>
                  </div>
                ) : (
                  <select
                    value={gameClassFilter}
                    onChange={(e) => handleGameClassChange(e.target.value)}
                    className="w-full p-2.5 bg-white border-2 border-amber-300 rounded-2xl font-extrabold text-xs text-amber-950 focus:ring-2 focus:ring-amber-500 focus:outline-none shadow-sm"
                  >
                    <option value="ALL_IN_GRADE">
                      {gameGradeFilter === 'ALL' ? '🌐 Tất cả các lớp (Toàn trường)' : `🏫 Tất cả các lớp trong Khối ${gameGradeFilter}`}
                    </option>

                    {getGameClassesForSelectedGrade().map((c) => (
                      <option key={c.id} value={c.id}>
                        📍 {formatClassLabel(c.name)} {c.teacher_id === currentUser?.id ? '(Lớp bạn phụ trách)' : ''}
                      </option>
                    ))}
                  </select>
                )}
              </div>

              {/* 3. BỘ LỌC MÔN HỌC */}
              <div>
                <label className="block text-xs font-black text-amber-950 mb-1.5 flex items-center gap-1">
                  <BookOpen className="w-3.5 h-3.5 text-amber-600" /> 3. Chọn Môn Học:
                </label>
                <select
                  value={gameSubjectFilter}
                  disabled={Boolean(selectedPeriodId)}
                  onChange={(e) => {
                    setGameSubjectFilter(e.target.value);
                    triggerSound('click');
                  }}
                  className={`w-full p-2.5 border-2 rounded-2xl font-extrabold text-xs focus:ring-2 focus:outline-none shadow-sm ${
                    selectedPeriodId
                      ? 'bg-slate-100 border-slate-200 text-slate-400 cursor-not-allowed'
                      : 'bg-white border-amber-300 text-amber-950 focus:ring-amber-500'
                  }`}
                >
                  <option value="ALL">🎯 Tất cả môn học</option>
                  {availableGameSubjects.map((sub) => (
                    <option key={sub} value={sub}>
                      📚 Môn {sub}
                    </option>
                  ))}
                </select>
              </div>

              {/* 4. BỘ LỌC THỜI GIAN (HỖ TRỢ HỌC KỲ 1, HỌC KỲ 2 & CẢ NĂM HỌC 2026-2027) */}
              <div>
                <label className="block text-xs font-black text-amber-950 mb-1.5 flex items-center gap-1">
                  <Calendar className="w-3.5 h-3.5 text-amber-600" /> 4. Chọn Thời Gian:
                </label>
                {selectedPeriodId ? (
                  <div className="p-2.5 bg-slate-100 border-2 border-slate-200 rounded-2xl font-bold text-xs text-slate-500 cursor-not-allowed">
                    ⏱️ Theo thời gian Kỳ xếp hạng (Cố định)
                  </div>
                ) : (
                  <select
                    value={gameTimeRange}
                    onChange={(e) => {
                      setGameTimeRange(e.target.value);
                      triggerSound('click');
                    }}
                    className="w-full p-2.5 bg-white border-2 border-amber-300 rounded-2xl font-extrabold text-xs text-amber-950 focus:ring-2 focus:ring-amber-500 focus:outline-none shadow-sm"
                  >
                    <option value="ALL">♾️ Toàn bộ thời gian (Tích lũy tổng)</option>
                    <option value="WEEK">📅 Tuần này</option>
                    <option value="MONTH">📆 Tháng này</option>
                    <option value="HK1">🎓 Học kỳ 1 (Năm học 2026-2027)</option>
                    <option value="HK2">🎓 Học kỳ 2 (Năm học 2026-2027)</option>
                    <option value="FULL_YEAR">🏆 Cả năm học (2026-2027)</option>
                  </select>
                )}
              </div>

              {/* 5. BỘ LỌC NGUỒN HOẠT ĐỘNG (KHO GAME / BÀI TẬP ĐÃ GIAO / TẤT CẢ) */}
              <div>
                <label className="block text-xs font-black text-amber-950 mb-1.5 flex items-center gap-1">
                  <Activity className="w-3.5 h-3.5 text-amber-600" /> 5. Nguồn Hoạt Động:
                </label>
                {selectedPeriodId && classPeriods.find(p => p.id === selectedPeriodId)?.status === 'CLOSED' ? (
                  <div className="p-2.5 bg-slate-100 border-2 border-slate-200 rounded-2xl font-bold text-xs text-slate-500 cursor-not-allowed flex items-center justify-between">
                    <span>🔒 Tất cả nguồn</span>
                    <span className="text-[10px] text-slate-400">Kỳ đã chốt</span>
                  </div>
                ) : (
                  <select
                    value={gameSourceFilter}
                    onChange={(e) => {
                      setGameSourceFilter(e.target.value);
                      triggerSound('click');
                    }}
                    className="w-full p-2.5 bg-white border-2 border-amber-300 rounded-2xl font-extrabold text-xs text-amber-950 focus:ring-2 focus:ring-amber-500 focus:outline-none shadow-sm"
                  >
                    {GAME_SOURCE_OPTIONS.map(opt => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                )}
              </div>

            </div>
          </div>

          {gameError && (
            <div className="p-4 bg-rose-50 border-2 border-rose-200 rounded-3xl text-xs font-black text-rose-800 flex items-center gap-2">
              <AlertCircle className="w-5 h-5 text-rose-600 shrink-0" />
              <span>{gameError}</span>
            </div>
          )}

          {loadingGame ? (
            <LoadingSkeleton type="page" />
          ) : gameStudents.length === 0 ? (
            <div className="text-center py-12 bg-white rounded-3xl border-4 border-amber-200">
              <Trophy className="w-12 h-12 text-amber-400 mx-auto mb-2" />
              <h3 className="text-lg font-black text-amber-900">Chưa có dữ liệu xếp hạng</h3>
              <p className="text-xs font-bold text-slate-500 mt-1">Chưa có học sinh nào hoàn thành bài thi đua/trò chơi thỏa mãn bộ lọc hiện tại.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {gameStudents.map((st, index) => {
                const rank = st.rank || index + 1;
                const isTop3 = rank <= 3;
                return (
                  <div
                    key={st.id || index}
                    onClick={() => handleOpenStudentSummary(st.id)}
                    className={`p-4 rounded-3xl border-2 transition-all flex items-center justify-between gap-4 shadow-sm hover:shadow-md cursor-pointer ${
                      isTop3
                        ? 'bg-gradient-to-r from-amber-50/90 to-yellow-50/90 border-amber-300'
                        : 'bg-white border-indigo-100 hover:border-indigo-300'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <div className="shrink-0">{getRankBadge(rank, st.is_tied)}</div>
                      
                      <div className="w-10 h-10 rounded-2xl bg-amber-200 border-2 border-amber-400 overflow-hidden shrink-0">
                        {st.avatar_url ? (
                          <img src={st.avatar_url} alt={st.full_name} className="w-full h-full object-cover" />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center font-black text-amber-900 text-sm">
                            {st.full_name?.charAt(0) || '🎓'}
                          </div>
                        )}
                      </div>

                      <div>
                        <div className="flex items-center gap-2">
                          <h4 className="text-sm font-black text-slate-900">{st.full_name}</h4>
                          {st.student_code && (
                            <span className="text-[10px] font-black text-slate-500 bg-slate-100 px-2 py-0.5 rounded-full">
                              {st.student_code}
                            </span>
                          )}
                        </div>
                        <div className="text-[11px] font-bold text-slate-500 mt-0.5">
                          {st.class_name ? formatClassLabel(st.class_name) : `Khối ${st.grade_level || ''}`}
                          {st.completed_count !== undefined && ` • ${st.completed_count} nhiệm vụ`}
                        </div>
                      </div>
                    </div>

                    <div className="text-right shrink-0">
                      <div className="text-base font-black text-amber-600 flex items-center justify-end gap-1">
                        {st.total_stars} <Star className="w-4 h-4 text-amber-500 fill-amber-500" />
                      </div>
                      {st.accumulated_stars !== undefined && (
                        <div className="text-[10px] font-bold text-slate-400 mt-0.5">
                          Tích lũy: {st.accumulated_stars} 🌟
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

        </div>
      )}

      {/* ========================================================================= */}
      {/* TAB 2: BẢNG XẾP HẠNG HỌC THUẬT                                             */}
      {/* ========================================================================= */}
      {activeTab === 'academic' && (
        <div className="space-y-6">
          
          <div className="bg-indigo-50/80 p-5 rounded-3xl border-2 border-indigo-200 space-y-4 shadow-sm">
            <div className="flex items-center justify-between border-b border-indigo-200/60 pb-3">
              <h3 className="text-sm font-black text-indigo-950 flex items-center gap-1.5">
                <BookOpen className="w-4 h-4 text-indigo-600" /> Xếp Hạng Học Thuật
              </h3>
              <span className="text-[11px] font-bold bg-indigo-200 text-indigo-950 px-2.5 py-0.5 rounded-full">
                {selectedPeriodId ? 'Theo Kỳ Xếp Hạng 🎓' : 'Theo Lớp & Thời Gian 📚'}
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              
              <div>
                <label className="block text-xs font-black text-indigo-950 mb-1 flex items-center gap-1">
                  <Users className="w-3.5 h-3.5 text-indigo-600" /> Chọn Lớp Học:
                </label>

                {globalClassFilter === 'NO_CLASS' ? (
                  <div className="p-2.5 bg-amber-50 border border-amber-200 rounded-2xl text-xs font-bold text-amber-900">
                    📌 Bài giảng chung (không có lớp học thuật)
                  </div>
                ) : userProfile?.role === 'student' ? (
                  <div className="p-2.5 bg-indigo-100/60 border border-indigo-200 rounded-2xl text-xs font-bold text-indigo-950">
                    🏫 {formatClassLabel(userMyClasses[0]?.name)}
                  </div>
                ) : (
                  <select
                    value={selectedAcademicClassId}
                    onChange={(e) => handleAcademicClassChange(e.target.value)}
                    className="w-full p-2.5 bg-white border-2 border-indigo-200 rounded-2xl font-extrabold text-xs text-indigo-950 focus:ring-2 focus:ring-indigo-400 focus:outline-none shadow-sm"
                  >
                    <option value="">-- Chọn lớp học --</option>
                    {userProfile?.role === 'admin' ? (
                      allSystemClasses.map(c => (
                        <option key={c.id} value={c.id}>
                          🏫 {formatClassLabel(c.name)} (Khối {c.grade_level})
                        </option>
                      ))
                    ) : (
                      userMyClasses.map(c => (
                        <option key={c.id} value={c.id}>
                          🏫 {formatClassLabel(c.name)} (Khối {c.grade_level})
                        </option>
                      ))
                    )}
                  </select>
                )}
              </div>

              <div>
                <label className="block text-xs font-black text-indigo-950 mb-1 flex items-center gap-1">
                  <BookOpen className="w-3.5 h-3.5 text-indigo-600" /> Môn Học:
                </label>
                <select
                  value={academicSubject}
                  onChange={(e) => setAcademicSubject(e.target.value)}
                  className="w-full p-2.5 bg-white border-2 border-indigo-200 rounded-2xl font-extrabold text-xs text-indigo-950 focus:ring-2 focus:ring-indigo-400 focus:outline-none"
                >
                  <option value="ALL">Tất cả môn học</option>
                  <option value="Toán">Toán học 📐</option>
                  <option value="Tiếng Việt">Tiếng Việt 📚</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-black text-indigo-950 mb-1 flex items-center gap-1">
                  <Filter className="w-3.5 h-3.5 text-indigo-600" /> Thời Gian:
                </label>
                {selectedPeriodId ? (
                  <div className="p-2.5 bg-slate-100 border-2 border-slate-200 rounded-2xl font-bold text-xs text-slate-500 cursor-not-allowed">
                    ⏱️ Theo thời gian Kỳ xếp hạng
                  </div>
                ) : (
                  <select
                    value={academicTimeRange}
                    onChange={(e) => setAcademicTimeRange(e.target.value)}
                    className="w-full p-2.5 bg-white border-2 border-indigo-200 rounded-2xl font-extrabold text-xs text-indigo-950 focus:ring-2 focus:ring-indigo-400 focus:outline-none"
                  >
                    <option value="ALL">Tất cả bài tập</option>
                    <option value="MONTH">Tháng này 📅</option>
                    <option value="SEMESTER">Học kỳ này 🎓</option>
                  </select>
                )}
              </div>

            </div>

            <div className="p-3 bg-white/80 rounded-2xl border border-indigo-100 text-[11px] text-indigo-900 font-bold flex items-start gap-2">
              <Sparkles className="w-4 h-4 text-indigo-600 shrink-0 mt-0.5" />
              <span>
                <strong>Quy tắc xếp hạng học thuật:</strong> Chỉ tính kết quả các bài tập chính thức được giao cho lớp và có bật tính năng xếp hạng. Điểm xếp hạng = % điểm học thuật trong kỳ.
              </span>
            </div>
          </div>

          {academicError && (
            <div className="p-4 bg-rose-50 border-2 border-rose-200 rounded-3xl text-xs font-black text-rose-800 flex items-center gap-2">
              <AlertCircle className="w-5 h-5 text-rose-600 shrink-0" />
              <span>{academicError}</span>
            </div>
          )}

          {loadingAcademic ? (
            <LoadingSkeleton type="page" />
          ) : !selectedAcademicClassId ? (
            <div className="text-center py-12 bg-white rounded-3xl border-4 border-indigo-200">
              <Users className="w-12 h-12 text-indigo-400 mx-auto mb-2" />
              <h3 className="text-lg font-black text-indigo-900">
                {globalClassFilter === 'NO_CLASS' ? 'Chế độ Bài giảng chung' : 'Vui lòng chọn Lớp học'}
              </h3>
              <p className="text-xs font-bold text-slate-500 mt-1">
                {globalClassFilter === 'NO_CLASS'
                  ? 'Bài giảng chung không có bảng xếp hạng học thuật theo lớp. Vui lòng chọn một lớp cụ thể trên Header hoặc bộ lọc.'
                  : 'Vui lòng chọn một lớp học để xem xếp hạng kết quả làm bài tập học thuật.'}
              </p>
            </div>
          ) : academicData && academicData.leaderboard && academicData.leaderboard.length > 0 ? (
            <div className="space-y-4">
              
              <div className="flex items-center justify-between px-2 text-xs font-black text-indigo-950">
                <span>🏫 {formatClassLabel(academicData.class_info?.class_name)} ({academicData.leaderboard.length} Học sinh)</span>
                <span className="bg-indigo-100 text-indigo-900 px-3 py-1 rounded-xl">
                  Tổng số bài tập tính điểm: {academicData.total_valid_exercises || 0} bài
                </span>
              </div>

              <div className="space-y-3">
                {academicData.leaderboard.map((st, index) => {
                  const rank = st.rank || index + 1;
                  const isTop3 = rank <= 3;
                  return (
                    <div
                      key={st.student_id || index}
                      onClick={() => handleOpenStudentSummary(st.student_id)}
                      className={`p-4 rounded-3xl border-2 transition-all flex items-center justify-between gap-4 shadow-sm hover:shadow-md cursor-pointer ${
                        isTop3
                          ? 'bg-gradient-to-r from-indigo-50/90 to-blue-50/90 border-indigo-300'
                          : 'bg-white border-indigo-100 hover:border-indigo-300'
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <div className="shrink-0">{getRankBadge(rank, st.is_tied)}</div>
                        
                        <div className="w-10 h-10 rounded-2xl bg-indigo-200 border-2 border-indigo-400 overflow-hidden shrink-0">
                          {st.avatar_url ? (
                            <img src={st.avatar_url} alt={st.full_name} className="w-full h-full object-cover" />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center font-black text-indigo-900 text-sm">
                              {st.full_name?.charAt(0) || '🎓'}
                            </div>
                          )}
                        </div>

                        <div>
                          <div className="flex items-center gap-2">
                            <h4 className="text-sm font-black text-slate-900">{st.full_name}</h4>
                            {st.student_code && (
                              <span className="text-[10px] font-black text-slate-500 bg-slate-100 px-2 py-0.5 rounded-full">
                                {st.student_code}
                              </span>
                            )}
                          </div>
                          <div className="text-[11px] font-bold text-slate-500 mt-0.5">
                            Đã làm: {st.completed_count} / {st.total_valid_count || academicData.total_valid_exercises} bài
                          </div>
                        </div>
                      </div>

                      <div className="text-right shrink-0">
                        <div className="text-base font-black text-indigo-700">
                          {st.academic_score_pct}%
                        </div>
                        <div className="text-[10px] font-bold text-slate-400 mt-0.5">
                          {selectedPeriodId ? `ĐTB: ${st.academic_score_pct}%` : `ĐTB: ${st.avg_score} điểm`}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

            </div>
          ) : (
            <div className="text-center py-12 bg-white rounded-3xl border-4 border-indigo-200">
              <BookOpen className="w-12 h-12 text-indigo-400 mx-auto mb-2" />
              <h3 className="text-lg font-black text-indigo-900">Chưa có dữ liệu xếp hạng học thuật</h3>
              <p className="text-xs font-bold text-slate-500 mt-1">Chưa có học sinh hoàn thành bài tập học thuật được giao trong khoảng thời gian này.</p>
            </div>
          )}

        </div>
      )}

      {/* MODAL QUẢN LÝ KỲ XẾP HẠNG */}
      <RankingPeriodModal
        isOpen={isPeriodModalOpen}
        onClose={() => setIsPeriodModalOpen(false)}
        selectedClassId={validManagedClassId}
        myClasses={userMyClasses}
        onPeriodChange={() => {
          const activeClassId = getValidManagedClassId();
          fetchClassPeriods(activeClassId, userProfile?.role);
        }}
      />

      {/* MODAL TỔNG KẾT & NHẬN XẾT HỌC SINH THEO KỲ */}
      <StudentPeriodSummaryModal
        isOpen={isSummaryModalOpen}
        onClose={() => setIsSummaryModalOpen(false)}
        periodId={selectedPeriodId}
        studentId={summaryStudentId}
        canManage={canManagePeriods}
      />

    </div>
  );
};
