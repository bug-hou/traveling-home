(() => {
  const samples = [
    { id: 'f-west', parentId: null, type: 'folder', name: '川西环线', size: 0, created: 8, updated: 28 },
    { id: 'f-sea', parentId: null, type: 'folder', name: '沿海慢行', size: 0, created: 9, updated: 25 },
    { id: 'f-inbox', parentId: null, type: 'folder', name: '待整理素材', size: 0, created: 10, updated: 27 },
    { id: 'v-231', parentId: null, type: 'video', name: 'DJI_0231.MP4', size: 2400000000, created: 22, updated: 28 },
    { id: 'p-001', parentId: null, type: 'photo', name: '云海与日出.jpg', size: 18400000, created: 23, updated: 27 },
    { id: 'a-001', parentId: null, type: 'audio', name: '海边环境声.wav', size: 186000000, created: 24, updated: 26 },
    { id: 'x-001', parentId: null, type: 'other', name: '航拍记录.SRT', size: 42000, created: 25, updated: 25 },
    { id: 'f-west-1', parentId: 'f-west', type: 'folder', name: '稻城亚丁', size: 0, created: 11, updated: 27 },
    { id: 'f-west-2', parentId: 'f-west', type: 'folder', name: '四姑娘山', size: 0, created: 12, updated: 24 },
    { id: 'p-west', parentId: 'f-west', type: 'photo', name: '川西公路的黄昏.jpg', size: 12500000, created: 13, updated: 26 },
    { id: 'p-yading', parentId: 'f-west-1', type: 'photo', name: '稻城亚丁 · 日落.jpg', size: 48000000, created: 14, updated: 27 },
    { id: 'v-siguniang', parentId: 'f-west-2', type: 'video', name: '四姑娘山航拍.MP4', size: 860000000, created: 15, updated: 24 },
    { id: 'p-sea', parentId: 'f-sea', type: 'photo', name: '平潭的蓝色海岸.jpg', size: 12600000, created: 16, updated: 25 }
  ];
  let items = samples.map((item) => ({ ...item }));
  let mode = 'sample';
  let folderId = null;
  let view = 'grid';
  let query = '';
  let menuId = null;
  let draggingId = null;
  let lastFocus = null;
  let toastTimer;
  const $ = (selector) => document.querySelector(selector);
  const list = $('#items');
  const modal = $('#modal');
  const notice = $('#toast');
  const icon = (name) => `<svg aria-hidden="true"><use href="#i-${name}"/></svg>`;
  const find = (id) => items.find((item) => item.id === id);
  const folders = () => items.filter((item) => item.type === 'folder');
  const childrenOf = (id) => items.filter((item) => item.parentId === id);
  const formatSize = (bytes) => bytes < 1000000 ? `${Math.round(bytes / 1000)} KB` : bytes < 1000000000 ? `${(bytes / 1000000).toFixed(bytes < 10000000 ? 1 : 0)} MB` : `${(bytes / 1000000000).toFixed(1)} GB`;

  function notify(message) {
    notice.textContent = message;
    notice.classList.add('is-visible');
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => notice.classList.remove('is-visible'), 3000);
  }

  function make(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  }

  function button(className, text, onClick) {
    const element = make('button', className, text);
    element.type = 'button';
    element.addEventListener('click', onClick);
    return element;
  }

  function ancestors(id) {
    const result = [];
    const seen = new Set();
    let cursor = find(id);
    while (cursor && !seen.has(cursor.id)) {
      result.unshift(cursor);
      seen.add(cursor.id);
      cursor = find(cursor.parentId);
    }
    return result;
  }

  function insideFolder(nodeId, targetId) {
    return targetId !== null && ancestors(targetId).some((item) => item.id === nodeId);
  }

  function canMove(node, targetId) {
    return !!node && (targetId === null || find(targetId)?.type === 'folder') && node.parentId !== targetId && node.id !== targetId && !insideFolder(node.id, targetId);
  }

  function moveNode(nodeId, targetId) {
    const node = find(nodeId);
    if (!canMove(node, targetId)) {
      notify('不能移动到原目录、文件夹自身或它的子目录');
      return;
    }
    const targetName = targetId === null ? '全部文件' : find(targetId).name;
    node.parentId = targetId;
    node.updated = 28;
    menuId = null;
    render();
    notify(`原型演示：已将「${node.name}」移到「${targetName}」，未调用云端接口`);
  }

  function crumb(id, label, isCurrent) {
    if (isCurrent) return make('span', 'current', label);
    const element = button('', label, () => navigate(id));
    element.dataset.dropFolder = id === null ? 'root' : id;
    return element;
  }

  function renderBreadcrumbs() {
    const container = $('#breadcrumbs');
    container.replaceChildren();
    const parts = query ? [{ id: null, name: '全部文件' }, { id: 'search', name: '搜索结果' }] : [{ id: null, name: '全部文件' }, ...ancestors(folderId)];
    parts.forEach((part, index) => {
      if (index) {
        const arrow = make('span');
        arrow.innerHTML = icon('chevron');
        container.append(arrow);
      }
      container.append(crumb(part.id, part.name, index === parts.length - 1));
    });
    const currentName = query ? '搜索结果' : folderId ? find(folderId)?.name || '全部文件' : '全部文件';
    $('#topbar-location').textContent = currentName;
    $('#section-title').textContent = query ? '搜索结果' : folderId ? find(folderId)?.name || '我的文件' : '我的文件';
    $('#section-subtitle').textContent = query ? '在所有示例目录中按名称查找' : '当前目录 · 示例内容';
  }

  function renderSidebar() {
    const sidebar = $('#side-folders');
    sidebar.replaceChildren();
    folders().filter((item) => item.parentId === null).forEach((item) => {
      const entry = button(`side-folder${folderId === item.id ? ' is-current' : ''}`, '', () => navigate(item.id));
      entry.innerHTML = icon('folder');
      entry.append(make('span', '', item.name));
      entry.dataset.dropFolder = item.id;
      sidebar.append(entry);
    });
  }

  function createThumb(node) {
    const thumb = make('div', `thumb thumb--${node.type}`);
    if (node.type === 'folder') {
      const art = make('span', 'folder-art');
      art.innerHTML = icon('folder');
      thumb.append(art);
    } else if (node.type === 'photo' || node.type === 'video') {
      ['scenery-sun', 'scenery-back', 'scenery-front'].forEach((name) => thumb.append(make('span', name)));
      if (node.type === 'video') thumb.append(make('span', 'play-button', '▶'));
    } else if (node.type === 'audio') {
      const wave = make('span', 'waveform');
      for (let index = 0; index < 9; index += 1) wave.append(make('i'));
      thumb.append(wave);
    } else thumb.append(make('span', 'other-symbol', 'SRT'));
    thumb.append(make('span', 'thumb-kind', { folder: '目录', photo: 'PHOTO', video: 'VIDEO', audio: 'AUDIO', other: 'FILE' }[node.type]));
    return thumb;
  }

  function renderCard(node) {
    const card = make('article', 'file-card');
    card.dataset.nodeId = node.id;
    card.draggable = true;
    if (node.type === 'folder') card.dataset.dropFolder = node.id;
    const main = button('card-main', '', () => node.type === 'folder' ? navigate(node.id) : notify('文件预览需签名 URL 接口；此处不读取真实素材'));
    main.setAttribute('aria-label', node.type === 'folder' ? `打开文件夹 ${node.name}` : `查看文件 ${node.name}`);
    const thumb = createThumb(node);
    const copy = make('span', 'card-copy');
    copy.append(make('span', 'card-name', node.name), make('span', 'card-meta', node.type === 'folder' ? '文件夹 · 点击打开' : `${formatSize(node.size)} · 10月${node.updated}日`));
    if (view === 'list') {
      const identity = make('span', 'file-identity');
      identity.append(thumb, copy);
      main.append(identity, make('span', 'list-size', node.type === 'folder' ? '—' : formatSize(node.size)), make('span', 'list-date', `10月${node.updated}日`));
    } else main.append(thumb, copy);
    const more = button('card-more', '', () => {
      menuId = menuId === node.id ? null : node.id;
      render();
    });
    more.innerHTML = icon('more');
    more.setAttribute('aria-label', `${node.name}的更多操作`);
    more.setAttribute('aria-expanded', String(menuId === node.id));
    card.append(main, more);
    if (menuId === node.id) {
      const menu = make('div', 'card-menu');
      menu.append(
        button('', '重命名', () => openNameModal(node)),
        button('', '移动到…', () => openMoveModal(node)),
        button('danger', '移入回收站', () => openDeleteModal(node))
      );
      card.append(menu);
    }
    return card;
  }

  function visibleItems() {
    const normalized = query.toLocaleLowerCase();
    const shown = query ? items.filter((item) => item.name.toLocaleLowerCase().includes(normalized)) : childrenOf(folderId);
    const sortBy = $('#sort-select').value;
    shown.sort((a, b) => {
      if (sortBy === 'updated') return b.updated - a.updated || a.name.localeCompare(b.name, 'zh-CN');
      if (sortBy === 'created') return a.created - b.created || a.name.localeCompare(b.name, 'zh-CN');
      if (sortBy === 'size') return b.size - a.size || a.name.localeCompare(b.name, 'zh-CN');
      return a.name.localeCompare(b.name, 'zh-CN');
    });
    return shown;
  }

  function render() {
    if (folderId && !find(folderId)) folderId = null;
    renderBreadcrumbs();
    renderSidebar();
    list.className = `items ${view}-view`;
    const shown = visibleItems();
    list.replaceChildren();
    if (view === 'list' && shown.length) {
      const head = make('div', 'list-head');
      ['名称', '大小', '修改时间'].forEach((label) => head.append(make('span', '', label)));
      list.append(head);
    }
    shown.forEach((item) => list.append(renderCard(item)));
    const empty = !shown.length;
    list.hidden = empty;
    $('#empty-state').hidden = !empty;
    $('#library-info').textContent = query ? `搜索「${query}」 · ${shown.length} 个匹配项` : `当前目录 · ${shown.length} 项（示例）`;
    if (empty) {
      $('#empty-title').textContent = query ? '没有找到匹配的文件' : folderId ? '这个文件夹还是空的' : '这里还没有文件';
      $('#empty-message').textContent = query ? '换一个文件名试试；原型只按名称搜索。' : '创建文件夹，或者上传第一份旅途素材。';
      $('#empty-actions').hidden = !!query;
    }
    $('#grid-button').classList.toggle('is-active', view === 'grid');
    $('#list-button').classList.toggle('is-active', view === 'list');
    $('#grid-button').setAttribute('aria-pressed', String(view === 'grid'));
    $('#list-button').setAttribute('aria-pressed', String(view === 'list'));
    document.querySelectorAll('[data-preview]').forEach((entry) => entry.classList.toggle('is-active', entry.dataset.preview === mode));
  }

  function navigate(id) {
    folderId = id;
    query = '';
    $('#search-input').value = '';
    menuId = null;
    render();
  }

  function closeModal() {
    modal.hidden = true;
    $('#modal-content').replaceChildren();
    $('#modal-actions').replaceChildren();
    lastFocus?.focus();
  }

  function openModal(title) {
    lastFocus = document.activeElement;
    menuId = null;
    render();
    $('#modal-title').textContent = title;
    $('#modal-content').replaceChildren();
    $('#modal-actions').replaceChildren();
    modal.hidden = false;
  }

  function showNameModal(node) {
    const isNew = !node;
    openModal(isNew ? '新建文件夹' : '重命名');
    const content = $('#modal-content');
    const label = make('label', '', isNew ? '文件夹名称' : '新名称');
    const input = make('input');
    input.id = 'name-input';
    input.value = node?.name || '';
    input.maxLength = 255;
    label.htmlFor = input.id;
    const error = make('div', 'modal-error');
    error.setAttribute('role', 'alert');
    content.append(label, input, error);
    $('#modal-actions').append(button('', '取消', closeModal), button('primary', isNew ? '创建文件夹' : '保存名称', save));
    input.addEventListener('keydown', (event) => { if (event.key === 'Enter') save(); });
    input.focus();
    input.select();
    function save() {
      const name = input.value.trim();
      if (!name || name === '.' || name === '..' || /[\\/\0]/.test(name)) {
        error.textContent = '请输入 1–255 字符的名称，不能包含 / 或 \\，也不能仅为 . 或 ..';
        return;
      }
      if (isNew) items.push({ id: `demo-${Date.now()}-${Math.random().toString(36).slice(2)}`, parentId: folderId, type: 'folder', name, size: 0, created: 28, updated: 28 });
      else { node.name = name; node.updated = 28; }
      closeModal();
      render();
      notify(`原型演示：${isNew ? '已创建示例文件夹' : '已更新示例名称'}，未保存到云端`);
    }
  }

  function openNameModal(node) { showNameModal(node); }

  function openMoveModal(node) {
    openModal(`移动「${node.name}」`);
    const content = $('#modal-content');
    content.append(make('p', '', '选择一个目标目录。移动端也可以通过文件卡片的“更多操作”进入这里。'));
    const choices = make('div', 'destination-list');
    let selected = node.parentId;
    const available = [{ id: null, name: '全部文件', depth: 0 }];
    function walk(parentId, depth) {
      folders().filter((folder) => folder.parentId === parentId).sort((a, b) => a.name.localeCompare(b.name, 'zh-CN')).forEach((folder) => {
        if (folder.id === node.id || insideFolder(node.id, folder.id)) return;
        available.push({ ...folder, depth });
        walk(folder.id, depth + 1);
      });
    }
    walk(null, 1);
    available.forEach((folder) => {
      const entry = button(`depth-${Math.min(folder.depth, 2)}${selected === folder.id ? ' selected' : ''}`, '', () => {
        selected = folder.id;
        choices.querySelectorAll('button').forEach((option) => option.classList.toggle('selected', option === entry));
      });
      entry.innerHTML = icon('folder');
      entry.append(make('span', '', folder.name));
      entry.disabled = folder.id === node.parentId;
      choices.append(entry);
    });
    content.append(choices, make('p', 'move-hint', '原目录、文件夹自身及其子目录不可选。此处仅模拟单项移动。'));
    $('#modal-actions').append(button('', '取消', closeModal), button('primary', '移动到此处', () => {
      if (!canMove(node, selected)) { notify('请选择另一个目标目录'); return; }
      closeModal();
      moveNode(node.id, selected);
    }));
  }

  function openDeleteModal(node) {
    openModal('移入回收站');
    $('#modal-content').append(make('p', '', `要将「${node.name}」移入回收站吗？若为文件夹，示例中的子项也会一起移走。本原型只从当前页面移除示例，不会操作你的文件。`));
    $('#modal-actions').append(button('', '取消', closeModal), button('danger', '确认移入', () => {
      const removed = new Set([node.id]);
      let changed = true;
      while (changed) {
        changed = false;
        items.forEach((item) => { if (removed.has(item.parentId) && !removed.has(item.id)) { removed.add(item.id); changed = true; } });
      }
      items = items.filter((item) => !removed.has(item.id));
      closeModal();
      render();
      notify('原型演示：已从示例视图移除；并未调用删除接口');
    }));
  }

  $('#create-folder').addEventListener('click', () => showNameModal());
  document.querySelector('[data-action="new-folder"]').addEventListener('click', () => showNameModal());
  $('#grid-button').addEventListener('click', () => { view = 'grid'; menuId = null; render(); });
  $('#list-button').addEventListener('click', () => { view = 'list'; menuId = null; render(); });
  $('#sort-select').addEventListener('change', render);
  $('#search-input').addEventListener('input', (event) => { query = event.target.value.trim(); menuId = null; render(); });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') { if (!modal.hidden) closeModal(); else if (menuId) { menuId = null; render(); } }
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); $('#search-input').focus(); }
  });
  $('#modal-close').addEventListener('click', closeModal);
  modal.addEventListener('click', (event) => { if (event.target === modal) closeModal(); });
  document.addEventListener('click', (event) => { if (menuId && !event.target.closest('.card-more, .card-menu')) { menuId = null; render(); } });
  document.querySelectorAll('[data-unavailable]').forEach((entry) => entry.addEventListener('click', () => notify(`${entry.dataset.unavailable}不在本次文件页原型范围内`)));
  document.querySelectorAll('[data-preview]').forEach((entry) => entry.addEventListener('click', () => {
    mode = entry.dataset.preview;
    items = (mode === 'sample' ? samples : []).map((item) => ({ ...item }));
    folderId = null;
    query = '';
    $('#search-input').value = '';
    menuId = null;
    render();
  }));
  $('#reset-sample').addEventListener('click', () => {
    mode = 'sample';
    items = samples.map((item) => ({ ...item }));
    folderId = null;
    query = '';
    $('#search-input').value = '';
    menuId = null;
    render();
    notify('示例文件已重置');
  });

  document.addEventListener('dragstart', (event) => {
    const card = event.target.closest('.file-card');
    if (!card) return;
    draggingId = card.dataset.nodeId;
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('application/x-jiguang-demo-node', draggingId);
    requestAnimationFrame(() => card.classList.add('is-dragging'));
  });
  document.addEventListener('dragend', () => { draggingId = null; document.querySelectorAll('.drag-target,.is-dragging').forEach((entry) => entry.classList.remove('drag-target', 'is-dragging')); });
  document.addEventListener('dragover', (event) => {
    if (!draggingId) { if (Array.from(event.dataTransfer?.types || []).includes('Files')) event.preventDefault(); return; }
    const target = event.target.closest('[data-drop-folder]');
    document.querySelectorAll('.drag-target').forEach((entry) => { if (entry !== target) entry.classList.remove('drag-target'); });
    if (!target) return;
    event.preventDefault();
    const targetId = target.dataset.dropFolder === 'root' ? null : target.dataset.dropFolder;
    const valid = canMove(find(draggingId), targetId);
    target.classList.toggle('drag-target', valid);
    event.dataTransfer.dropEffect = valid ? 'move' : 'none';
  });
  document.addEventListener('drop', (event) => {
    if (!draggingId) {
      if (event.dataTransfer?.files.length) { event.preventDefault(); notify('电脑本地文件应前往上传页；本原型不会读取或上传文件'); }
      return;
    }
    event.preventDefault();
    const target = event.target.closest('[data-drop-folder]');
    const nodeId = draggingId;
    draggingId = null;
    document.querySelectorAll('.drag-target,.is-dragging').forEach((entry) => entry.classList.remove('drag-target', 'is-dragging'));
    if (!target) { notify('请将站内文件拖到文件夹、侧栏目录或上方路径'); return; }
    moveNode(nodeId, target.dataset.dropFolder === 'root' ? null : target.dataset.dropFolder);
  });
  render();
})();
