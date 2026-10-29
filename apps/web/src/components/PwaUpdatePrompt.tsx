import { useEffect, useState } from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { activateAppUpdate, checkForAppUpdate } from '@/services/pwa';

const UPDATE_INTERVAL_MS = 30 * 60 * 1000;

export default function PwaUpdatePrompt() {
  const [registration, setRegistration] = useState<ServiceWorkerRegistration | undefined>();
  const [updating, setUpdating] = useState(false);
  const [error, setError] = useState(false);
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_url, nextRegistration) {
      setRegistration(nextRegistration);
    },
  });

  useEffect(() => {
    if (!registration) return;
    const check = () => {
      if (registration.waiting) setNeedRefresh(true);
      checkForAppUpdate(registration);
    };
    const interval = window.setInterval(check, UPDATE_INTERVAL_MS);
    window.addEventListener('focus', check);
    document.addEventListener('visibilitychange', check);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener('focus', check);
      document.removeEventListener('visibilitychange', check);
    };
  }, [registration, setNeedRefresh]);

  if (!needRefresh) return null;

  const applyUpdate = async () => {
    if (updating) return;
    setError(false);
    setUpdating(true);
    try {
      await activateAppUpdate(updateServiceWorker);
    } catch {
      setError(true);
      setUpdating(false);
    }
  };

  return (
    <aside className="pwa-update" role="status" aria-live="polite" data-agent-region="shell.update">
      <div className="pwa-update__text">
        <strong>迹光有新版本</strong>
        <span>更新需要重新加载页面，请先完成正在进行的上传或编辑。</span>
        {error && <span className="pwa-update__error">更新失败，请检查网络后重试。</span>}
      </div>
      <div className="pwa-update__actions">
        <button type="button" className="pwa-update__later" onClick={() => setNeedRefresh(false)} disabled={updating} data-agent-id="shell.update.later">稍后</button>
        <button type="button" className="pwa-update__apply" onClick={() => void applyUpdate()} disabled={updating} data-agent-id="shell.update.apply">{updating ? '更新中…' : '立即更新'}</button>
      </div>
    </aside>
  );
}
