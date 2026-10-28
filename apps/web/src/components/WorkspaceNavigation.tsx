import type { ComponentProps } from 'react';
import { NavLink } from 'react-router-dom';

type RootDropProps = Pick<ComponentProps<typeof NavLink>, 'onDragOver' | 'onDragLeave' | 'onDrop'>;

export function WorkspaceNavigation({ rootDropProps }: { rootDropProps?: RootDropProps }) {
  return <nav className="workspace-nav" aria-label="工作空间">
    <NavLink to="/" end data-agent-id="nav.home" title="首页"><span className="workspace-nav-icon" aria-hidden="true">⌂</span><span className="workspace-nav-label">首页</span></NavLink>
    <NavLink to="/files" className={({ isActive }) => isActive ? 'active' : undefined} data-agent-id="nav.files" title="全部文件" {...rootDropProps}><span className="workspace-nav-icon" aria-hidden="true">▤</span><span className="workspace-nav-label">全部文件</span></NavLink>
    <button type="button" disabled data-agent-id="nav.map" title="足迹地图 · 准备中"><span className="workspace-nav-icon" aria-hidden="true">⌖</span><span className="workspace-nav-label">足迹地图 · 准备中</span></button>
    <button type="button" disabled data-agent-id="nav.trips" title="旅行 · 准备中"><span className="workspace-nav-icon" aria-hidden="true">▦</span><span className="workspace-nav-label">旅行 · 准备中</span></button>
    <NavLink to="/shares" data-agent-id="nav.shares" title="我的分享"><span className="workspace-nav-icon" aria-hidden="true">◇</span><span className="workspace-nav-label">我的分享</span></NavLink>
    <button type="button" disabled data-agent-id="nav.trash" title="回收站 · 准备中"><span className="workspace-nav-icon" aria-hidden="true">⌫</span><span className="workspace-nav-label">回收站 · 准备中</span></button>
  </nav>;
}

export function WorkspaceMobileNavigation({ className, region }: { className: string; region: string }) {
  return <nav className={className} aria-label="移动端导航" data-agent-region={region}>
    <NavLink to="/" end data-agent-id="nav.mobile.home">⌂<small>首页</small></NavLink>
    <NavLink to="/files" data-agent-id="nav.mobile.files">▤<small>文件</small></NavLink>
    <NavLink to="/upload" data-agent-id="nav.mobile.upload">↑<small>上传</small></NavLink>
    <NavLink to="/settings/account" data-agent-id="nav.mobile.account">○<small>我的</small></NavLink>
  </nav>;
}
