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

// Protected Route Component theo Role
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

  if (allowedRoles && profile && !allowedRoles.includes(profile.role)) {
    return <Navigate to="/" replace />;
  }

  return children;
};

function AppRoutes() {
  return (
    <div className="min-h-screen flex flex-col justify-between bg-amber-50/60 font-sans">
      <Navbar />
      
      <main className="flex-grow">
        <Routes>
          <Route path="/" element={<StudentDashboard />} />
          <Route path="/auth" element={<AuthPage />} />
          <Route path="/leaderboard" element={<LeaderboardView />} />
          
          <Route 
            path="/student" 
            element={
              <ProtectedRoute allowedRoles={['student', 'teacher', 'admin']}>
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
