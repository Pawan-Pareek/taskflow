// Apply a saved light/dark choice before first paint (otherwise the device setting is used)
try {
    var t = localStorage.getItem('taskflow_theme_choice');
    if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t);
} catch (e) {}
