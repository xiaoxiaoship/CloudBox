(() => {
  try {
    const stored = localStorage.getItem('cloudbox-theme');
    const preference = stored === 'light' || stored === 'dark' ? stored : 'system';
    const dark =
      preference === 'dark' ||
      (preference === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);

    const root = document.documentElement;
    root.classList.toggle('dark', dark);
    root.style.colorScheme = dark ? 'dark' : 'light';

    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', dark ? '#020617' : '#f8fafc');
  } catch {
    // localStorage 不可用时保持默认浅色
  }
})();
