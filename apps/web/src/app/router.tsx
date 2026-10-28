import { lazy, Suspense } from 'react';
import { Navigate, Outlet, createBrowserRouter } from 'react-router-dom';
import { AuthProvider, useAuth } from '@/features/auth/AuthProvider';
import RequireAuth from '@/features/auth/RequireAuth';
import AccountPage from '@/pages/AccountPage';
import AuthPage from '@/pages/AuthPage';

const HomePage = lazy(() => import('@/pages/HomePage'));
const UploadPage = lazy(() => import('@/pages/UploadPage'));
const FilesPage = lazy(() => import('@/pages/FilesPage'));

function GuestOnly() {
  const { user, loading } = useAuth();
  if (loading) {
    return <main className="auth-loading"><span className="auth-loading__mark" /><span>正在打开你的旅程…</span></main>;
  }
  return user ? <Navigate to="/" replace /> : <Outlet />;
}

export const router = createBrowserRouter([
  {
    element: <AuthProvider><Outlet /></AuthProvider>,
    children: [
      {
        element: <GuestOnly />,
        children: [
          { path: '/login', element: <AuthPage />, handle: { agent: { pageId: 'login' } } },
          { path: '/register', element: <AuthPage />, handle: { agent: { pageId: 'register' } } },
        ],
      },
      {
        path: '/',
        element: <RequireAuth />,
        children: [
          { index: true, element: <Suspense fallback={<main className="auth-loading">正在打开首页…</main>}><HomePage /></Suspense>, handle: { agent: { pageId: 'home' } } },
          { path: 'settings/account', element: <AccountPage />, handle: { agent: { pageId: 'account' } } },
          { path: 'upload', element: <Suspense fallback={<main className="auth-loading">正在打开上传空间…</main>}><UploadPage /></Suspense>, handle: { agent: { pageId: 'upload' } } },
          { path: 'files/:folderId?', element: <Suspense fallback={<main className="auth-loading">正在打开文件空间…</main>}><FilesPage /></Suspense>, handle: { agent: { pageId: 'files' } } },
        ],
      },
      { path: '*', element: <Navigate to="/" replace /> },
    ],
  },
], { basename: import.meta.env.BASE_URL });
