(() => {
  const demos = {
    located: { name: '稻城亚丁 · 日落.jpg', kind: '照片 · 示例素材', type: 'JPEG 图片', size: '48.0 MB', upload: '示例 · 10 月 27 日', tag: 'JPG', icon: 'photo', stage: 'photo', location: { name: '示例 · 稻城亚丁', longitude: 100.3, latitude: 28.48 } },
    unlocated: { name: '云海与日出.jpg', kind: '照片 · 示例素材', type: 'JPEG 图片', size: '18.4 MB', upload: '示例 · 10 月 27 日', tag: 'JPG', icon: 'photo', stage: 'photo', location: null },
    video: { name: 'DJI_0231.MP4', kind: '视频 · 示例素材', type: 'MP4 视频', size: '2.4 GB', upload: '示例 · 10 月 28 日', tag: 'MP4', icon: 'video', stage: 'video', location: null },
    audio: { name: '海边环境声.wav', kind: '音频 · 示例素材', type: 'WAV 音频', size: '186 MB', upload: '示例 · 10 月 26 日', tag: 'WAV', icon: 'audio', stage: 'audio', location: null },
    unsupported: { name: '航拍记录.SRT', kind: '其他文件 · 示例素材', type: 'SRT 字幕文件', size: '42 KB', upload: '示例 · 10 月 25 日', tag: 'SRT', icon: 'folder', stage: 'other', location: null }
  };
  const $ = (selector) => document.querySelector(selector);
  const editor = $('#editor');
  let current = 'located';
  let location = null;
  let edited = false;
  let focusBeforeEditor = null;
  let toastTimer;
  const icon = (name) => `<svg aria-hidden="true"><use href="#i-${name}"/></svg>`;
  const coordinate = (value, positive, negative, axis) => `${value === 0 ? axis : value > 0 ? positive : negative} ${Math.abs(value).toFixed(4)}°`;

  function notify(message) {
    const toast = $('#toast');
    toast.textContent = message;
    toast.classList.add('is-visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('is-visible'), 3200);
  }

  function renderLocation() {
    const canEdit = current === 'located' || current === 'unlocated' || current === 'video';
    const present = !!location;
    const chip = $('#location-chip');
    chip.textContent = present ? edited ? '本页已标记' : '示例已定位' : canEdit ? '尚未定位' : '暂无位置';
    chip.classList.toggle('is-missing', !present);
    $('#map-pin').hidden = !present;
    $('.map-art').classList.toggle('is-missing', !present);
    $('#location-name').textContent = present ? location.name || '已标记坐标 · 未填写地点' : canEdit ? '还没有拍摄位置' : '此类型暂不采集位置';
    $('#location-coordinates').textContent = present ? `${edited ? '本页坐标' : '示例坐标'}：${coordinate(location.longitude, '东经', '西经', '经度')}，${coordinate(location.latitude, '北纬', '南纬', '纬度')}` : canEdit ? '可手动填写坐标；无法推断的地区保持未归属' : '音频和其他文件暂不参与足迹统计';
    $('#edit-location').hidden = !canEdit;
    $('#edit-label').textContent = present ? '修改位置' : '手动标记';
    const badge = $('#stage-badge');
    badge.hidden = current === 'audio' || current === 'unsupported';
    badge.classList.toggle('is-missing', !present);
    badge.innerHTML = `${icon('pin')} ${present ? edited ? '本页位置 · 已标记' : '示例位置 · 已标记' : '没有位置记录'}`;
  }

  function showDemo(mode) {
    if (!Object.hasOwn(demos, mode)) return;
    current = mode;
    const demo = demos[mode];
    location = demo.location ? { ...demo.location } : null;
    edited = false;
    $('#file-name').textContent = demo.name;
    $('#file-icon').setAttribute('href', `#i-${demo.icon}`);
    $('#media-kind').textContent = demo.kind;
    $('#file-tag').textContent = demo.tag;
    $('#meta-type').textContent = demo.type;
    $('#meta-size').textContent = demo.size;
    $('#meta-upload').textContent = demo.upload;
    const stage = $('#media-stage');
    stage.className = `media-stage stage-${demo.stage}`;
    stage.dataset.mode = mode;
    $('.stage-image').hidden = demo.stage === 'audio' || demo.stage === 'other';
    $('#stage-placeholder').hidden = demo.stage === 'photo';
    $('#preview-hint').textContent = demo.stage === 'video' ? '视频转码 / HLS 尚未接入；设计稿不会播放视频' : demo.stage === 'audio' ? '原型没有真实音频；正式页面将按需签发播放链接' : demo.stage === 'other' ? '不支持在线预览时，正式页面提供原片下载' : '正式页面将按需请求短时效私有预览链接';
    const placeholder = $('#stage-placeholder');
    if (demo.stage === 'video') placeholder.innerHTML = '<span class="video-play" aria-hidden="true">▶</span><strong>视频封面示意</strong><small>原型不播放视频；正式版待转码与预览流接入</small>';
    if (demo.stage === 'audio') placeholder.innerHTML = '<span class="wave" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i></span><strong>旅途里的声音</strong><small>音频占位画面 · 无真实播放内容</small>';
    if (demo.stage === 'other') placeholder.innerHTML = `${icon('folder')}<strong>此格式暂不支持在线预览</strong><small>返回文件页或在正式版中下载原文件</small>`;
    $('.image-watermark').textContent = demo.stage === 'photo' ? 'VISUAL PLACEHOLDER · 非真实照片' : demo.stage === 'video' ? 'VIDEO PLACEHOLDER · 非真实视频' : 'VISUAL PLACEHOLDER · 非真实素材';
    document.querySelectorAll('[data-demo]').forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.demo === mode)));
    renderLocation();
  }

  function closeEditor() {
    editor.hidden = true;
    document.body.style.overflow = '';
    $('#form-error').textContent = '';
    $('#longitude').removeAttribute('aria-invalid');
    $('#latitude').removeAttribute('aria-invalid');
    focusBeforeEditor?.focus();
  }

  function openEditor() {
    focusBeforeEditor = document.activeElement;
    $('#place-name').value = location?.name?.replace(/^示例 · /, '') ?? '';
    $('#longitude').value = location?.longitude ?? '';
    $('#latitude').value = location?.latitude ?? '';
    $('#form-error').textContent = '';
    editor.hidden = false;
    document.body.style.overflow = 'hidden';
    $('#place-name').focus();
  }

  document.querySelectorAll('[data-demo]').forEach((button) => button.addEventListener('click', () => showDemo(button.dataset.demo)));
  $('#edit-location').addEventListener('click', openEditor);
  $('#close-editor').addEventListener('click', closeEditor);
  $('#cancel-editor').addEventListener('click', closeEditor);
  editor.addEventListener('click', (event) => { if (event.target === editor) closeEditor(); });
  document.addEventListener('keydown', (event) => {
    if (editor.hidden) return;
    if (event.key === 'Escape') { event.preventDefault(); closeEditor(); }
    if (event.key === 'Tab') {
      const controls = [...editor.querySelectorAll('button, input')].filter((element) => !element.disabled);
      if (event.shiftKey && document.activeElement === controls[0]) { event.preventDefault(); controls.at(-1).focus(); }
      else if (!event.shiftKey && document.activeElement === controls.at(-1)) { event.preventDefault(); controls[0].focus(); }
    }
  });
  $('#location-form').addEventListener('submit', (event) => {
    event.preventDefault();
    const longitudeField = $('#longitude');
    const latitudeField = $('#latitude');
    const longitude = Number(longitudeField.value);
    const latitude = Number(latitudeField.value);
    const lonValid = longitudeField.value.trim() !== '' && Number.isFinite(longitude) && longitude >= -180 && longitude <= 180;
    const latValid = latitudeField.value.trim() !== '' && Number.isFinite(latitude) && latitude >= -90 && latitude <= 90;
    longitudeField.setAttribute('aria-invalid', String(!lonValid));
    latitudeField.setAttribute('aria-invalid', String(!latValid));
    if (!lonValid || !latValid) {
      $('#form-error').textContent = '请输入有效坐标：经度 −180～180，纬度 −90～90。';
      (lonValid ? latitudeField : longitudeField).focus();
      return;
    }
    location = { name: $('#place-name').value.trim(), longitude, latitude };
    edited = true;
    renderLocation();
    closeEditor();
    notify('原型演示：已在本页标记，刷新或切换示例后即恢复，未保存到云端');
  });
  $('#download').addEventListener('click', () => notify('设计稿不提供真实下载；正式页面需先申请短时效私有签名链接'));
  const requested = new URLSearchParams(window.location.search).get('demo');
  showDemo(Object.hasOwn(demos, requested) ? requested : 'located');
})();
