const app = Vue.createApp({
  template: `
    <section class="dark:bg-stone-700 dark:text-stone-200">
      <div class="flex border-b border-stone-200 mb-5">
        <button
          v-for="tab in tabs"
          :key="tab"
          @click="activeTab = tab"
          :class="{'border-stone-700 bg-stone-200 dark:bg-stone-900 dark:border-stone-200': activeTab === tab}"
          class="px-2 py-2 border-b-2 border-stone-200 dark:border-stone-900 hover:border-stone-700 hover:dark:border-stone-200 hover:bg-stone-200 hover:dark:bg-stone-900 transition duration-100"
        >
          {{ tab.charAt(0).toUpperCase() + tab.slice(1) }}
        </button>
      </div>

      <div class="block w-full h-8 my-1">
        <transition name="fade">
          <div v-if="message" :class="messageClass" class="text-white px-3 py-1 transition duration-100">{{ message }}</div>
        </transition>
      </div>

      <!-- Summaries Tab -->
      <div v-if="activeTab === 'summaries'">
        <p class="mb-4 text-sm text-stone-500">
          These summaries help the AI understand which pages to navigate to.
        </p>
        <div class="mb-4 flex flex-wrap gap-3 items-end">
          <div class="flex-1 p-3 border border-stone-200 dark:border-stone-600 bg-stone-50 dark:bg-stone-800 rounded">
            <strong class="text-sm">Last built</strong><br>
            <span class="text-sm">{{ status.built ? new Date(status.built).toLocaleString() : 'Never' }}</span>
          </div>
          <div class="flex-1 p-3 border border-stone-200 dark:border-stone-600 bg-stone-50 dark:bg-stone-800 rounded">
            <strong class="text-sm">Pages indexed</strong><br>
            <span class="text-sm">{{ status.pagecount != null ? status.pagecount : 0 }}</span>
          </div>
          <div class="flex-1 flex flex-col gap-2">
            <button
              @click="rebuildIndex()"
              :disabled="disabled || generating"
              class="p-3 bg-stone-700 dark:bg-stone-600 hover:bg-stone-900 hover:dark:bg-stone-900 text-white cursor-pointer disabled:cursor-not-allowed disabled:bg-stone-200 disabled:text-stone-900 transition duration-100 rounded"
            >
              {{ disabled ? 'Rebuilding…' : 'Rebuild & Generate' }}
            </button>
            <button
              @click="generateAllMissing()"
              :disabled="generating"
              class="p-2 text-sm bg-teal-600 text-white hover:bg-teal-800 disabled:bg-stone-300 disabled:text-stone-700 transition duration-100 rounded"
            >
              {{ generating ? 'Generating…' : 'Generate All Missing' }}
            </button>
          </div>
        </div>
        <p class="mb-4 text-xs text-stone-500 dark:text-stone-400">
          Rebuild scans for new pages and then generates AI summaries for all missing entries. AI generation sends full page content to your provider and can be expensive.
        </p>
        <div v-if="generating" class="mb-4 p-4 border border-stone-200 dark:border-stone-600 bg-stone-50 dark:bg-stone-800 rounded">
          <div class="flex justify-between items-center mb-2">
            <span class="text-sm font-medium">Generating AI summaries… {{ generateProgress.current }} / {{ generateProgress.total }}</span>
            <button @click="stopGenerating()" class="px-3 py-1 text-xs bg-rose-600 text-white hover:bg-rose-800 rounded">Stop</button>
          </div>
          <div class="w-full bg-stone-200 dark:bg-stone-700 rounded h-2">
            <div class="bg-teal-500 h-2 rounded transition-all duration-300" :style="{ width: (generateProgress.total > 0 ? (generateProgress.current / generateProgress.total * 100) : 0) + '%' }"></div>
          </div>
        </div>
        <div v-if="loading.summaries">Loading summaries…</div>
        <div v-else-if="!summaries.length">No pages indexed yet. Click "Rebuild & Generate" above to scan the site.</div>
        <div v-else class="flex flex-wrap -m-2">
          <div v-for="(item, index) in summaries" :key="item.url" class="w-full md:w-1/2 xl:w-1/3 p-2">
            <div class="border border-stone-200 dark:border-stone-600 bg-stone-50 dark:bg-stone-800 p-4 rounded h-full flex flex-col">
              <h3 class="text-base font-semibold mb-1">{{ item.title }}</h3>
              <p class="text-xs text-stone-500 dark:text-stone-400 mb-3 break-all">{{ item.url }}</p>
              <textarea
                v-model="item.summary"
                rows="4"
                class="w-full p-2 border border-stone-300 dark:border-stone-600 bg-white dark:bg-stone-900 text-stone-900 dark:text-stone-100 text-sm mb-3 flex-grow"
                placeholder="No summary yet..."
              ></textarea>
              <div class="flex flex-wrap gap-2 items-center">
                <button
                  @click="saveSummary(index)"
                  :disabled="item._saving"
                  class="px-3 py-1.5 text-sm bg-stone-700 text-white hover:bg-stone-900 disabled:bg-stone-300 disabled:text-stone-700 rounded"
                >
                  {{ item._saving ? 'Saving…' : 'Save' }}
                </button>
                <button
                  @click="generateSummary(index)"
                  :disabled="item._generating"
                  class="px-3 py-1.5 text-sm bg-teal-500 text-white hover:bg-teal-700 disabled:bg-stone-300 disabled:text-stone-700 rounded ml-1"
                >
                  {{ item._generating ? 'Generating…' : 'Generate AI' }}
                </button>
                <span v-if="item._msg" :class="item._msgOk ? 'text-teal-600' : 'text-rose-600'" class="text-xs">{{ item._msg }}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Questions Tab -->
      <div v-if="activeTab === 'questions'">
        <p class="mb-4 text-sm text-stone-500">
          Questions extracted from session logs. Click "View log" to see the full AI conversation for that question.
        </p>
        <button
          @click="clearQuestions()"
          :disabled="disabled"
          class="mb-4 p-2 text-sm bg-stone-600 text-white hover:bg-stone-800 disabled:bg-stone-300 disabled:text-stone-700"
        >
          Delete All Logs
        </button>
        <div v-if="loading.questions">Loading questions…</div>
        <div v-else-if="!questions.length">No session logs found. Enable "Log Full Sessions" in the plugin settings to start logging.</div>
        <table v-else class="w-full border-collapse text-sm">
          <thead>
            <tr>
              <th class="text-left p-2 bg-stone-100 dark:bg-stone-800 border-b-2 border-stone-200">Date</th>
              <th class="text-left p-2 bg-stone-100 dark:bg-stone-800 border-b-2 border-stone-200">Question</th>
              <th class="text-left p-2 bg-stone-100 dark:bg-stone-800 border-b-2 border-stone-200">Actions</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(item, index) in reversedQuestions" :key="index" class="border-b border-stone-200">
              <td class="p-2 whitespace-nowrap">{{ item.date }}</td>
              <td class="p-2 break-all" style="word-break: break-word;">{{ item.question }}</td>
              <td class="p-2">
                <button
                  v-if="item.logfile"
                  @click="viewLog(item.logfile)"
                  class="p-1 text-xs bg-stone-600 text-white hover:bg-stone-800 rounded"
                >
                  View log
                </button>
                <span v-else class="text-xs text-stone-400">No log</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- Log Viewer Modal -->
      <div v-if="logModal.open" class="fixed inset-0 z-50 flex items-start justify-center pt-10 pb-10 bg-black bg-opacity-70 overflow-y-auto" @click.self="closeLogModal">
        <div class="bg-stone-900 text-white rounded shadow-lg w-full max-w-4xl max-h-[75vh] mx-4 flex flex-col overflow-hidden">
          <div class="flex justify-between items-center p-4 border-b border-stone-600 flex-shrink-0">
            <h3 class="text-lg font-semibold">Session Log: {{ logModal.filename }}</h3>
            <button @click="closeLogModal" class="text-stone-300 hover:text-white text-2xl leading-none">&times;</button>
          </div>
          <div v-if="logModal.loading" class="p-4">Loading…</div>
          <div v-else class="p-4 overflow-y-auto flex-grow" style="min-height: 0;">
            <pre class="text-xs whitespace-pre-wrap font-mono text-stone-100">{{ logModal.content }}</pre>
          </div>
          <div class="p-4 border-t border-stone-600 flex justify-end flex-shrink-0">
            <button @click="closeLogModal" class="px-4 py-2 bg-stone-600 text-white hover:bg-stone-400 rounded">Close</button>
          </div>
        </div>
      </div>
    </section>
  `,
  data: function() {
    return {
      activeTab: 'summaries',
      tabs: ['summaries', 'questions'],
      loading: { status: true, summaries: true, questions: true },
      status: { built: null, pagecount: 0 },
      summaries: [],
      questions: [],
      disabled: false,
      message: '',
      messageClass: '',
      logModal: { open: false, filename: '', content: '', loading: false },
      generating: false,
      generateProgress: { current: 0, total: 0, stopped: false }
    };
  },  
  computed: {
    reversedQuestions: function () {
      return this.questions.slice().reverse();
    }
  },
  mounted: function () {
    this.loadAll();
  },
  methods: {
    setMessage: function (text, ok) {
      this.message = text;
      this.messageClass = ok ? 'bg-teal-500' : 'bg-rose-500';
      setTimeout(() => { this.message = ''; }, 4000);
    },
    loadAll: function () {
      this.loadStatus();
      this.loadSummaries();
      this.loadQuestions();
    },
    loadStatus: function () {
      var self = this;
      tmaxios.get('/api/v1/askthedocs/status')
        .then(function (response) {
          self.status = response.data;
          self.loading.status = false;
        })
        .catch(function () {
          self.loading.status = false;
        });
    },
    loadSummaries: function (callback) {
      var self = this;
      tmaxios.get('/api/v1/askthedocs/status')
        .then(function (response) {
          if (response.data.summaries) {
            self.summaries = response.data.summaries.map(function (s) {
              return { url: s.url, title: s.title, summary: s.summary || '', _saving: false, _generating: false, _msg: '', _msgOk: true };
            });
          }
          self.loading.summaries = false;
          if (typeof callback === 'function') callback();
        })
        .catch(function () {
          self.loading.summaries = false;
          if (typeof callback === 'function') callback();
        });
    },
    loadQuestions: function () {
      var self = this;
      tmaxios.get('/api/v1/askthedocs/questions')
        .then(function (response) {
          self.questions = response.data.questions || [];
          self.loading.questions = false;
        })
        .catch(function () {
          self.loading.questions = false;
        });
    },
    rebuildIndex: function () {
      var self = this;
      this.disabled = true;
      tmaxios.post('/api/v1/askthedocs/reindex', {})
        .then(function (response) {
          self.setMessage((response.data.message || 'Done.') + ' (' + (response.data.pages || 0) + ' pages)', !response.data.error);
          self.loadStatus();
          self.loadSummaries(function () {
            self.disabled = false;
            self.generateAllMissing();
          });
        })
        .catch(function () {
          self.setMessage('Rebuild failed.', false);
          self.disabled = false;
        });
    },
    saveSummary: function (index) {
      var self = this;
      var item = this.summaries[index];
      item._saving = true;
      item._msg = '';
      tmaxios.post('/api/v1/askthedocs/summary', { path: item.url, summary: item.summary.trim() })
        .then(function (response) {
          item._msg = response.data.message || 'Saved.';
          item._msgOk = !response.data.error;
          setTimeout(function () { item._msg = ''; }, 3000);
        })
        .catch(function () {
          item._msg = 'Save failed.';
          item._msgOk = false;
        })
        .finally(function () {
          item._saving = false;
        });
    },
    generateSummary: function (index) {
      var self = this;
      var item = this.summaries[index];
      item._generating = true;
      item._msg = '';
      tmaxios.post('/api/v1/askthedocs/generate-summary', { path: item.url })
        .then(function (response) {
          if (response.data.summary) {
            item.summary = response.data.summary;
            item._msg = 'Generated.';
            item._msgOk = true;
          } else {
            item._msg = response.data.error || 'Failed.';
            item._msgOk = false;
          }
          setTimeout(function () { item._msg = ''; }, 3000);
        })
        .catch(function () {
          item._msg = 'Error.';
          item._msgOk = false;
        })
        .finally(function () {
          item._generating = false;
        });
    },
    generateAllMissing: function () {
      var self = this;
      var targets = this.summaries.filter(function (s) { return !s.summary || s.summary.trim() === ''; });
      if (targets.length === 0) {
        this.setMessage('All summaries are already filled.', true);
        return;
      }
      this.generating = true;
      this.generateProgress = { current: 0, total: targets.length, stopped: false };
      function next() {
        if (self.generateProgress.stopped) {
          self.generating = false;
          self.setMessage('Generation stopped by user.', false);
          return;
        }
        if (self.generateProgress.current >= self.generateProgress.total) {
          self.generating = false;
          self.setMessage('All missing summaries generated.', true);
          return;
        }
        var target = targets[self.generateProgress.current];
        target._generating = true;
        target._msg = '';
        tmaxios.post('/api/v1/askthedocs/generate-summary', { path: target.url })
          .then(function (response) {
            if (response.data.summary) {
              target.summary = response.data.summary;
              target._msg = 'Generated.';
              target._msgOk = true;
            } else {
              target._msg = response.data.error || 'Failed.';
              target._msgOk = false;
            }
            target._generating = false;
            self.generateProgress.current++;
            next();
          })
          .catch(function () {
            target._msg = 'Error.';
            target._msgOk = false;
            target._generating = false;
            self.generateProgress.current++;
            next();
          });
      }
      next();
    },
    stopGenerating: function () {
      this.generateProgress.stopped = true;
    },
    clearQuestions: function () {
      var self = this;
      this.disabled = true;
      tmaxios.post('/api/v1/askthedocs/questions/clear', {})
        .then(function (response) {
          self.setMessage(response.data.message || 'Cleared.', !response.data.error);
          self.loadQuestions();
        })
        .catch(function () {
          self.setMessage('Clear failed.', false);
        })
        .finally(function () {
          self.disabled = false;
        });
    },
    viewLog: function (filename) {
      var self = this;
      this.logModal.open = true;
      this.logModal.filename = filename;
      this.logModal.loading = true;
      this.logModal.content = '';
      tmaxios.post('/api/v1/askthedocs/log', { filename: filename })
        .then(function (response) {
          self.logModal.content = response.data.content || '';
          self.logModal.loading = false;
        })
        .catch(function () {
          self.logModal.content = 'Failed to load log.';
          self.logModal.loading = false;
        });
    },
    closeLogModal: function () {
      this.logModal.open = false;
      this.logModal.filename = '';
      this.logModal.content = '';
    }
  }
});
