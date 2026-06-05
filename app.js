'use strict';

// ── Storage ──────────────────────────────────────────────
const STORAGE_KEY = 'insight_notes';

function loadNotes() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || []; }
  catch { return []; }
}

function saveNotes(notes) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(notes));
}

// ── Keyword extraction ────────────────────────────────────
const STOP_WORDS = new Set([
  'した','して','する','される','された','しても','ある','あった','ない','ないと',
  'いる','いた','いて','おく','おいた','なる','なった','なって','なり',
  'こと','もの','ため','から','まで','より','など','について','において',
  'という','として','によって','ような','ように','ので','ので','ただ',
  'でも','しかし','そして','また','さらに','しかも','つまり','そのため',
  'この','その','あの','どの','ここ','そこ','あそこ','これ','それ','あれ',
  'わたし','自分','自分が','自分の','私','僕','自身',
  'やっぱり','やはり','少し','とても','すごく','かなり','もっと','ちょっと',
  'もう','まだ','すでに','今日','今','昨日','明日','今後','場合','時',
]);

// Named-entity seeds for auto-extraction
const PERSON_HINTS = ['社長','部長','係長','さん','くん','ちゃん','先生','上司','部下','同僚'];

function extractKeywords(text) {
  // Split on punctuation and particles
  const tokens = text
    .replace(/[、。！？\n\r,.!?]/g, ' ')
    .split(/\s+/)
    .map(t => t.trim())
    .filter(t => t.length >= 2);

  const counts = {};
  const seen = new Set();

  for (const token of tokens) {
    // Skip pure hiragana short tokens and stop words
    if (/^[ぁ-ゖ]{1,2}$/.test(token)) continue;
    if (STOP_WORDS.has(token)) continue;

    const norm = token.replace(/[はがをにでもとや]$/, '');
    if (norm.length < 2) continue;
    if (seen.has(norm)) { counts[norm] = (counts[norm] || 1) + 1; continue; }
    seen.add(norm);
    counts[norm] = 1;
  }

  // Check for person references (keep compound like "吉川社長")
  for (const hint of PERSON_HINTS) {
    const re = new RegExp(`[\\u4e00-\\u9fff\\u30a0-\\u30ff]{1,4}${hint}`, 'g');
    const matches = text.match(re) || [];
    for (const m of matches) {
      counts[m] = (counts[m] || 0) + 2;
    }
  }

  // Sort by frequency, take top 6
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([kw]) => kw);
}

function guessDomain(text) {
  const t = text;
  if (/上司|社長|部下|会議|仕事|業務|プロジェクト|報告|指示|評価|給与|経理|総務/.test(t)) return '仕事';
  if (/人間関係|信頼|関係|コミュニケーション|対話|誰|友人|家族|息子|マートン|吉川|大前|中山/.test(t)) return '人間関係';
  if (/感情|気持ち|焦り|不安|自分|モヤ|ストレス|体調|睡眠|習慣|癖|パターン/.test(t)) return '自分';
  if (/気づき|学び|本|読|発見|知った|理解|なるほど|ポイント|教訓/.test(t)) return '学び';
  return '';
}

function guessTone(text) {
  if (/よかった|うまく|成功|感謝|嬉しい|達成|できた/.test(text)) return '✅';
  if (/反省|失敗|後悔|やり直|ミス|間違|もっと/.test(text)) return '🔄';
  if (/モヤ|違和感|なんか|むかっ|イライラ|嫌|困った/.test(text)) return '😤';
  if (/気づ|発見|なるほど|大事|重要|ポイント|学び/.test(text)) return '💡';
  return '';
}

// ── Date util ────────────────────────────────────────────
function formatDate(iso) {
  const d = new Date(iso);
  return `${d.getFullYear()}/${String(d.getMonth()+1).padStart(2,'0')}/${String(d.getDate()).padStart(2,'0')}`;
}

function weekLabel(iso) {
  const d = new Date(iso);
  const start = new Date(d);
  start.setDate(d.getDate() - d.getDay());
  return `${start.getFullYear()}/${String(start.getMonth()+1).padStart(2,'0')}/${String(start.getDate()).padStart(2,'0')} 週`;
}

// ── Note to Markdown ─────────────────────────────────────
function noteToMarkdown(note) {
  return [
    '---',
    `date: ${note.date.slice(0,10)}`,
    `domain: ${note.domain || ''}`,
    `tone: ${note.tone || ''}`,
    `keywords: [${note.keywords.join(', ')}]`,
    '---',
    '',
    note.body,
  ].join('\n');
}

