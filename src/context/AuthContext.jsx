import React, { createContext, useContext, useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';

const AuthContext = createContext({
  user: null,
  profile: null,
  loading: true,
  signUp: async () => {},
  signIn: async () => {},
  quickStudentSignIn: async () => {},
  signOut: async () => {},
  refreshProfile: async () => {},
  awardStars: async () => {},
});

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);

  // Lấy thông tin profile người dùng từ bảng public.profiles
  const fetchProfile = async (userId) => {
    if (!userId) {
      setProfile(null);
      return;
    }
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .single();

      if (!error && data) {
        if (data.is_disabled) {
          await supabase.auth.signOut();
          setUser(null);
          setProfile(null);
          return;
        }
        setProfile(data);
      } else {
        // Dự phòng nếu DB trigger chưa nạp profile
        setProfile(prev => prev || {
          id: userId,
          full_name: 'Học Sinh Vui Học',
          role: 'student',
          grade_level: 1,
          total_stars: 0,
          total_coins: 0,
          avatar_url: `https://api.dicebear.com/7.x/bottts/svg?seed=${userId}`
        });
      }
    } catch (err) {
      console.error('Error fetching profile:', err);
    }
  };

  useEffect(() => {
    // 1. Kiểm tra session hiện tại
    const initAuth = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (session?.user) {
          setUser(session.user);
          await fetchProfile(session.user.id);
        }
      } catch (err) {
        console.error('Session init error:', err);
      } finally {
        setLoading(false);
      }
    };

    initAuth();

    // 2. Lắng nghe thay đổi auth state (đăng nhập / đăng xuất)
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (_event, session) => {
      if (session?.user) {
        setUser(session.user);
        await fetchProfile(session.user.id);
      } else {
        // Không xóa profile nếu đang ở chế độ Học Sinh Đăng Nhập Nhanh (quick student session)
        setUser(prevUser => {
          if (!session?.user && prevUser?.id?.startsWith('student_')) {
            return prevUser;
          }
          if (!session?.user) setProfile(null);
          return session?.user || null;
        });
      }
      setLoading(false);
    });

    return () => {
      subscription?.unsubscribe();
    };
  }, []);

  // Đăng ký tài khoản
  const signUp = async ({ email, password, fullName, role = 'student', gradeLevel = 1 }) => {
    setLoading(true);
    try {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: {
            full_name: fullName,
            role,
            grade_level: parseInt(gradeLevel),
            avatar_url: `https://api.dicebear.com/7.x/bottts/svg?seed=${encodeURIComponent(fullName)}`
          }
        }
      });
      if (error) throw error;
      return { data, error: null };
    } catch (error) {
      return { data: null, error };
    } finally {
      setLoading(false);
    }
  };

  // Đăng nhập bằng Email & Mật khẩu cho Admin / Giáo viên (AUTH-01)
  const signIn = async ({ email, password }) => {
    setLoading(true);
    const cleanEmail = email.toLowerCase().trim();
    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email: cleanEmail,
        password
      });

      if (error) {
        console.error('❌ Supabase signInWithPassword Failed:', error.message);
        return { data: null, error };
      }

      if (data?.user?.id) {
        const { data: profileData, error: profileError } = await supabase
          .from('profiles')
          .select('*')
          .eq('id', data.user.id)
          .single();

        if (profileError) {
          console.error('❌ Query public.profiles Failed:', profileError.message);
        } else if (profileData) {
          if (profileData.is_disabled) {
            await supabase.auth.signOut();
            setUser(null);
            setProfile(null);
            return { data: null, error: { message: 'Tài khoản của bạn đã bị khóa bởi Quản trị viên. Vui lòng liên hệ Admin.' } };
          }
          setProfile(profileData);
        }
      }

      return { data, error: null };
    } catch (error) {
      console.error('❌ Unexpected Login Exception:', error);
      return { data: null, error };
    } finally {
      setLoading(false);
    }
  };

  // Đăng nhập Nhanh dành cho Học sinh (Dùng Mã Học Sinh như HS101, HS202, HS303...)
  const quickStudentSignIn = async (studentCode, fullName = 'Học Sinh Tiểu Học', gradeLevel = 1) => {
    setLoading(true);
    const cleanCode = studentCode.toLowerCase().trim().replace(/[^a-z0-9]/g, '');
    
    if (!cleanCode) {
      setLoading(false);
      return { data: null, error: { message: 'Bé vui lòng nhập Mã Học Sinh!' } };
    }

    // Bản đồ tài khoản học sinh mẫu
    const sampleEmails = {
      'hs101': 'hs_nam@hoclapvui.edu.vn',
      'nam': 'hs_nam@hoclapvui.edu.vn',
      'hs202': 'hs_an@hoclapvui.edu.vn',
      'an': 'hs_an@hoclapvui.edu.vn',
      'hs303': 'hs_duc@hoclapvui.edu.vn',
      'duc': 'hs_duc@hoclapvui.edu.vn',
      'hs404': 'hs_bao@hoclapvui.edu.vn',
      'bao': 'hs_bao@hoclapvui.edu.vn',
      'hs505': 'hs_mai@hoclapvui.edu.vn',
      'mai': 'hs_mai@hoclapvui.edu.vn',
    };

    const targetEmail = sampleEmails[cleanCode] || `hs_${cleanCode}@hoclapvui.edu.vn`;
    const candidatePasswords = ['123456', '12345678', `hs_${cleanCode}_123456`, `${cleanCode}123456`].filter((v, i, a) => a.indexOf(v) === i);

    try {
      // 1. Thử đăng nhập qua Auth SDK bằng các mật khẩu mặc định
      for (const pass of candidatePasswords) {
        const { data: signInData, error: signInErr } = await supabase.auth.signInWithPassword({
          email: targetEmail,
          password: pass
        });

        if (!signInErr && signInData?.user) {
          setUser(signInData.user);
          await fetchProfile(signInData.user.id);
          return { data: signInData, error: null };
        }
      }

      // 2. Thử đăng ký tài khoản mới qua Supabase Auth SDK
      const defaultPassword = candidatePasswords[0];
      const { data: signUpData, error: signUpErr } = await supabase.auth.signUp({
        email: targetEmail,
        password: defaultPassword,
        options: {
          data: {
            full_name: `${fullName} (${studentCode.toUpperCase()})`,
            role: 'student',
            grade_level: parseInt(gradeLevel),
            avatar_url: `https://api.dicebear.com/7.x/bottts/svg?seed=${cleanCode}`
          }
        }
      });

      if (!signUpErr && signUpData?.user) {
        if (signUpData.session) {
          setUser(signUpData.user);
          await fetchProfile(signUpData.user.id);
          return { data: signUpData, error: null };
        }

        // Nếu Supabase Auth yêu cầu Email Confirm -> Thử đăng nhập ngay
        const { data: secondSignIn, error: secondErr } = await supabase.auth.signInWithPassword({
          email: targetEmail,
          password: defaultPassword
        });

        if (!secondErr && secondSignIn?.user) {
          setUser(secondSignIn.user);
          await fetchProfile(secondSignIn.user.id);
          return { data: secondSignIn, error: null };
        }
      }

      // 3. Cơ chế Học Sinh Đăng Nhập Nhanh An Toàn: Nếu tài khoản học sinh đã có sẵn trong bảng public.profiles
      // (Ví dụ: Nguyễn Văn Nam - HS101 / hs_nam@hoclapvui.edu.vn)
      const { data: existingProfile } = await supabase
        .from('profiles')
        .select('*')
        .or(`email.eq.${targetEmail},full_name.ilike.%${studentCode}%`)
        .limit(1)
        .maybeSingle();

      if (existingProfile) {
        const studentUser = {
          id: existingProfile.id,
          email: existingProfile.email,
          role: 'authenticated',
          aud: 'authenticated',
          user_metadata: {
            full_name: existingProfile.full_name,
            role: 'student',
            grade_level: existingProfile.grade_level
          }
        };
        setUser(studentUser);
        setProfile(existingProfile);
        return { data: { user: studentUser }, error: null };
      }

      // 4. Nếu là học sinh hoàn toàn mới nhập Mã chưa có sẵn trong CSDL -> Tạo phiên làm việc học sinh mới
      const newStudentId = `student_${cleanCode}_${Date.now()}`;
      const newStudentProfile = {
        id: newStudentId,
        email: targetEmail,
        full_name: fullName.includes('(') ? fullName : `${fullName} (${studentCode.toUpperCase()})`,
        role: 'student',
        grade_level: parseInt(gradeLevel) || 1,
        total_stars: 0,
        total_coins: 0,
        avatar_url: `https://api.dicebear.com/7.x/bottts/svg?seed=${cleanCode}`
      };

      const newStudentUser = {
        id: newStudentId,
        email: targetEmail,
        role: 'authenticated',
        aud: 'authenticated',
        user_metadata: {
          full_name: newStudentProfile.full_name,
          role: 'student',
          grade_level: newStudentProfile.grade_level
        }
      };

      setUser(newStudentUser);
      setProfile(newStudentProfile);
      return { data: { user: newStudentUser }, error: null };

    } catch (error) {
      console.error('Quick student auth error:', error);
      return { data: null, error };
    } finally {
      setLoading(false);
    }
  };

  // Đăng xuất
  const signOut = async () => {
    setLoading(true);
    try {
      await supabase.auth.signOut();
    } catch (err) {
      console.error('Sign out error:', err);
    } finally {
      setUser(null);
      setProfile(null);
      setLoading(false);
    }
  };

  // Cộng Điểm Sao / Xu cho học sinh khi hoàn thành Game
  const awardStars = async (starsGained = 10, coinsGained = 5) => {
    if (!profile || !profile.id) return;
    const updatedStars = (profile.total_stars || 0) + starsGained;
    const updatedCoins = (profile.total_coins || 0) + coinsGained;

    // Cập nhật UI nhanh
    setProfile(prev => prev ? { ...prev, total_stars: updatedStars, total_coins: updatedCoins } : null);

    try {
      // 1. Gọi RPC award_stars_and_coins
      const { error: rpcErr } = await supabase.rpc('award_stars_and_coins', {
        p_stars_gained: starsGained,
        p_coins_gained: coinsGained
      });

      if (rpcErr) {
        // 2. Dự phòng trực tiếp nếu RPC chưa được khởi tạo
        await supabase
          .from('profiles')
          .update({
            total_stars: updatedStars,
            total_coins: updatedCoins
          })
          .eq('id', profile.id);
      }
    } catch (err) {
      console.error('Error updating stars/coins:', err);
    }
  };

  const refreshProfile = async () => {
    if (user?.id) {
      await fetchProfile(user.id);
    }
  };

  // Đăng nhập bằng Google OAuth cho Admin / Giáo viên (AUTH-02)
  const signInWithGoogle = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: window.location.origin
        }
      });
      if (error) throw error;
      return { data, error: null };
    } catch (error) {
      console.error('Google OAuth error:', error);
      return { data: null, error };
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthContext.Provider value={{
      user,
      profile,
      loading,
      signUp,
      signIn,
      signInWithGoogle,
      quickStudentSignIn,
      signOut,
      refreshProfile,
      awardStars
    }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
