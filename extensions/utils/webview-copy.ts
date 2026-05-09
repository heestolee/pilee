export function webviewCopyCss(): string {
	return `*{-webkit-user-select:text;user-select:text}button,.button,.tab,summary{-webkit-user-select:none;user-select:none}input,textarea,select{-webkit-user-select:text;user-select:text}`;
}

export function webviewCopyScript(): string {
	return String.raw`(function(){
  function selectedText(){
    var active = document.activeElement;
    if (active && (active.tagName === 'TEXTAREA' || active.tagName === 'INPUT')) {
      var start = typeof active.selectionStart === 'number' ? active.selectionStart : 0;
      var end = typeof active.selectionEnd === 'number' ? active.selectionEnd : 0;
      if (end > start && typeof active.value === 'string') return active.value.slice(start, end);
    }
    var selection = window.getSelection && window.getSelection();
    return selection ? String(selection.toString() || '') : '';
  }
  function fallbackCopy(text){
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.left = '-9999px';
    ta.style.top = '0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); } finally { document.body.removeChild(ta); }
  }
  async function copySelected(event){
    var text = selectedText();
    if (!text || !text.trim()) return false;
    if (event && event.clipboardData) {
      event.clipboardData.setData('text/plain', text);
      event.preventDefault();
      return true;
    }
    if (event) event.preventDefault();
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) await navigator.clipboard.writeText(text);
      else fallbackCopy(text);
    } catch (_) { fallbackCopy(text); }
    return true;
  }
  document.addEventListener('copy', function(event){ void copySelected(event); }, true);
  document.addEventListener('keydown', function(event){
    if (!(event.metaKey || event.ctrlKey) || String(event.key || '').toLowerCase() !== 'c') return;
    void copySelected(event);
  }, true);
})();`;
}