// ── State ────────────────────────────────────────────────
let notes = loadNotes();
let selectedDomain = '';
let selectedTone = '';
let activeKeywords = [];

// ── DOM refs ─────────────────────────────────────────────
const inputText      = document.getElementById('input-text');
const btnVoice       = document.getElementById('btn-voice');
const voiceStatus    = document.getElementById('voice-status');
const domainGroup    = document.getElementById('domain-group');
const toneGroup      = document.getElementById('tone-group');
const keywordChips   = document.getElementById('keyword-chips');
const btnSave        = document.getElementById('btn-save');
const relatedSection = document.getElementById('related-section');
const relatedList    = document.getElementById('related-list');
const notesList      = document.getElementById('notes-list');
const filterDomain   = document.getElementById('filter-domain');
const filterTone     = document.getElementById('filter-tone');
const modalOverlay   = document.getElementById('modal-overlay');
const modalContent   = document.getElementById('modal-content');
const modalClose     = document.getElementById('modal-close');
const searchPanel    = document.getElementById('search-panel');
const searchInput    = document.getElementById('search-input');
const searchResults  = document.getElementById('search-results');
const btnSummary     = document.getElementById('btn-summary');
const btnExport      = document.getElementById('btn-export');
const btnSearch      = document.getElementById('btn-search');
const searchClose    = document.getElementById('search-close');

// ── Voice input ───────────────────────────────────────────
let recognition = null;
let isRecording = false;

if ('SpeechRecognition' in window || 'webkitSpeechRecognition' in window) {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  recognition = new SR();
  recognition.lang = 'ja-JP';
  recognition.continuous = false;
  recognition.interimResults = true;

  recognition.onstart = () => {
    isRecording = true;
    btnVoice.classList.add('recording');
    voiceStatus.textContent = '話しています…';
  };

  recognition.onresult = (e) => {
    const transcript = Array.from(e.results).map(r => r[0].transcript).join('');
    inputText.value = transcript;
    if (e.results[e.results.length - 1].isFinal) {
      analyzeText(transcript);
    }
  };

  recognition.onerror = (e) => {
    voiceStatus.textContent = `エラー: ${e.error}`;
    stopRecording();
  };

  recognition.onend = () => stopRecording();
} else {
  btnVoice.disabled = true;
  voiceStatus.textContent = '音声入力は非対応のブラウザです';
}

function stopRecording() {
  isRecording = false;
  btnVoice.classList.remove('recording');
  voiceStatus.textContent = 'タップして話す';
}

btnVoice.addEventListener('click', () => {
  if (!recognition) return;
  if (isRecording) { recognition.stop(); return; }
  recognition.start();
});

// ── Text analysis ─────────────────────────────────────────
function analyzeText(text) {
  if (!text.trim()) return;

  // Auto-guess domain & tone if not set
  if (!selectedDomain) {
    const d = guessDomain(text);
    if (d) setDomain(d);
  }
  if (!selectedTone) {
    const t = guessTone(text);
    if (t) setTone(t);
  }

  // Extract keywords
  const kws = extractKeywords(text);
  activeKeywords = [...kws];
  renderKeywordChips();
}

inputText.addEventListener('input', () => analyzeText(inputText.value));

// ── Tag selection ─────────────────────────────────────────
function setDomain(val) {
  selectedDomain = val;
  domainGroup.querySelectorAll('.tag-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.value === val);
  });
}

function setTone(val) {
  selectedTone = val;
  toneGroup.querySelectorAll('.tag-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.value === val);
  });
}

domainGroup.addEventListener('click', e => {
  const btn = e.target.closest('.tag-btn');
  if (!btn) return;
  const val = btn.dataset.value;
  selectedDomain = selectedDomain === val ? '' : val;
  setDomain(selectedDomain);
});

toneGroup.addEventListener('click', e => {
  const btn = e.target.closest('.tag-btn');
  if (!btn) return;
  const val = btn.dataset.value;
  selectedTone = selectedTone === val ? '' : val;
  setTone(selectedTone);
});

// ── Keyword chips ─────────────────────────────────────────
function renderKeywordChips() {
  keywordChips.innerHTML = '';
  activeKeywords.forEach((kw, i) => {
    const chip = document.createElement('span');
    chip.className = 'kw-chip';
    chip.innerHTML = `${kw} <span class="kw-x">✕</span>`;
    chip.addEventListener('click', () => {
      activeKeywords.splice(i, 1);
      renderKeywordChips();
    });
    keywordChips.appendChild(chip);
  });
}

