// 仅用于设计稿预览：切换页面/状态、密码显隐。不是产品代码。
(() => {
  const stage = document.querySelector('.stage');
  const params = new URLSearchParams(location.search);
  if (params.has('clean')) document.body.classList.add('clean');

  const demo = {
    login: {
      default: { email: '', pwd: '' },
      'field-error': { email: 'name@', pwd: '' },
      invalid: { email: 'lina@example.com', pwd: 'wrong-pass' },
      locked: { email: 'lina@example.com', pwd: 'wrong-pass' },
      disabled: { email: 'lina@example.com', pwd: 'password123' },
      network: { email: 'lina@example.com', pwd: 'password123' },
      loading: { email: 'lina@example.com', pwd: 'password123' },
    },
    register: {
      default: { nick: '', email: '', pwd: '' },
      'field-error': { nick: '', email: 'name@', pwd: 'abc123' },
      'email-taken': { nick: 'Lina', email: 'lina@example.com', pwd: 'password123' },
      network: { nick: 'Lina', email: 'lina@example.com', pwd: 'password123' },
      loading: { nick: 'Lina', email: 'lina@example.com', pwd: 'password123' },
    },
  };

  function render() {
    const { view, state } = stage.dataset;
    const values = demo[view]?.[state] ?? demo[view]?.default ?? {};
    document.querySelectorAll(`.view-${view} [data-field]`).forEach((el) => {
      el.value = values[el.dataset.field] ?? '';
      if (el.dataset.field === 'pwd') el.type = 'password';
    });
    document.querySelectorAll('.eye').forEach((b) => b.classList.remove('is-on'));
    document.querySelectorAll('[data-set-view]').forEach((b) => b.classList.toggle('on', b.dataset.setView === view));
    document.querySelectorAll('[data-set-state]').forEach((b) => {
      b.hidden = !b.dataset.for.split(' ').includes(view);
      b.classList.toggle('on', b.dataset.setState === state);
    });
  }

  function go(view, state = 'default') {
    stage.dataset.view = view;
    stage.dataset.state = state;
    render();
  }

  document.addEventListener('click', (e) => {
    const v = e.target.closest('[data-set-view]');
    if (v) return go(v.dataset.setView);
    const s = e.target.closest('[data-set-state]');
    if (s) return go(stage.dataset.view, s.dataset.setState);
    const g = e.target.closest('[data-goto]');
    if (g) {
      e.preventDefault();
      return go(g.dataset.goto);
    }
    const eye = e.target.closest('.eye');
    if (eye) {
      const input = eye.parentElement.querySelector('input');
      const show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      eye.classList.toggle('is-on', show);
      eye.setAttribute('aria-label', show ? '隐藏密码' : '显示密码');
    }
  });

  document.querySelectorAll('form').forEach((f) => f.addEventListener('submit', (e) => e.preventDefault()));

  go(params.get('view') || 'login', params.get('state') || 'default');
})();
