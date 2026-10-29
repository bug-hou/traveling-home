import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { Button, Input, Modal } from '@arco-design/web-react';
import QRCode from 'qrcode';
import { WorkspaceMobileNavigation, WorkspaceNavigation } from '@/components/WorkspaceNavigation';
import { useAuth } from '@/features/auth/AuthProvider';
import { notePairsApi, notesApi } from '@/services/notes';
import type { NotePair, NotePairStatus, NoteSummary, PrivateNote } from '@/services/notes';
import '@/styles/shares.css';

const errorText = (cause: unknown) => cause instanceof Error ? cause.message : '操作失败，请稍后重试';

export default function NotesPage() {
  const { user } = useAuth();
  const [notes, setNotes] = useState<NoteSummary[]>([]);
  const [selected, setSelected] = useState<PrivateNote | null>(null);
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [pair, setPair] = useState<NotePair | null>(null);
  const [pairStatus, setPairStatus] = useState<NotePairStatus | null>(null);
  const [pairQr, setPairQr] = useState('');
  const [pairBusy, setPairBusy] = useState(false);
  const [pairError, setPairError] = useState('');
  const [total, setTotal] = useState(0);
  const [moreBusy, setMoreBusy] = useState(false);
  const dirty = selected ? selected.title !== title || selected.content !== content : Boolean(title || content);

  useEffect(() => {
    let active = true;
    notesApi.list().then(({ items, total: count }) => { if (active) { setNotes(items); setTotal(count); } })
      .catch((cause: unknown) => { if (active) setError(errorText(cause)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!pair || pairStatus?.status === 'revoked' || pairStatus?.status === 'expired') return;
    let active = true;
    let pending = false;
    const poll = async () => {
      if (pending) return;
      pending = true;
      try { const next = await notePairsApi.read(pair.id); if (active) { setPairStatus(next); setPairError(''); } }
      catch (cause) { if (active) setPairError(errorText(cause)); }
      finally { pending = false; }
    };
    void poll();
    const timer = window.setInterval(() => { void poll(); }, 2500);
    return () => { active = false; window.clearInterval(timer); };
  }, [pair?.id, pairStatus?.status]);

  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (!dirty) return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', beforeUnload);
    return () => { window.removeEventListener('beforeunload', beforeUnload); };
  }, [dirty]);

  async function loadMore() {
    if (moreBusy || notes.length >= total) return;
    setMoreBusy(true); setError('');
    try {
      const result = await notesApi.list(notes.length);
      setNotes((current) => [...current, ...result.items.filter((item) => !current.some((entry) => entry.id === item.id))]);
      setTotal(result.total);
    } catch (cause) { setError(errorText(cause)); }
    finally { setMoreBusy(false); }
  }

  async function selectNote(note: NoteSummary | null) {
    if (detailLoading || busy || note?.id === selected?.id || dirty && !window.confirm('当前修改尚未保存，确定离开吗？')) return;
    setSelected(null); setTitle(''); setContent(''); setError(''); setNotice('');
    if (!note) return;
    setDetailLoading(true);
    try {
      const result = await notesApi.detail(note.id);
      setSelected(result.note); setTitle(result.note.title); setContent(result.note.content);
    } catch (cause) { setError(errorText(cause)); }
    finally { setDetailLoading(false); }
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!title.trim() || !content.trim() || busy || detailLoading) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const { note } = selected ? await notesApi.update(selected.id, title.trim(), content) : await notesApi.create(title.trim(), content);
      setNotes((current) => [note, ...current.filter((entry) => entry.id !== note.id)]);
      if (!selected) setTotal((count) => count + 1);
      setSelected(note); setTitle(note.title); setContent(note.content); setNotice('已保存');
    } catch (cause) { setError(errorText(cause)); }
    finally { setBusy(false); }
  }

  async function remove() {
    if (!selected || busy || !window.confirm(`确定删除「${selected.title}」吗？公开分享和手机扫码读取会随之失效。`)) return;
    setBusy(true); setError('');
    try {
      await notesApi.remove(selected.id);
      setNotes((current) => current.filter((entry) => entry.id !== selected.id));
      setTotal((count) => Math.max(0, count - 1));
      setSelected(null); setTitle(''); setContent(''); setPair(null); setNotice('笔记已删除');
    } catch (cause) { setError(errorText(cause)); }
    finally { setBusy(false); }
  }

  async function startPair() {
    if (!selected || dirty) { setError('请先保存当前笔记，再生成手机读取二维码'); return; }
    setPairBusy(true); setPairError(''); setPairQr('');
    try {
      const existing = await notePairsApi.active(selected.id);
      const next = existing.id ? { id: existing.id, secret: '', joinUntil: '' } : await notePairsApi.create(selected.id);
      setPair(next); setPairStatus(null);
      if (next.secret) {
        const url = new URL(`phone-note/${next.id}`, new URL(import.meta.env.BASE_URL, window.location.origin));
        url.hash = next.secret;
        setPairQr(await QRCode.toDataURL(url.toString(), { width: 280, margin: 2, errorCorrectionLevel: 'M' }));
      }
    } catch (cause) { setPairError(errorText(cause)); }
    finally { setPairBusy(false); }
  }

  async function approvePair() {
    if (!pair || pairBusy || pairStatus?.status !== 'awaiting') return;
    setPairBusy(true); setPairError('');
    try {
      const result = await notePairsApi.approve(pair.id);
      setPairStatus({ status: result.status, code: null, approvedUntil: result.approvedUntil });
    } catch (cause) { setPairError(errorText(cause)); }
    finally { setPairBusy(false); }
  }

  async function revokePair(close = false) {
    if (!pair || pairBusy) return;
    if (pairStatus?.status === 'expired' || pairStatus?.status === 'revoked') { setPair(null); return; }
    setPairBusy(true); setPairError('');
    try {
      await notePairsApi.revoke(pair.id);
      setPairStatus({ status: 'revoked', code: null, approvedUntil: null }); setPairQr('');
      if (close) setPair(null);
    } catch (cause) { setPairError(errorText(cause)); }
    finally { setPairBusy(false); }
  }

  return <div className="share-workspace notes-workspace">
    <aside className="share-sidebar" data-agent-region="notes.sidebar"><Link to="/" className="share-brand" data-agent-id="nav.home.brand"><img src={`${import.meta.env.BASE_URL}brand-mark.svg`} alt="" /><strong>迹光</strong><span>个人空间</span></Link><span className="share-sidebar-caption">我的空间</span><WorkspaceNavigation /><div className="share-sidebar-note"><b>给文字一个去处</b><p>记录临时想法或旅途札记，随时在手机上安全取回。</p></div></aside>
    <div className="share-main"><header className="share-top" data-agent-region="notes.header"><span>工作空间 / <b>随手记</b></span><nav><Link to="/shares" data-agent-id="notes.header.shares">我的分享</Link><Link to="/settings/account" className="share-header-avatar" aria-label="账号设置" data-agent-id="notes.header.account">{(user?.nickname || '旅').slice(0, 1)}</Link></nav></header>
      <main className="share-container"><div className="share-heading"><div><small>NOTES / 迹光云空间</small><h1>随手记</h1><p>写好后点击保存，随后可以从手机取回或公开分享。</p></div></div>
        <div className="notes-layout"><section className="notes-list" data-agent-region="notes.list"><div className="notes-list-heading"><h2>我的笔记 <span>{total}</span></h2><Button htmlType="button" type="primary" data-agent-id="notes.list.create" onClick={() => void selectNote(null)}>＋ 新建</Button></div><Input.Search value={query} onChange={setQuery} placeholder="搜索已加载笔记标题" aria-label="搜索已加载笔记标题" data-agent-id="notes.list.search" allowClear />
          {loading ? <p role="status">正在读取笔记…</p> : total === 0 ? <div className="notes-empty">还没有笔记，在右侧写下第一句吧。</div> : <div className="notes-list-items">{notes.filter((note) => note.title.toLowerCase().includes(query.trim().toLowerCase())).map((note) => <button key={note.id} type="button" disabled={detailLoading || busy} className={note.id === selected?.id ? 'is-selected' : ''} aria-pressed={note.id === selected?.id} onClick={() => void selectNote(note)} data-agent-id={`notes.row.${note.id}.open`}><strong>{note.title}</strong><span>纯文本笔记 · 点击读取</span><small>{new Date(note.updatedAt).toLocaleString('zh-CN')}</small></button>)}</div>}{notes.length < total && <Button htmlType="button" loading={moreBusy} onClick={() => void loadMore()} data-agent-id="notes.list.more">加载更多</Button>}</section>
          <section className="notes-editor" data-agent-region="notes.editor"><div className="notes-editor-head"><span>{selected ? '编辑笔记' : '新笔记'}</span><span>{detailLoading ? '正在加载正文…' : busy ? '正在保存…' : dirty ? '未保存，离开会丢失修改' : selected ? '已保存' : '尚未创建'}</span></div><form onSubmit={(event) => void save(event)}><label htmlFor="note-title">标题</label><Input id="note-title" value={title} maxLength={80} disabled={detailLoading || busy} onChange={setTitle} placeholder="给这段文字一个标题" data-agent-id="notes.editor.title" required /><label htmlFor="note-content">内容</label><Input.TextArea id="note-content" value={content} maxLength={10000} disabled={detailLoading || busy} onChange={setContent} data-agent-ignore="true" placeholder="在这里写下你想保存的文字…" data-agent-id="notes.editor.content" rows={12} required /><small>{content.length} / 10000 字</small><div className="notes-editor-actions"><Button type="primary" htmlType="submit" loading={busy} disabled={busy || detailLoading || !title.trim() || !content.trim() || !dirty} data-agent-id="notes.editor.save">{selected ? '保存修改' : '保存笔记'}</Button>{selected && <><Button htmlType="button" disabled={busy || pairBusy || dirty} onClick={() => void startPair()} data-agent-id="notes.editor.pair">手机扫码取回</Button><Link className="notes-share-link" to={`/shares/new?targetId=${encodeURIComponent(selected.id)}&targetType=note`} data-agent-id="notes.editor.share" onClick={(event) => { if (dirty) { event.preventDefault(); setError('请先保存笔记再创建分享'); } }}>创建公开分享</Link><Button htmlType="button" status="danger" disabled={busy} onClick={() => void remove()} data-agent-id="notes.editor.delete" data-agent-danger="true">删除</Button></>}</div></form></section></div>
        {error && <p role="alert" className="share-alert">{error}</p>}{notice && <p role="status" className="share-success">{notice}</p>}
      </main><WorkspaceMobileNavigation className="share-mobile-nav" region="notes.mobileNav" />
    </div>
    <Modal visible={Boolean(pair)} footer={null} closable={false} onCancel={() => void revokePair(true)} title="在手机上取回这篇笔记" data-agent-region="notes.pair" className="notes-pair-modal"><p>这是仅限当前笔记的短时扫码授权。手机不必登录，核对手机上显示的六位配对码后再确认。</p>
      {pairQr && pairStatus?.status !== 'approved' && <img src={pairQr} alt="手机读取本条笔记的二维码" data-agent-ignore="true" />}
      {(!pairStatus || pairStatus.status === 'pending') && <p role="status">{pairQr ? '请用手机扫码加入' : '已恢复会话，但二维码不能再次显示；结束会话后可重新生成'}</p>}
      {pairStatus?.status === 'awaiting' && <div className="notes-pair-code"><p>核对手机上的六位码，确认是你正在使用的设备：</p><strong data-agent-ignore="true">{pairStatus.code}</strong><Button type="primary" htmlType="button" loading={pairBusy} data-agent-id="notes.pair.approve" onClick={() => void approvePair()}>码一致，允许读取</Button></div>}
      {pairStatus?.status === 'approved' && <p role="status">手机已获准在短时间内只读这一篇笔记，可以复制文字。</p>}
      {(pairStatus?.status === 'expired' || pairStatus?.status === 'revoked') && <p role="status">本次读取授权已结束，请重新生成二维码。</p>}
      {pairError && <p role="alert" className="share-alert">{pairError}</p>}
      <div className="notes-pair-actions"><Button htmlType="button" status="danger" disabled={pairBusy || pairStatus?.status === 'revoked'} data-agent-id="notes.pair.revoke" data-agent-danger="true" onClick={() => void revokePair()}>结束本次授权</Button><Button htmlType="button" disabled={pairBusy} data-agent-id="notes.pair.close" data-agent-danger="true" onClick={() => void revokePair(true)}>关闭并结束</Button></div>
    </Modal>
  </div>;
}
