import type { ComponentProps } from 'react';
import { Link, useLocation, useMatches } from 'react-router-dom';
import { navigationSource, upcomingSections, workspaceSections } from '@/services/navigation';
import type { WorkspaceSection } from '@/services/navigation';
import '@/styles/workspace-navigation.css';

type RootDropProps = Pick<ComponentProps<typeof Link>, 'onDragOver' | 'onDragLeave' | 'onDrop'>;

function useWorkspaceSection(): WorkspaceSection | null {
  const matches = useMatches();
  const page = matches.at(-1)?.handle as { navigation?: WorkspaceSection } | undefined;
  return page?.navigation ?? null;
}

export function WorkspaceNavigation({ rootDropProps }: { rootDropProps?: RootDropProps }) {
  const section = useWorkspaceSection();
  const location = useLocation();
  return <nav className="workspace-nav" aria-label="工作空间" data-agent-region="nav.desktop">
    {workspaceSections.map((item) => <Link
      key={item.id}
      to={item.to}
      className={`workspace-nav-item${section === item.id ? ' active is-current is-active' : ''}`}
      aria-current={section === item.id ? 'page' : undefined}
      data-agent-id={`nav.${item.id}`}
      title={item.label}
      state={item.id === 'account' || item.id === 'upload' ? item.id === section ? location.state : navigationSource(location.pathname, location.search, location.state) : undefined}
      {...(item.id === 'files' ? rootDropProps : {})}
    ><span className="workspace-nav-icon" aria-hidden="true">{item.icon}</span><span className="workspace-nav-label">{item.label}</span></Link>)}
    <div className="workspace-nav-divider" role="separator" aria-label="即将推出" />
    {upcomingSections.map((item) => <button key={item.id} type="button" disabled data-agent-id={`nav.${item.id}`} title={`${item.label} · 准备中`}><span className="workspace-nav-icon" aria-hidden="true">{item.icon}</span><span className="workspace-nav-label">{item.label} · 准备中</span></button>)}
  </nav>;
}

export function WorkspaceMobileNavigation({ className, region }: { className: string; region: string }) {
  const section = useWorkspaceSection();
  const location = useLocation();
  return <nav className={`${className} workspace-mobile-nav`} aria-label="移动端导航" data-agent-region={region}>
    {workspaceSections.map((item) => <Link
      key={item.id}
      to={item.to}
      className={section === item.id ? 'active is-current is-active' : undefined}
      aria-current={section === item.id ? 'page' : undefined}
      data-agent-id={`nav.mobile.${item.id}`}
      title={item.label}
      state={item.id === 'account' || item.id === 'upload' ? item.id === section ? location.state : navigationSource(location.pathname, location.search, location.state) : undefined}
    ><span aria-hidden="true">{item.icon}</span><small>{item.id === 'files' ? '文件' : item.id === 'upload' ? '上传' : item.id === 'shares' ? '分享' : item.label}</small></Link>)}
  </nav>;
}
