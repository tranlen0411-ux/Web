import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { SoundProvider } from './context/SoundContext';
import { Navbar } from './components/common/Navbar';
import { Footer } from './components/common/Footer';
import { AuthPage } from './pages/AuthPage';
import { StudentDashboard } from './pages/StudentDashboard';
import { TeacherDashboard } from './pages/TeacherDashboard';
import { AdminDashboard } from './pages/AdminDashboard';
import { GamePlayView } from './pages/GamePlayView';
import { LeaderboardView } from './pages/LeaderboardView';

// Protected Route Component theo Role từ Supabase
const ProtectedRoute = ({ children, allowedRoles }) => {
  const { user, profile, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-amber-50">
        <div className="text-center font-black text-amber-900 animate-bounce text-lg">
          🎮 Đang tải hệ thống học vui... 🌟
        </div>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/auth" replace />;
  }

  // Nếu vai trò không nằm trong allowedRoles -> Điều hướng về đúng Dashboard của vai trò đó
  if (allowedRoles && profile && !allowedRoles.includes(profile.role)) {
    const targetPath = profile.role === 'admin' ? '/admin' : profile.role === 'teacher' ? '/teacher' : '/student';
    return <Navigate to={targetPath} replace />;
  }

  return children;
};

// Home Dispatcher phân luồng điều hướng trang chủ '/' chính xác theo role
const HomeDispatcher = () => {
  const { user, profile, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-amber-50">
        <div className="text-center font-black text-amber-900 animate-bounce text-lg">
          🎮 Đang tải hệ thống học vui... 🌟
        </div>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/auth" replace />;
  }

  // Phân luồng theo vai trò người dùng:
  // Admin -> Điều hướng về Kho Trò Chơi Quản Trị (/admin?tab=games)
  // Teacher -> Điều hướng về Bảng Quản Lý Lớp & Game (/teacher)
  // Student -> Điều hướng về Góc Học Tập / Kho Game Học Sinh (/student)
  if (profile?.role === 'admin') {
    return <Navigate to="/admin?tab=games" replace />;
  }
  if (profile?.role === 'teacher') {
    return <Navigate to="/teacher" replace />;
  }
  return <Navigate to="/student" replace />;
};

function AppRoutes() {
  return (
    <div className="min-h-screen flex flex-col justify-between bg-amber-50/60 font-sans">
      <Navbar />
      
      <main className="flex-grow">
        <Routes>
          <Route path="/" element={<HomeDispatcher />} />
          <Route path="/auth" element={<AuthPage />} />
          <Route path="/leaderboard" element={<LeaderboardView />} />
          
          <Route 
            path="/student" 
            element={
              <ProtectedRoute allowedRoles={['student']}>
                <StudentDashboard />
              </ProtectedRoute>
            } 
          />

          <Route 
            path="/teacher" 
            element={
              <ProtectedRoute allowedRoles={['teacher', 'admin']}>
                <TeacherDashboard />
              </ProtectedRoute>
            } 
          />

          <Route 
            path="/admin" 
            element={
              <ProtectedRoute allowedRoles={['admin']}>
                <AdminDashboard />
              </ProtectedRoute>
            } 
          />

          <Route path="/play/:id" element={<GamePlayView />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>

      <Footer />
    </div>
  );
}

export default function App() {
  return (
    <Router>
      <AuthProvider>
        <SoundProvider>
          <AppRoutes />
        </SoundProvider>
      </AuthProvider>
    </Router>
  );
}
