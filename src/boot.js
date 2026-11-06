// Runs in <head> before first paint: apply the saved theme and show the welcome box to first-time visitors,
// so nothing flashes or jumps when the main script arrives.
(function () {
  var d = document.documentElement;
  try {
    var t = JSON.parse(localStorage.getItem('sl.theme') || '"system"');
    if (t === 'light' || t === 'dark') d.setAttribute('data-theme', t);
    if (!localStorage.getItem('sl.welcomed') && !localStorage.getItem('sl.data')) d.classList.add('first-visit');
  } catch (e) {
    d.classList.add('first-visit');
  }
})();
