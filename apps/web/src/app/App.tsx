import { ConfigProvider } from '@arco-design/web-react';
import zhCN from '@arco-design/web-react/es/locale/zh-CN';
import { RouterProvider } from 'react-router-dom';
import PwaUpdatePrompt from '@/components/PwaUpdatePrompt';
import { router } from './router';

const pwaEnabled = import.meta.env.PROD && (
  import.meta.env.BASE_URL === '/app/' || import.meta.env.VITE_ENABLE_PWA === 'true'
);

export default function App() {
  return (
    <ConfigProvider locale={zhCN}>
      <RouterProvider router={router} />
      {pwaEnabled && <PwaUpdatePrompt />}
    </ConfigProvider>
  );
}
