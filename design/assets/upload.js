(() => {
  const body = document.body;
  const picker = document.querySelector('#file-picker');
  const dropZone = document.querySelector('#drop-zone');
  const queueList = document.querySelector('#queue-list');
  const queueCard = document.querySelector('#queue-card');
  const queueEmpty = document.querySelector('#queue-empty');
  const queueSummary = document.querySelector('#queue-summary');
  const overallFill = document.querySelector('#overall-fill');
  const toast = document.querySelector('#toast');
  let toastTimer;
  let paused = false;

  function notify(message) {
    toast.textContent = message;
    toast.classList.add('is-visible');
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => toast.classList.remove('is-visible'), 2600);
  }

  function rows() {
    return [...queueList.querySelectorAll('.queue-row')];
  }

  function updateQueue() {
    const currentRows = rows();
    const uploading = currentRows.filter((row) => row.dataset.status === 'uploading').length;
    const failed = currentRows.filter((row) => row.dataset.status === 'failed').length;
    const parts = [`${currentRows.length} 个任务`];
    if (uploading) parts.push(`${uploading} 个正在上传`);
    if (failed) parts.push(`${failed} 个待重试`);
    queueSummary.innerHTML = `${parts.join(' <i>·</i> ')}`;
    queueEmpty.hidden = currentRows.length !== 0;
    queueCard.classList.toggle('has-items', currentRows.length !== 0);
    const average = currentRows.length
      ? currentRows.reduce((sum, row) => sum + Number(row.dataset.progress || 0), 0) / currentRows.length
      : 0;
    overallFill.style.width = `${average}%`;
  }

  function createQueuedRow(file) {
    const row = document.createElement('article');
    row.className = 'queue-row queue-row--local';
    row.dataset.status = 'queued';
    row.dataset.progress = '0';

    const preview = document.createElement('div');
    const isVideo = file.type.startsWith('video/');
    const isAudio = file.type.startsWith('audio/');
    preview.className = `file-preview ${isVideo ? 'file-preview--video' : isAudio ? 'file-preview--audio' : 'file-preview--photo'}`;
    if (isAudio) {
      const wave = document.createElement('span');
      wave.className = 'audio-wave';
      for (let i = 0; i < 9; i += 1) wave.append(document.createElement('i'));
      preview.append(wave);
    } else {
      const shape = document.createElement('span');
      shape.className = isVideo ? 'preview-ridge preview-ridge--front' : 'preview-hill preview-hill--front';
      preview.append(shape);
    }
    const kind = document.createElement('span');
    kind.className = 'file-kind';
    kind.textContent = (file.name.split('.').pop() || 'FILE').slice(0, 5).toUpperCase();
    preview.append(kind);

    const main = document.createElement('div');
    main.className = 'file-main';
    const titleLine = document.createElement('div');
    titleLine.className = 'file-name-line';
    const title = document.createElement('h3');
    title.textContent = file.name;
    const status = document.createElement('span');
    status.className = 'status status--queued';
    status.textContent = '待上传';
    titleLine.append(title, status);
    const meta = document.createElement('p');
    meta.className = 'file-meta';
    const size = file.size < 1024 * 1024
      ? `${Math.max(1, Math.round(file.size / 1024))} KB`
      : `${(file.size / 1024 / 1024).toFixed(file.size > 1024 * 1024 * 1024 ? 1 : 0)} MB`;
    meta.textContent = `${size} · 本地选择 · 仅预览，不会上传`;
    const progress = document.createElement('div');
    progress.className = 'file-progress';
    const progressFill = document.createElement('span');
    progressFill.style.setProperty('--progress', '0%');
    progress.append(progressFill);
    const detail = document.createElement('div');
    detail.className = 'file-progress-meta';
    const detailText = document.createElement('span');
    detailText.textContent = '等待开始';
    detail.append(detailText);
    main.append(titleLine, meta, progress, detail);

    const action = document.createElement('button');
    action.className = 'row-action';
    action.type = 'button';
    action.dataset.action = 'remove';
    action.setAttribute('aria-label', `从预览队列移除 ${file.name}`);
    action.innerHTML = '<svg viewBox="0 0 24 24"><path d="m7 7 10 10M17 7 7 17"/></svg>';
    row.append(preview, main, action);
    return row;
  }

  function addFiles(fileList) {
    const files = [...(fileList || [])];
    if (!files.length) return;
    body.classList.remove('preview-empty');
    files.forEach((file) => queueList.append(createQueuedRow(file)));
    updateQueue();
    notify(`${files.length} 个本地文件已加入界面预览；没有上传到云端`);
  }

  document.querySelector('#choose-files').addEventListener('click', () => picker.click());
  picker.addEventListener('change', (event) => {
    addFiles(event.currentTarget.files);
    event.currentTarget.value = '';
  });

  ['dragenter', 'dragover'].forEach((eventName) => {
    dropZone.addEventListener(eventName, (event) => {
      event.preventDefault();
      dropZone.classList.add('is-dragging');
    });
  });
  ['dragleave', 'drop'].forEach((eventName) => {
    dropZone.addEventListener(eventName, (event) => {
      event.preventDefault();
      if (eventName === 'drop') addFiles(event.dataTransfer.files);
      if (eventName === 'drop' || !dropZone.contains(event.relatedTarget)) dropZone.classList.remove('is-dragging');
    });
  });

  const destinationToggle = document.querySelector('#destination-toggle');
  const destinationMenu = document.querySelector('#destination-menu');
  destinationToggle.addEventListener('click', () => {
    const expanded = destinationToggle.getAttribute('aria-expanded') === 'true';
    destinationToggle.setAttribute('aria-expanded', String(!expanded));
    destinationMenu.hidden = expanded;
  });
  destinationMenu.addEventListener('click', (event) => {
    const option = event.target.closest('[data-destination]');
    if (!option) return;
    document.querySelector('#destination-name').textContent = option.dataset.destination;
    destinationMenu.hidden = true;
    destinationToggle.setAttribute('aria-expanded', 'false');
    notify(`目标目录预览：${option.dataset.destination}`);
  });
  document.addEventListener('click', (event) => {
    if (!event.target.closest('.destination-card')) {
      destinationMenu.hidden = true;
      destinationToggle.setAttribute('aria-expanded', 'false');
    }
  });

  document.querySelectorAll('[data-preview-mode]').forEach((button) => {
    button.addEventListener('click', () => {
      const empty = button.dataset.previewMode === 'empty';
      body.classList.toggle('preview-empty', empty);
      document.querySelectorAll('[data-preview-mode]').forEach((item) => item.classList.toggle('is-active', item === button));
      if (empty) queueSummary.innerHTML = '0 个任务';
      else updateQueue();
    });
  });

  document.querySelector('#start-upload').addEventListener('click', () => {
    body.classList.remove('preview-empty');
    document.querySelector('[data-preview-mode="sample"]').classList.add('is-active');
    document.querySelector('[data-preview-mode="empty"]').classList.remove('is-active');
    const waitingRows = rows().filter((row) => ['queued', 'failed'].includes(row.dataset.status));
    if (!waitingRows.length) {
      notify('当前没有等待开始的任务；此处仅为界面原型');
      return;
    }
    waitingRows.forEach((row, index) => {
      row.dataset.status = 'uploading';
      row.dataset.progress = '0';
      const progressBar = row.querySelector('.file-progress span');
      progressBar.style.setProperty('--progress', '0%');
      progressBar.style.width = '';
      row.classList.add('is-previewing');
      const status = row.querySelector('.status');
      status.className = 'status status--uploading';
      status.innerHTML = '<i></i>预览中';
      const detail = row.querySelector('.file-progress-meta span');
      if (detail) detail.textContent = '正在播放进度动效';
      row.style.animationDelay = `${index * 90}ms`;
    });
    updateQueue();
    notify('进度动画预览中；没有发起 COS 或后端请求');
    window.setTimeout(() => {
      waitingRows.forEach((row) => {
        row.classList.remove('is-previewing');
        if (!row.isConnected) return;
        row.dataset.status = 'queued';
        row.dataset.progress = '0';
        const status = row.querySelector('.status');
        status.className = 'status status--queued';
        status.textContent = '待上传';
        const detail = row.querySelector('.file-progress-meta span');
        if (detail) detail.textContent = '等待开始';
      });
      updateQueue();
    }, 4100);
  });

  document.querySelector('#pause-all').addEventListener('click', (event) => {
    paused = !paused;
    event.currentTarget.querySelector('span').textContent = paused ? '全部继续' : '全部暂停';
    rows().filter((row) => row.dataset.status === 'uploading').forEach((row) => row.classList.toggle('is-paused', paused));
    notify(paused ? '暂停状态预览；未控制真实上传' : '继续状态预览；未控制真实上传');
  });

  queueList.addEventListener('click', (event) => {
    const action = event.target.closest('[data-action]');
    if (!action) return;
    const row = action.closest('.queue-row');
    if (action.dataset.action === 'remove') {
      row.remove();
      updateQueue();
      notify('已从原型队列移除；本地文件未被删除');
    } else if (action.dataset.action === 'pause') {
      const isPaused = row.classList.toggle('is-paused');
      action.dataset.action = isPaused ? 'resume' : 'pause';
      action.setAttribute('aria-label', isPaused ? '继续 DJI_0231.MP4' : '暂停 DJI_0231.MP4');
      action.innerHTML = isPaused
        ? '<svg viewBox="0 0 24 24"><path d="m8 5 11 7-11 7z"/></svg>'
        : '<svg viewBox="0 0 24 24"><path d="M9 5v14M15 5v14"/></svg>';
      notify(isPaused ? '已切换为暂停状态预览' : '已切换为继续状态预览');
    } else if (action.dataset.action === 'resume') {
      row.classList.remove('is-paused');
      action.dataset.action = 'pause';
      action.innerHTML = '<svg viewBox="0 0 24 24"><path d="M9 5v14M15 5v14"/></svg>';
      notify('已切换为继续状态预览');
    } else if (action.dataset.action === 'retry') {
      row.dataset.status = 'queued';
      row.dataset.progress = '0';
      const status = row.querySelector('.status');
      status.className = 'status status--queued';
      status.textContent = '待重试';
      row.querySelector('.file-progress-meta span').textContent = '等待重新开始';
      updateQueue();
      notify('已加入重试状态预览；没有开始实际传输');
    } else if (action.dataset.action === 'open') {
      notify('文件预览将在接入真实上传与文件接口后开放');
    }
  });

  document.querySelector('#clear-done').addEventListener('click', () => {
    const completed = rows().filter((row) => row.dataset.status === 'done');
    completed.forEach((row) => row.remove());
    updateQueue();
    notify(completed.length ? '已从预览队列清除完成项' : '当前没有已完成项目');
  });

  document.querySelector('#preview-flow').addEventListener('click', () => document.querySelector('#start-upload').click());
  updateQueue();
})();
