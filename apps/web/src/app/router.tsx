import { lazy, Suspense } from 'react';
import { Navigate, Outlet, createBrowserRouter } from 'react-router-dom';
import { AuthProvider, useAuth } from '@/features/auth/AuthProvider';
import RequireAuth from '@/features/auth/RequireAuth';
import AccountPage from '@/pages/AccountPage';
import AuthPage from '@/pages/AuthPage';

const HomePage = lazy(() => import('@/pages/HomePage'));
const MapPage = lazy(() => import('@/pages/MapPage'));
const UploadPage = lazy(() => import('@/pages/UploadPage'));
const FilesPage = lazy(() => import('@/pages/FilesPage'));
const PreviewPage = lazy(() => import('@/pages/PreviewPage'));
const SharesPage = lazy(() => import('@/pages/SharesPage'));
const PublicSharePage = lazy(() => import('@/pages/PublicSharePage'));
const PhoneUploadPage = lazy(() => import('@/pages/PhoneUploadPage'));

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
      { path: 'phone-upload/:id', element: <Suspense fallback={<main className="auth-loading">正在连接手机…</main>}><PhoneUploadPage /></Suspense>, handle: { agent: { pageId: 'phoneUpload' } } },
      { path: 's/:handle/:slug', element: <Suspense fallback={<main className="auth-loading">正在打开分享…</main>}><PublicSharePage /></Suspense>, handle: { agent: { pageId: 'publicShare' } } },
      { path: ':handle/:slug', element: <Suspense fallback={<main className="auth-loading">正在打开分享…</main>}><PublicSharePage /></Suspense>, handle: { agent: { pageId: 'publicShare' } } },
      {
        path: '/',
        element: <RequireAuth />,
        children: [
          { index: true, element: <Suspense fallback={<main className="auth-loading">正在打开首页…</main>}><HomePage /></Suspense>, handle: { agent: { pageId: 'home' }, navigation: 'home' } },
          { path: 'settings/account', element: <AccountPage />, handle: { agent: { pageId: 'account' }, navigation: 'account' } },
          { path: 'upload', element: <Suspense fallback={<main className="auth-loading">正在打开上传空间…</main>}><UploadPage /></Suspense>, handle: { agent: { pageId: 'upload' }, navigation: 'upload' } },
          { path: 'files/:folderId?', element: <Suspense fallback={<main className="auth-loading">正在打开文件空间…</main>}><FilesPage /></Suspense>, handle: { agent: { pageId: 'files' }, navigation: 'files' } },
          { path: 'map', element: <Suspense fallback={<main className="auth-loading">正在打开足迹地图…</main>}><MapPage /></Suspense>, handle: { agent: { pageId: 'map' }, navigation: 'map' } },
          { path: 'preview/:nodeId', element: <Suspense fallback={<main className="auth-loading">正在打开素材…</main>}><PreviewPage /></Suspense>, handle: { agent: { pageId: 'preview' }, navigation: 'files' } },
          { path: 'shares', element: <Suspense fallback={<main className="auth-loading">正在打开我的分享…</main>}><SharesPage /></Suspense>, handle: { agent: { pageId: 'shares' }, navigation: 'shares' } },
          { path: 'shares/new', element: <Suspense fallback={<main className="auth-loading">正在打开分享配置…</main>}><SharesPage /></Suspense>, handle: { agent: { pageId: 'shares' }, navigation: 'shares' } },
          { path: 'shares/:id/edit', element: <Suspense fallback={<main className="auth-loading">正在打开分享配置…</main>}><SharesPage /></Suspense>, handle: { agent: { pageId: 'shares' }, navigation: 'shares' } },
        ],
      },
      { path: '*', element: <Navigate to="/" replace /> },
    ],
  },
], { basename: import.meta.env.BASE_URL });
