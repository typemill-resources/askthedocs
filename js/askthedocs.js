(function () {
  'use strict';

  var history = [];
  var widget, messagesEl, form, input, submitBtn, endpoint;

  function esc(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function addBubble(role, text) {
    var div = document.createElement('div');
    div.className = 'atd-bubble ' + role;
    div.textContent = text;
    messagesEl.appendChild(div);
    messagesEl.scrollTop = messagesEl.scrollHeight;
    return div;
  }

  function addSources(sources) {
    if (!sources || !sources.length) return;
    var div = document.createElement('div');
    div.className = 'atd-sources';
    var links = sources.map(function (s) {
      return '<a href="' + esc(s.url) + '">' + esc(s.title || s.url) + '</a>';
    });
    div.innerHTML = 'Sources: ' + links.join(', ');
    messagesEl.appendChild(div);
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function onSubmit(e) {
    e.preventDefault();

    var question = input.value.trim();
    if (!question) return;

    addBubble('user', question);
    history.push({ role: 'user', content: question });
    if (history.length > 6) history = history.slice(-6);

    input.value = '';
    submitBtn.disabled = true;

    var thinking = addBubble('thinking', 'Thinking…');

    fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question: question, history: history.slice(-6) }),
    })
      .then(function (res) { return res.json(); })
      .then(function (data) {
        if (messagesEl.contains(thinking)) messagesEl.removeChild(thinking);

        if (data.error) {
          addBubble('assistant', 'Error: ' + data.error);
          return;
        }

        var answer = data.answer || 'No answer returned.';
        addBubble('assistant', answer);
        addSources(data.sources);

        history.push({ role: 'assistant', content: answer });
        if (history.length > 6) history = history.slice(-6);
      })
      .catch(function () {
        if (messagesEl.contains(thinking)) messagesEl.removeChild(thinking);
        addBubble('assistant', 'An error occurred. Please try again.');
      })
      .finally(function () {
        submitBtn.disabled = false;
        input.focus();
      });
  }

  document.addEventListener('DOMContentLoaded', function () {
    widget = document.getElementById('atd-widget');
    if (!widget) return;

    endpoint   = widget.dataset.endpoint;
    messagesEl = document.getElementById('atd-messages');
    form       = document.getElementById('atd-form');
    input      = document.getElementById('atd-input');
    submitBtn  = document.getElementById('atd-submit');

    form.addEventListener('submit', onSubmit);

    // Enter submits, Shift+Enter inserts newline
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        form.dispatchEvent(new Event('submit', { cancelable: true }));
      }
    });
  });
}());
