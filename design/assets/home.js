(() => {
  const dateLabel = document.querySelector('#today-label');
  if (dateLabel) {
    dateLabel.textContent = new Intl.DateTimeFormat('en-US', {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
    }).format(new Date()).toUpperCase();
  }

  const modeButtons = document.querySelectorAll('[data-mode]');
  modeButtons.forEach((button) => {
    button.addEventListener('click', () => {
      const empty = button.dataset.mode === 'empty';
      document.body.classList.toggle('preview-empty', empty);
      modeButtons.forEach((item) => item.classList.toggle('is-active', item === button));
    });
  });
})();
