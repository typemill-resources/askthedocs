(function () {
  'use strict';

  var history = [];
  var widget, messagesEl, explanationEl, form, input, submitBtn, endpoint;
  var privacyCheckbox, privacyError;

  function esc(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /* Simple cookie helpers */
  function getCookie(name) {
    var match = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)'));
    return match ? decodeURIComponent(match[1]) : null;
  }

  function setCookie(name, value, days) {
    var expires = '';
    if (days) {
      var date = new Date();
      date.setTime(date.getTime() + days * 24 * 60 * 60 * 1000);
      expires = '; expires=' + date.toUTCString();
    }
    document.cookie = name + '=' + encodeURIComponent(value) + expires + '; path=/';
  }

  function deleteCookie(name) {
    document.cookie = name + '=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/';
  }

  /* Lightweight markdown-to-HTML parser */
  function mdToHtml(text) {
    var lines = text.split(/\r\n|\n\r|\n|\r/);
    var html = [];
    var inCode = false;
    var codeLang = '';
    var codeLines = [];
    var inList = false;
    var listType = '';
    var listItems = [];

    function flushList() {
      if (!inList) return;
      html.push('<' + listType + '>' + listItems.join('') + '</' + listType + '>');
      inList = false;
      listType = '';
      listItems = [];
    }

    function flushCode() {
      if (!inCode) return;
      var code = esc(codeLines.join('\n'));
      html.push('<pre><code' + (codeLang ? ' class="language-' + esc(codeLang) + '"' : '') + '>' + code + '</code></pre>');
      inCode = false;
      codeLang = '';
      codeLines = [];
    }

    function inlineMd(str) {
      return str
        .replace(/``([^`]+)``/g, '<code>$1</code>')
        .replace(/`([^`]+)`/g, '<code>$1</code>')
        .replace(/\*\*\*([^*]+)\*\*\*/g, '<em><strong>$1</strong></em>')
        .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
        .replace(/__([^_]+)__/g, '<strong>$1</strong>')
        .replace(/\*([^*]+)\*/g, '<em>$1</em>')
        .replace(/_([^_]+)_/g, '<em>$1</em>')
        .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img alt="$1" src="$2">')
        .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')
        .replace(/\[([^\]]+)\]\[([^\]]*)\]/g, '<a href="$2">$1</a>');
    }

    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];

      if (line.trim().match(/^```/)) {
        if (inCode) {
          flushCode();
        } else {
          flushList();
          inCode = true;
          codeLang = line.trim().replace(/^```/, '').trim();
        }
        continue;
      }

      if (inCode) {
        codeLines.push(line);
        continue;
      }

      if (line.trim() === '') {
        flushList();
        continue;
      }

      var headerMatch = line.match(/^(#{1,6})\s+(.*)$/);
      if (headerMatch) {
        flushList();
        var level = headerMatch[1].length;
        html.push('<h' + level + '>' + inlineMd(esc(headerMatch[2])) + '</h' + level + '>');
        continue;
      }

      var blockquoteMatch = line.match(/^>\s?(.*)$/);
      if (blockquoteMatch) {
        flushList();
        html.push('<blockquote>' + inlineMd(esc(blockquoteMatch[1])) + '</blockquote>');
        continue;
      }

      var ulMatch = line.match(/^(\s*)[-*]\s+(.*)$/);
      if (ulMatch) {
        if (!inList || listType !== 'ul') {
          flushList();
          inList = true;
          listType = 'ul';
        }
        listItems.push('<li>' + inlineMd(esc(ulMatch[2])) + '</li>');
        continue;
      }

      var olMatch = line.match(/^(\s*)\d+\.\s+(.*)$/);
      if (olMatch) {
        if (!inList || listType !== 'ol') {
          flushList();
          inList = true;
          listType = 'ol';
        }
        listItems.push('<li>' + inlineMd(esc(olMatch[2])) + '</li>');
        continue;
      }

      flushList();
      html.push('<p>' + inlineMd(esc(line)) + '</p>');
    }

    flushList();
    flushCode();

    return html.join('\n');
  }

  function hideExplanation() {
    if (explanationEl) {
      explanationEl.style.display = 'none';
    }
  }

  function addBubble(role, text) {
    var div = document.createElement('div');
    div.className = 'atd-bubble ' + role;

    if (role === 'assistant') {
      div.innerHTML = mdToHtml(text);
    } else if (role === 'thinking') {
      div.innerHTML = text;
    } else {
      div.textContent = text;
    }

    messagesEl.appendChild(div);
    messagesEl.scrollTop = messagesEl.scrollHeight;
    hideExplanation();
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

    // Privacy check
    if (privacyCheckbox && !privacyCheckbox.checked) {
      if (privacyError) {
        privacyError.style.display = 'block';
      }
      return;
    }
    if (privacyError) {
      privacyError.style.display = 'none';
    }

    addBubble('user', question);
    history.push({ role: 'user', content: question });
    if (history.length > 6) history = history.slice(-6);

    input.value = '';
    submitBtn.disabled = true;

    var thinking = addBubble('thinking', '<span class="atd-spinner"><span></span><span></span><span></span></span> Thinking…');

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

    document.getElementById('atd-input').addEventListener('input', function () {
      document.getElementById('atd-char-count').textContent = this.value.length + ' / 500';
    });

    endpoint       = widget.dataset.endpoint;
    messagesEl     = document.getElementById('atd-messages');
    explanationEl  = document.getElementById('atd-explanation');
    form           = document.getElementById('atd-form');
    input          = document.getElementById('atd-input');
    submitBtn      = document.getElementById('atd-submit');

    privacyCheckbox = document.getElementById('atd-privacy-checkbox');
    privacyError    = document.getElementById('atd-privacy-error');

    // Restore privacy consent from cookie
    if (privacyCheckbox) {
      if (getCookie('askthedocs_privacy') === '1') {
        privacyCheckbox.checked = true;
      }

      privacyCheckbox.addEventListener('change', function () {
        if (privacyCheckbox.checked) {
          setCookie('askthedocs_privacy', '1', 365);
          if (privacyError) privacyError.style.display = 'none';
        } else {
          deleteCookie('askthedocs_privacy');
        }
      });
    }

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
