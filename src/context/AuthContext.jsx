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

  // Lấy thông tin profile người dùng từ bảng public.profiles bằng UUID Auth thật sau khi có session
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
    // 1. Kiểm tra session hiện tại từ Supabase Auth SDK
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

  // Đăng nhập Nhanh dành cho Học sinh (Dùng Mã Học Sinh như HS101, HS202, HS303... kèm Mã PIN 1234)
  // SỬ DỤNG EDGE FUNCTION SERVER-SIDE 'student-quick-login' XÁC MINH HASHED PIN BẢO MẬT 100%
  const quickStudentSignIn = async (studentCode, pin = '1234') => {
    setLoading(true);
    const cleanCode = studentCode.toLowerCase().trim().replace(/[^a-z0-9]/g, '');
    const cleanPin = pin.trim();
    
    if (!cleanCode || !cleanPin) {
      setLoading(false);
      return { data: null, error: { message: 'Mã học sinh hoặc PIN không hợp lệ.' } };
    }

    try {
      // 1. Gọi Edge Function server-side 'student-quick-login' với studentCode & pin
      const { data: edgeData, error: edgeErr } = await supabase.functions.invoke('student-quick-login', {
        body: { studentCode: cleanCode, pin: cleanPin }
      });

      if (edgeErr || !edgeData?.success) {
        console.error('Edge function invocation error:', edgeErr || edgeData?.message);
        setLoading(false);
        return { 
          data: null, 
          error: { message: edgeData?.message || 'Mã học sinh hoặc PIN không hợp lệ.' } 
        };
      }

      const { email, token_hash } = edgeData;

      // 2. Xác thực Magic Link token thu được từ Edge Function qua Supabase Auth SDK client-side
      // Lệnh verifyOtp này tạo 100% Supabase Auth Session thật cho client
      const verifyRes = await supabase.auth.verifyOtp({
        token_hash: token_hash,
        type: 'magiclink'
      });

      if (verifyRes.error || !verifyRes.data?.session) {
        console.error('verifyOtp error:', verifyRes.error);
        setLoading(false);
        return { data: null, error: { message: 'Lỗi khi xác thực phiên đăng nhập học sinh.' } };
      }

      // 3. Đã có Supabase Auth Session thật (session != null & session.user.id = UUID thật từ auth.users)!
      const sessionUser = verifyRes.data.session.user;
      setUser(sessionUser);

      // 4. Truy vấn thông tin profile theo session.user.id (Lúc này đã authenticated nên RLS trả về HTTP 200 OK!)
      await fetchProfile(sessionUser.id);

      return { data: verifyRes.data, error: null };

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