// ── Save ──────────────────────────────────────────────────
btnSave.addEventListener('click', () => {
  const body = inputText.value.trim();
  if (!body) { alert('内容を入力してください'); return; }

  const note = {
    id: Date.now().toString(),
    date: new Date().toISOString(),
    body,
    domain: selectedDomain,
    tone: selectedTone,
    keywords: [...activeKeywords],
  };

  notes.unshift(note);
  saveNotes(notes);

  // Show related
  showRelated(note);

  // Reset form
  inputText.value = '';
  selectedDomain = '';
  selectedTone = '';
  activeKeywords = [];
  domainGroup.querySelectorAll('.tag-btn').forEach(b => b.classList.remove('active'));
  toneGroup.querySelectorAll('.tag-btn').forEach(b => b.classList.remove('active'));
  keywordChips.innerHTML = '';

  renderNotes();
  inputText.scrollIntoView({ behavior: 'smooth', block: 'start' });
});

// ── Related notes ─────────────────────────────────────────
function findRelated(note) {
  return notes
    .filter(n => n.id !== note.id)
    .map(n => {
      const shared = note.keywords.filter(k => n.keywords.includes(k));
      const domainMatch = n.domain && n.domain === note.domain ? 1 : 0;
      return { note: n, score: shared.length * 2 + domainMatch, shared };
    })
    .filter(r => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);
}

function showRelated(note) {
  const related = findRelated(note);
  if (related.length === 0) { relatedSection.classList.add('hidden'); return; }

  relatedSection.classList.remove('hidden');
  relatedList.innerHTML = '';
  related.forEach(({ note: n, shared }) => {
    const card = createNoteCard(n, shared);
    relatedList.appendChild(card);
  });
}

// ── Note card ─────────────────────────────────────────────
function createNoteCard(note, highlight = []) {
  const card = document.createElement('div');
  card.className = 'note-card';

  const kwHtml = note.keywords.map(k => {
    const hl = highlight.includes(k) ? 'style="border-color:var(--accent);color:var(--text)"' : '';
    return `<span class="note-kw" ${hl}>${k}</span>`;
  }).join('');

  card.innerHTML = `
    <div class="note-card-header">
      ${note.domain ? `<span class="note-domain">${note.domain}</span>` : ''}
      ${note.tone ? `<span class="note-tone">${note.tone}</span>` : ''}
      <span class="note-date">${formatDate(note.date)}</span>
    </div>
    <div class="note-body">${escHtml(note.body)}</div>
    ${note.keywords.length ? `<div class="note-keywords">${kwHtml}</div>` : ''}
  `;

  card.addEventListener('click', () => showNoteModal(note));
  return card;
}

