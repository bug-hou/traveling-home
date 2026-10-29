(() => {
  const located = [
    { name: '稻城亚丁 · 日落.jpg', place: '山谷边的日落', kind: '照片', source: 'EXIF 位置', art: 'ridge', x: 27, y: 42, preview: 'located' },
    { name: '山间公路航拍.MP4', place: '路过的山间公路', kind: '视频', source: 'SRT 位置', art: 'forest', x: 48, y: 67 },
    { name: '海边的下午.jpg', place: '海岸边的下午', kind: '照片', source: '手动标记', art: 'coast', x: 72, y: 33 },
    { name: '晨雾里的一棵树.jpg', place: '晨雾中的林间', kind: '照片', source: 'EXIF 位置', art: 'forest', x: 74, y: 77 }
  ];
  const unlocated = [
    { name: '云海与日出.jpg', kind: '照片', art: 'missing', preview: 'unlocated' },
    { name: '沿途片段.MP4', kind: '视频', art: 'missing' }
  ];
  const $ = (selector) => document.querySelector(selector);
  let mode = 'sample';
  let tab = 'located';
  let selected = 0;
  let previousFocus = null;

  const icon = (name) => {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
    svg.setAttribute('aria-hidden', 'true');
    use.setAttribute('href', `#i-${name}`);
    svg.append(use);
    return svg;
  };

  function showMapMessage(title, detail, action) {
    const box = $('#map-message');
    const heading = document.createElement('strong');
    const text = document.createElement('p');
    heading.textContent = title;
    text.textContent = detail;
    box.replaceChildren(icon('pin'), heading, text);
    if (action) {
      const link = document.createElement('a');
      link.href = 'upload.html';
      link.textContent = '去上传素材 →';
      box.append(link);
    }
    box.hidden = false;
  }

  function showPreview(item) {
    previousFocus = document.activeElement;
    $('#dialog-art').className = `dialog-art art-${item.art}`;
    $('#dialog-title').textContent = item.name;
    $('#dialog-location').textContent = item.place ? `${item.place} · ${item.source}` : '尚未定位 · 可在素材预览中手动补充位置';
    $('#dialog-link').hidden = !item.preview;
    if (item.preview) $('#dialog-link').href = `preview.html?demo=${item.preview}`;
    $('#preview-dialog').hidden = false;
    document.body.style.overflow = 'hidden';
    $('#close-preview').focus();
  }

  function closePreview() {
    $('#preview-dialog').hidden = true;
    document.body.style.overflow = '';
    previousFocus?.focus();
  }

  function selectPoint(index) {
    selected = index;
    render();
    if (window.matchMedia('(max-width: 700px)').matches) {
      $('#media-detail').scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'nearest' });
    }
  }

  function renderMarkers() {
    const container = $('#map-markers');
    container.replaceChildren();
    $('#map-message').hidden = true;
    if (mode === 'empty') {
      showMapMessage('第一枚足迹，等你来放下', '上传带 GPS 的照片或视频，也可以在素材预览中手动标记位置。', true);
      return;
    }
    if (mode === 'error') {
      showMapMessage('足迹暂时没能加载', '网络连接可能中断了。请稍后重试；不要将加载失败误认为没有素材。');
      return;
    }
    if (tab === 'unlocated') {
      showMapMessage('没有坐标，就不会有地图点位', '下面列出的素材仍保存在文件中。打开预览，手动补上位置后才会出现在地图里。');
      return;
    }
    located.forEach((item, index) => {
      const marker = document.createElement('button');
      const label = document.createElement('span');
      marker.type = 'button';
      marker.className = `marker${index === selected ? ' is-selected' : ''}`;
      marker.style.left = `${item.x}%`;
      marker.style.top = `${item.y}%`;
      marker.setAttribute('aria-label', `查看示例点位：${item.name}`);
      marker.setAttribute('aria-pressed', String(index === selected));
      marker.append(icon('pin'));
      label.className = 'marker-label';
      label.textContent = item.place;
      marker.append(label);
      marker.addEventListener('click', () => selectPoint(index));
      container.append(marker);
    });
  }

  function renderRow(item, index) {
    const button = document.createElement('button');
    const artwork = document.createElement('span');
    const copy = document.createElement('span');
    const name = document.createElement('strong');
    const subtitle = document.createElement('small');
    const arrow = document.createElement('span');
    button.type = 'button';
    button.className = `media-item${tab === 'located' && index === selected ? ' is-selected' : ''}`;
    button.setAttribute('aria-label', tab === 'located' ? `查看示例点位：${item.name}` : `预览未定位素材：${item.name}`);
    if (tab === 'located') button.setAttribute('aria-pressed', String(index === selected));
    artwork.className = `media-item-art art-${item.art}`;
    copy.className = 'media-item-text';
    name.textContent = item.name;
    subtitle.textContent = tab === 'located' ? `${item.kind} · ${item.place}` : `${item.kind} · 尚未定位`;
    arrow.className = 'media-item-arrow';
    arrow.textContent = '›';
    copy.append(name, subtitle);
    button.append(artwork, copy, arrow);
    button.addEventListener('click', () => tab === 'located' ? selectPoint(index) : showPreview(item));
    return button;
  }

  function renderEmptyPane() {
    const panel = document.createElement('div');
    const heading = document.createElement('strong');
    const text = document.createElement('p');
    panel.className = 'pane-empty';
    heading.textContent = mode === 'error' ? '暂时无法读取素材' : tab === 'located' ? '还没有已定位素材' : '没有待标记的素材';
    text.textContent = mode === 'error' ? '检查网络后可以重新加载。' : tab === 'located' ? '上传有 GPS 的素材，或在预览中手动标记。' : '当前位置状态下，所有素材都已标记。';
    panel.append(heading, text);
    if (mode === 'error') {
      const retry = document.createElement('button');
      retry.type = 'button';
      retry.textContent = '重新尝试';
      retry.addEventListener('click', () => { mode = 'sample'; render(); });
      panel.append(retry);
    } else if (tab === 'located') {
      const link = document.createElement('a');
      link.href = 'upload.html';
      link.textContent = '上传素材 →';
      panel.append(link);
    }
    $('#media-list').append(panel);
  }

  function renderPane() {
    const list = $('#media-list');
    const detail = $('#media-detail');
    list.replaceChildren();
    detail.hidden = true;
    $('#pane-foot').hidden = mode !== 'sample';
    $('#pane-label').textContent = tab === 'located' ? '已定位的照片与视频' : '这些素材还没有坐标';
    $('#pane-total').textContent = mode === 'error' ? '读取失败' : mode === 'empty' ? '0 份素材' : `${tab === 'located' ? located.length : unlocated.length} 份素材`;
    if (mode !== 'sample') { renderEmptyPane(); return; }
    const items = tab === 'located' ? located : unlocated;
    list.classList.toggle('unlocated-list', tab === 'unlocated');
    items.forEach((item, index) => list.append(renderRow(item, index)));
    if (tab === 'unlocated') {
      $('#pane-foot').textContent = '未定位素材不在地图上显示；这里不会根据文件名猜测坐标。';
      return;
    }
    const item = located[selected];
    $('#detail-art').className = `detail-art art-${item.art}`;
    $('#detail-kind').textContent = item.kind === '视频' ? 'VIDEO' : 'PHOTO';
    $('#detail-name').textContent = item.name;
    $('#detail-location').textContent = item.place;
    $('#detail-source').textContent = `${item.source} · 位置与图片均为设计示例`;
    $('#pane-foot').textContent = '选择地图上的点位，查看属于那里的素材。';
    detail.hidden = false;
  }

  function updateStat(selector, value) {
    const stat = $(selector);
    stat.replaceChildren(document.createTextNode(value));
    if (value !== '—') {
      const unit = document.createElement('span');
      unit.textContent = '份';
      stat.append(unit);
    }
  }

  function render() {
    const sample = mode === 'sample';
    updateStat('#located-count', mode === 'error' ? '—' : sample ? '04' : '00');
    updateStat('#unlocated-count', mode === 'error' ? '—' : sample ? '02' : '00');
    $('#tab-located-count').textContent = mode === 'error' ? '—' : sample ? '04' : '00';
    $('#tab-unlocated-count').textContent = mode === 'error' ? '—' : sample ? '02' : '00';
    document.querySelectorAll('[data-mode]').forEach((button) => {
      const active = button.dataset.mode === mode;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', String(active));
    });
    document.querySelectorAll('[data-tab]').forEach((button) => {
      const active = button.dataset.tab === tab;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', String(active));
    });
    renderMarkers();
    renderPane();
  }

  document.querySelectorAll('[data-mode]').forEach((button) => button.addEventListener('click', () => { mode = button.dataset.mode; tab = 'located'; selected = 0; render(); }));
  document.querySelectorAll('[data-tab]').forEach((button) => button.addEventListener('click', () => { tab = button.dataset.tab; render(); }));
  $('#show-unlocated').addEventListener('click', () => { mode = 'sample'; tab = 'unlocated'; render(); $('.workspace').scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'start' }); });
  $('#open-preview').addEventListener('click', () => showPreview(located[selected]));
  $('#close-preview').addEventListener('click', closePreview);
  $('#preview-dialog').addEventListener('click', (event) => { if (event.target === $('#preview-dialog')) closePreview(); });
  document.addEventListener('keydown', (event) => {
    if ($('#preview-dialog').hidden) return;
    if (event.key === 'Escape') { closePreview(); return; }
    if (event.key !== 'Tab') return;
    const focusable = [...$('#preview-dialog').querySelectorAll('button, a')].filter((element) => !element.hidden);
    if (event.shiftKey && document.activeElement === focusable[0]) { event.preventDefault(); focusable.at(-1).focus(); }
    else if (!event.shiftKey && document.activeElement === focusable.at(-1)) { event.preventDefault(); focusable[0].focus(); }
  });
  render();
})();
