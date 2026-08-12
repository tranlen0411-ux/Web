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
        setProfile(data);
      } else {
        // Dự phòng nếu Trigger DB chưa kịp nạp dữ liệu
        setProfile({
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
        setUser(null);
        setProfile(null);
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

  // Đăng nhập bằng Email & Mật khẩu qua Supabase Auth (AUTH-01)
  const signIn = async ({ email, password }) => {
    setLoading(true);
    const cleanEmail = email.toLowerCase().trim();
    try {
      // 1. Thực hiện signInWithPassword
      const { data, error } = await supabase.auth.signInWithPassword({
        email: cleanEmail,
        password
      });

      console.log('AUTH RESULT', {
        userId: data?.user?.id,
        email: data?.user?.email,
        errorMessage: error?.message,
        errorName: error?.name,
        errorCode: error?.code,
        errorStatus: error?.status
      });

      if (error) {
        console.error('❌ Supabase signInWithPassword Failed:', {
          message: error.message,
          name: error.name,
          code: error.code,
          status: error.status
        });
        return { data: null, error };
      }

      // 2. Nếu signIn thành công mới thực hiện query public.profiles
      if (data?.user?.id) {
        const { data: profileData, error: profileError } = await supabase
          .from('profiles')
          .select('*')
          .eq('id', data.user.id)
          .single();

        if (profileError) {
          console.error('❌ Query public.profiles Failed:', profileError.message);
        } else if (profileData) {
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

  // Đăng nhập Nhanh dành cho Học sinh nhỏ tuổi (dùng Mã/Tên học sinh)
  const quickStudentSignIn = async (studentCode, fullName = 'Học Sinh Tiểu Học', gradeLevel = 1) => {
    setLoading(true);
    const cleanCode = studentCode.toLowerCase().trim().replace(/[^a-z0-9]/g, '');
    
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
    const defaultPassword = sampleEmails[cleanCode] ? '123456' : `hs_${cleanCode}_123456`;

    try {
      // 1. Thử đăng nhập với tài khoản mẫu (Pass: 123456)
      const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({
        email: targetEmail,
        password: defaultPassword
      });

      if (!signInError && signInData) {
        return { data: signInData, error: null };
      }

      // 2. Thử đăng nhập nếu có pass phụ
      const { data: subData, error: subError } = await supabase.auth.signInWithPassword({
        email: targetEmail,
        password: '123456'
      });

      if (!subError && subData) {
        return { data: subData, error: null };
      }

      // 3. Nếu tài khoản chưa có -> Tự động đăng ký
      const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
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

      if (signUpError) throw signUpError;
      return { data: signUpData, error: null };
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
      setUser(null);
      setProfile(null);
    } catch (err) {
      console.error('Sign out error:', err);
    } finally {
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
      await supabase
        .from('profiles')
        .update({
          total_stars: updatedStars,
          total_coins: updatedCoins
        })
        .eq('id', profile.id);
    } catch (err) {
      console.error('Error updating stars/coins:', err);
    }
  };

  const refreshProfile = async () => {
    if (user?.id) {
      await fetchProfile(user.id);
    }
  };

  // Đăng nhập nhanh bằng Google OAuth (AUTH-02)
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
