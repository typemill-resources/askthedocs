(function () {
  'use strict';

  var base = '';

  function apiGet(path) {
    return fetch(base + path, { credentials: 'same-origin' })
      .then(function (r) { return r.json(); });
  }

  function apiPost(path, data) {
    return fetch(base + path, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    }).then(function (r) { return r.json(); });
  }

  function setMsg(el, text, ok) {
    el.textContent = text;
    el.className = 'atd-action-msg ' + (ok ? 'ok' : 'err');
    setTimeout(function () { el.textContent = ''; el.className = 'atd-action-msg'; }, 4000);
  }

  function renderTable(summaries) {
    var tbody   = document.getElementById('atd-tbody');
    var loading = document.getElementById('atd-loading');
    var table   = document.getElementById('atd-table');

    tbody.innerHTML = '';

    summaries.forEach(function (item) {
      var tr = document.createElement('tr');

      // URL cell
      var tdUrl = document.createElement('td');
      tdUrl.style.wordBreak = 'break-all';
      tdUrl.textContent = item.url;

      // Title cell
      var tdTitle = document.createElement('td');
      tdTitle.textContent = item.title;

      // Summary cell (editable textarea)
      var tdSummary = document.createElement('td');
      var ta = document.createElement('textarea');
      ta.className = 'atd-summary-ta';
      ta.rows = 2;
      ta.value = item.summary;
      tdSummary.appendChild(ta);

      // Actions cell
      var tdActions = document.createElement('td');
      tdActions.className = 'atd-row-actions';

      var msgEl = document.createElement('span');
      msgEl.className = 'atd-row-msg';

      var saveBtn = document.createElement('button');
      saveBtn.className = 'atd-btn atd-btn-sm';
      saveBtn.textContent = 'Save';
      saveBtn.addEventListener('click', function () {
        saveBtn.disabled = true;
        apiPost('/api/v1/askthedocs/summary', { path: item.url, summary: ta.value.trim() })
          .then(function (data) {
            setMsg(msgEl, data.message || 'Saved.', !data.error);
          })
          .catch(function () { setMsg(msgEl, 'Save failed.', false); })
          .finally(function () { saveBtn.disabled = false; });
      });

      var genBtn = document.createElement('button');
      genBtn.className = 'atd-btn atd-btn-sm atd-btn-secondary';
      genBtn.textContent = 'Generate AI';
      genBtn.addEventListener('click', function () {
        genBtn.disabled = true;
        genBtn.textContent = '…';
        apiPost('/api/v1/askthedocs/generate-summary', { path: item.url })
          .then(function (data) {
            if (data.summary) {
              ta.value = data.summary;
              setMsg(msgEl, 'Generated.', true);
            } else {
              setMsg(msgEl, data.error || 'Failed.', false);
            }
          })
          .catch(function () { setMsg(msgEl, 'Error.', false); })
          .finally(function () {
            genBtn.disabled = false;
            genBtn.textContent = 'Generate AI';
          });
      });

      tdActions.appendChild(saveBtn);
      tdActions.appendChild(genBtn);
      tdActions.appendChild(msgEl);

      tr.appendChild(tdUrl);
      tr.appendChild(tdTitle);
      tr.appendChild(tdSummary);
      tr.appendChild(tdActions);
      tbody.appendChild(tr);
    });

    loading.hidden = true;
    table.hidden   = false;
  }

  function loadStatus() {
    apiGet('/api/v1/askthedocs/status')
      .then(function (data) {
        var builtEl = document.getElementById('atd-built');
        var countEl = document.getElementById('atd-count');
        var loading = document.getElementById('atd-loading');

        builtEl.textContent = data.built
          ? new Date(data.built).toLocaleString()
          : 'Never';
        countEl.textContent = data.pagecount != null ? data.pagecount : 0;

        if (data.summaries && data.summaries.length) {
          renderTable(data.summaries);
        } else {
          loading.hidden = false;
          loading.textContent = 'No pages indexed yet. Click "Rebuild Index" to build the index.';
        }
      })
      .catch(function () {
        var loading = document.getElementById('atd-loading');
        if (loading) loading.textContent = 'Failed to load index status.';
      });
  }

  document.addEventListener('DOMContentLoaded', function () {
    var adminEl = document.getElementById('atd-admin');
    if (!adminEl) return;

    base = adminEl.dataset.base || '';

    var reindexBtn = document.getElementById('atd-reindex-btn');
    var reindexMsg = document.getElementById('atd-reindex-msg');

    reindexBtn.addEventListener('click', function () {
      reindexBtn.disabled    = true;
      reindexBtn.textContent = 'Rebuilding…';
      reindexMsg.textContent = '';

      apiPost('/api/v1/askthedocs/reindex', {})
        .then(function (data) {
          setMsg(reindexMsg, (data.message || 'Done.') + ' (' + (data.pages || 0) + ' pages)', !data.error);
          loadStatus();
        })
        .catch(function () { setMsg(reindexMsg, 'Rebuild failed.', false); })
        .finally(function () {
          reindexBtn.disabled    = false;
          reindexBtn.textContent = 'Rebuild Index';
        });
    });

    loadStatus();
  });
}());