function escHtml(s) {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// ── Notes list ────────────────────────────────────────────
function renderNotes() {
  const fd = filterDomain.value;
  const ft = filterTone.value;

  const filtered = notes.filter(n => {
    if (fd && n.domain !== fd) return false;
    if (ft && n.tone !== ft) return false;
    return true;
  });

  notesList.innerHTML = '';
  if (filtered.length === 0) {
    notesList.innerHTML = '<div class="empty-state">メモがまだありません</div>';
    return;
  }
  filtered.forEach(n => notesList.appendChild(createNoteCard(n)));
}

filterDomain.addEventListener('change', renderNotes);
filterTone.addEventListener('change', renderNotes);

// ── Modal ─────────────────────────────────────────────────
function showNoteModal(note) {
  const kwHtml = note.keywords.map(k => `<span class="note-kw">${k}</span>`).join(' ');
  modalContent.innerHTML = `
    <div class="modal-meta">${formatDate(note.date)}　${note.domain || ''}　${note.tone || ''}</div>
    <div class="modal-body">${escHtml(note.body)}</div>
    ${note.keywords.length ? `<div class="note-keywords" style="margin-bottom:12px">${kwHtml}</div>` : ''}
    <button class="tag-btn" id="modal-delete" style="color:var(--accent);border-color:var(--accent)">このメモを削除</button>
  `;
  modalOverlay.classList.remove('hidden');

  document.getElementById('modal-delete').addEventListener('click', () => {
    if (!confirm('このメモを削除しますか？')) return;
    notes = notes.filter(n => n.id !== note.id);
    saveNotes(notes);
    renderNotes();
    closeModal();
  });
}

function closeModal() { modalOverlay.classList.add('hidden'); }
modalClose.addEventListener('click', closeModal);
modalOverlay.addEventListener('click', e => { if (e.target === modalOverlay) closeModal(); });

// ── Search ────────────────────────────────────────────────
btnSearch.addEventListener('click', () => {
  searchPanel.classList.remove('hidden');
  searchInput.focus();
});

searchClose.addEventListener('click', () => searchPanel.classList.add('hidden'));

searchInput.addEventListener('input', () => {
  const q = searchInput.value.trim();
  searchResults.innerHTML = '';
  if (!q) return;

  const results = notes.filter(n =>
    n.body.includes(q) ||
    n.keywords.some(k => k.includes(q)) ||
    (n.domain && n.domain.includes(q))
  );

  if (results.length === 0) {
    searchResults.innerHTML = '<div class="empty-state">見つかりませんでした</div>';
    return;
  }
  results.forEach(n => {
    const card = createNoteCard(n);
    searchResults.appendChild(card);
  });
});

// ── Weekly Summary ────────────────────────────────────────
btnSummary.addEventListener('click', () => {
  const weeks = {};
  notes.forEach(n => {
    const wk = weekLabel(n.date);
    if (!weeks[wk]) weeks[wk] = { keywords: {}, tones: {}, count: 0 };
    weeks[wk].count++;
    n.keywords.forEach(k => { weeks[wk].keywords[k] = (weeks[wk].keywords[k] || 0) + 1; });
    if (n.tone) weeks[wk].tones[n.tone] = (weeks[wk].tones[n.tone] || 0) + 1;
  });

  const weekKeys = Object.keys(weeks).sort().reverse().slice(0, 8);

  if (weekKeys.length === 0) {
    showModal('<div class="empty-state">メモがまだありません</div>');
    return;
  }

  let html = '<div class="modal-title">📊 週次サマリー</div>';
  for (const wk of weekKeys) {
    const w = weeks[wk];
    const topKws = Object.entries(w.keywords).sort((a,b)=>b[1]-a[1]).slice(0,5);
    const maxCount = topKws[0]?.[1] || 1;
    const toneStr = Object.entries(w.tones).map(([t,c])=>`${t}×${c}`).join('　');

    html += `<div class="summary-week">
      <h3>${wk}（${w.count}件）　${toneStr}</h3>`;

    topKws.forEach(([kw, cnt]) => {
      const pct = Math.round(cnt / maxCount * 100);
      html += `<div class="summary-kw-bar">
        <span class="summary-kw-name">${kw}</span>
        <div class="summary-bar-wrap"><div class="summary-bar" style="width:${pct}%"></div></div>
        <span class="summary-count">${cnt}回</span>
      </div>`;
    });

    html += '</div>';
  }

  showModal(html);
});

function showModal(html) {
  modalContent.innerHTML = html;
  modalOverlay.classList.remove('hidden');
}

// ── Export ────────────────────────────────────────────────
btnExport.addEventListener('click', () => {
  const menu = `
    <div class="modal-title">📤 エクスポート</div>
    <p style="font-size:14px;color:var(--text-muted);margin-bottom:16px">形式を選んでください</p>
    <button class="save-btn" id="exp-json" style="margin-bottom:10px">JSON（バックアップ用）</button>
    <button class="save-btn" id="exp-md">Markdown ZIP（Obsidian用）</button>
  `;
  showModal(menu);

  document.getElementById('exp-json').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(notes, null, 2)], { type: 'application/json' });
    downloadBlob(blob, `insight_backup_${dateStr()}.json`);
  });

  document.getElementById('exp-md').addEventListener('click', exportMarkdownZip);
});

async function exportMarkdownZip() {
  // Build a simple tar-like text bundle since we can't use JSZip without CDN
  // Instead, export all as a single concatenated MD file
  const lines = notes.map(n => noteToMarkdown(n)).join('\n\n---\n\n');
  const blob = new Blob([lines], { type: 'text/markdown;charset=utf-8' });
  downloadBlob(blob, `insight_notes_${dateStr()}.md`);
  closeModal();
  alert('エクスポートしました。ObsidianのVaultフォルダに配置してください。');
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function dateStr() {
  return new Date().toISOString().slice(0,10).replace(/-/g,'');
}

// ── Init ──────────────────────────────────────────────────
renderNotes();
