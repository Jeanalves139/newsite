const $ = (selector) => document.querySelector(selector);
const editor = $('#editor');
const titleInput = $('#project-title');
const projectList = $('#project-list');
const toast = $('#toast');
const storageKey = 'ebook-studio-projects-v1';
const layoutKey = 'ebook-studio-layout-v1';
const defaultContent = '<h1>Uma nova obra</h1><p>Comece a escrever aqui. Seu texto será salvo automaticamente neste navegador.</p>';
let projects = loadProjects();
let activeId = projects[0]?.id ?? null;
let previousContent = '';
let toastTimer;
let pageFormat = 'a4';
let layoutOptions = loadLayoutOptions();

function loadProjects() {
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey) || '[]');
    return Array.isArray(saved) ? saved : [];
  } catch {
    return [];
  }
}

function loadLayoutOptions() {
  const defaults = { cover: true, toc: true, chapterBreaks: true };
  try {
    return { ...defaults, ...JSON.parse(localStorage.getItem(layoutKey) || '{}') };
  } catch {
    return defaults;
  }
}

function saveProjects() {
  try {
    localStorage.setItem(storageKey, JSON.stringify(projects));
  } catch {
    showToast('Não foi possível salvar neste navegador.');
  }
}

function activeProject() {
  return projects.find((project) => project.id === activeId);
}

function showToast(message) {
  if (!toast) return;
  toast.textContent = message;
  toast.classList.add('is-visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('is-visible'), 3000);
}

async function checkAiStatus() {
  const statusButton = $('#ai-status');
  const statusText = $('#ai-status-text');
  if (!statusButton || !statusText) return;

  statusButton.dataset.state = 'checking';
  statusText.textContent = 'Verificando backend…';
  try {
    const endpoint = window.EbookStudioConfig?.aiStatusUrl || '/check-ia-status';
    const response = await fetch(endpoint, { headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error('Status indisponível');
    const result = await response.json();
    const configured = result.configured === true || result.isConfigured === true || result.aiConfigured === true;
    statusButton.dataset.state = configured ? 'ready' : 'unconfigured';
    statusText.textContent = configured ? 'IA configurada' : 'IA não configurada';
  } catch {
    statusButton.dataset.state = 'offline';
    statusText.textContent = 'Backend indisponível';
  }
}

checkAiStatus();
  

function renderLibrary() {
  if (!projectList) return;
  projectList.replaceChildren();
  projects.forEach((project) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `project-item${project.id === activeId ? ' is-active' : ''}`;
    button.textContent = project.title || 'Sem título';
    button.title = project.title || 'Sem título';
    button.addEventListener('click', () => openProject(project.id));
    projectList.append(button);
  });
  const count = $('#project-count');
  if (count) count.textContent = String(projects.length);
}

function openProject(id) {
  const project = projects.find((item) => item.id === id);
  if (!project) return;
  activeId = id;
  titleInput.value = project.title;
  editor.innerHTML = project.content || '';
  previousContent = editor.innerHTML;
  renderLibrary();
  updateDocument();
}

function updateDocument() {
  const project = activeProject();
  if (!project) return;
  project.title = titleInput.value.trim() || 'Sem título';
  project.content = editor.innerHTML;
  const words = (editor.innerText || '').trim().match(/\S+/g) || [];
  const wordCount = $('#word-count');
  if (wordCount) wordCount.textContent = `${words.length} ${words.length === 1 ? 'palavra' : 'palavras'}`;
  const meta = $('#project-meta');
  if (meta) meta.textContent = `${words.length} palavras · salvo neste navegador`;
  saveProjects();
  renderLibrary();
  renderPreview();
}

function renderPreview() {
  const container = $('#preview-scroll');
  if (!container || !editor) return;
  container.replaceChildren();

  const projectTitle = titleInput.value.trim() || 'Sem título';
  const sourceHeadings = [...editor.querySelectorAll('h1, h2, h3')];
  const headingInfo = new Map();
  const usedIds = new Set();
  sourceHeadings.forEach((heading, index) => {
    const base = heading.textContent.trim().toLocaleLowerCase('pt-BR')
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || `secao-${index + 1}`;
    let id = base;
    let suffix = 2;
    while (usedIds.has(id)) id = `${base}-${suffix++}`;
    usedIds.add(id);
    headingInfo.set(heading, { id, title: heading.textContent.trim() || `Seção ${index + 1}` });
  });

  const tocHeadings = sourceHeadings.filter((heading) => {
    const info = headingInfo.get(heading);
    return !(heading.tagName === 'H1' && info.title.toLocaleLowerCase('pt-BR') === projectTitle.toLocaleLowerCase('pt-BR'));
  });
  const pages = [];
  const pageByHeading = new Map();

  if (layoutOptions.cover) {
    const cover = makePage('cover');
    const title = document.createElement('h1');
    title.textContent = projectTitle;
    const caption = document.createElement('p');
    caption.className = 'cover-caption';
    caption.textContent = 'Edição digital';
    cover.append(title, caption);
  }

  let tocRefs = [];
  if (layoutOptions.toc && tocHeadings.length) {
    const tocPage = makePage('toc');
    const heading = document.createElement('h1');
    heading.textContent = 'Sumário';
    const list = document.createElement('ol');
    list.className = 'table-of-contents';
    tocHeadings.forEach((sourceHeading) => {
      const info = headingInfo.get(sourceHeading);
      const item = document.createElement('li');
      item.className = `toc-level-${sourceHeading.tagName.toLowerCase()}`;
      const link = document.createElement('a');
      link.href = `#${info.id}`;
      link.textContent = info.title;
      const pageNumber = document.createElement('span');
      pageNumber.className = 'toc-page-number';
      pageNumber.textContent = '…';
      item.append(link, pageNumber);
      list.append(item);
      tocRefs.push({ sourceHeading, pageNumber });
    });
    tocPage.append(heading, list);
  }

  const nodes = [...editor.childNodes].filter((node) => node.nodeType !== Node.TEXT_NODE || node.textContent.trim());
  const pageLimit = pageFormat === 'a5' ? 850 : 1450;
  let page = makePage('body');
  let pageLength = 0;
  nodes.forEach((node) => {
    const isChapter = node.nodeType === Node.ELEMENT_NODE && (node.matches('h1') || node.querySelector('h1'));
    if (layoutOptions.chapterBreaks && isChapter && page.childNodes.length) {
      page = makePage('body');
      pageLength = 0;
    }
    const length = (node.textContent || '').length;
    if (page.childNodes.length && pageLength + length > pageLimit) {
      page = makePage('body');
      pageLength = 0;
    }
    const clone = node.cloneNode(true);
    const originalHeadings = getHeadings(node);
    const clonedHeadings = getHeadings(clone);
    originalHeadings.forEach((sourceHeading, index) => {
      const info = headingInfo.get(sourceHeading);
      if (!info || !clonedHeadings[index]) return;
      clonedHeadings[index].id = info.id;
      pageByHeading.set(sourceHeading, pages.length);
    });
    page.append(clone);
    pageLength += length;
  });
  if (!page.childNodes.length && pages.length === 0) page.innerHTML = '<p>O conteúdo da obra aparecerá aqui.</p>';

  tocRefs.forEach(({ sourceHeading, pageNumber }) => {
    const pageIndex = pageByHeading.get(sourceHeading);
    pageNumber.textContent = pageIndex === undefined ? '—' : String(pageIndex + 1);
  });

  const count = $('#page-count');
  if (count) count.textContent = `· ${pages.length} ${pages.length === 1 ? 'página' : 'páginas'}`;

  function makePage(type) {
    const element = document.createElement('article');
    element.className = `preview-page${pageFormat === 'a5' ? ' preview-page--a5' : ''}${type === 'cover' ? ' preview-page--cover' : ''}${type === 'toc' ? ' preview-page--toc' : ''}`;
    pages.push(element);
    container.append(element);
    return element;
  }

  function getHeadings(node) {
    const result = [];
    if (node.nodeType === Node.ELEMENT_NODE && node.matches('h1, h2, h3')) result.push(node);
    if (node.querySelectorAll) result.push(...node.querySelectorAll('h1, h2, h3'));
    return result;
  }
}

function createProject(title = 'Obra sem título', content = defaultContent) {
  const project = { id: `${Date.now()}-${Math.random().toString(16).slice(2)}`, title, content, updatedAt: Date.now() };
  projects.unshift(project);
  activeId = project.id;
  saveProjects();
  openProject(project.id);
}

$('#new-project')?.addEventListener('click', () => createProject());
titleInput?.addEventListener('input', updateDocument);
editor?.addEventListener('input', () => {
  if (editor.innerHTML !== previousContent) previousContent = editor.innerHTML;
  updateDocument();
});

$('#undo-btn')?.addEventListener('click', () => {
  if (!editor || !previousContent) return showToast('Nada para desfazer.');
  document.execCommand('undo');
  updateDocument();
});
document.addEventListener('keydown', (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') {
    event.preventDefault();
    document.execCommand('undo');
    updateDocument();
  }
});

document.querySelectorAll('[data-view-target]').forEach((button) => {
  button.addEventListener('click', () => {
    document.body.dataset.view = button.dataset.viewTarget;
    document.querySelectorAll('[data-view-target]').forEach((item) => item.classList.toggle('is-active', item === button));
  });
});
document.querySelectorAll('[data-page-format]').forEach((button) => {
  button.addEventListener('click', () => {
    pageFormat = button.dataset.pageFormat;
    document.querySelectorAll('[data-page-format]').forEach((item) => item.setAttribute('aria-pressed', String(item === button)));
    renderPreview();
  });
});
document.querySelectorAll('[data-layout-option]').forEach((button) => {
  const option = button.dataset.layoutOption;
  button.setAttribute('aria-pressed', String(Boolean(layoutOptions[option])));
  button.addEventListener('click', () => {
    layoutOptions[option] = !layoutOptions[option];
    button.setAttribute('aria-pressed', String(layoutOptions[option]));
    try {
      localStorage.setItem(layoutKey, JSON.stringify(layoutOptions));
    } catch {
      showToast('Não foi possível salvar as opções de diagramação.');
    }
    renderPreview();
  });
});

$('#export-btn')?.addEventListener('click', () => {
  document.title = `${titleInput.value.trim() || 'Ebook Studio'} - PDF`;
  window.print();
  setTimeout(() => { document.title = 'Ebook Studio'; }, 1000);
});

const fileInput = $('#file-input');
$('#import-btn')?.addEventListener('click', () => fileInput?.click());
$('#attach-btn')?.addEventListener('click', () => fileInput?.click());
fileInput?.addEventListener('change', async () => {
  const file = fileInput.files?.[0];
  if (!file) return;
  const extension = file.name.split('.').pop().toLowerCase();
  if (!['txt', 'md', 'markdown', 'html', 'htm'].includes(extension)) {
    showToast('Importação disponível para TXT, Markdown e HTML. PDF/DOCX/imagens precisam de conversor.');
    fileInput.value = '';
    return;
  }
  try {
    const text = await file.text();
    let content;
    if (['html', 'htm'].includes(extension)) {
      const parsed = new DOMParser().parseFromString(text, 'text/html');
      content = parsed.body.innerHTML || `<p>${escapeHtml(parsed.body.textContent || '')}</p>`;
    } else {
      content = text.split(/\n\s*\n/).map((paragraph) => `<p>${escapeHtml(paragraph).replace(/\n/g, '<br>')}</p>`).join('');
    }
    createProject(file.name.replace(/\.[^.]+$/, ''), content || defaultContent);
    showToast('Texto importado.');
  } catch {
    showToast('Não foi possível ler esse arquivo.');
  } finally {
    fileInput.value = '';
  }
});

function escapeHtml(value) {
  return value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
}

function addChatMessage(role, text) {
  const chatLog = $('#chat-log');
  if (!chatLog) return;
  const message = document.createElement('div');
  message.className = `chat-message chat-message--${role}`;
  message.setAttribute('role', 'article');
  const label = document.createElement('strong');
  label.textContent = role === 'user' ? 'Você' : 'Agente editorial';
  const body = document.createElement('p');
  body.textContent = text;
  message.append(label, body);
  chatLog.append(message);
  chatLog.classList.add('has-messages');
  chatLog.scrollTop = chatLog.scrollHeight;
  return message;
}

$('#assistant-form')?.addEventListener('submit', async (event) => {
  event.preventDefault();
  const input = $('#assistant-input');
  const submitButton = $('#assistant-run');
  const text = input.value.trim();
  if (!text || submitButton?.disabled) return;

  if (text.length > 120 && /\n|[.!?]/.test(text)) {
    const paragraph = document.createElement('p');
    paragraph.textContent = text;
    editor.append(paragraph);
    input.value = '';
    updateDocument();
    showToast('Texto adicionado à obra.');
    return;
  }

  addChatMessage('user', text);
  input.value = '';
  if (submitButton) submitButton.disabled = true;
  const pending = addChatMessage('assistant', 'Consultando o agente editorial…');
  pending?.classList.add('is-pending');

  try {
    const response = await fetch(window.EbookStudioConfig?.assistantUrl || '/api/assistant', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        message: text,
        title: titleInput.value.trim(),
        content: editor.innerText.slice(0, 30000),
        history: [...($('#chat-log')?.querySelectorAll('.chat-message') || [])]
          .filter((item) => !item.classList.contains('is-pending'))
          .slice(-8)
          .map((item) => ({
            role: item.classList.contains('chat-message--user') ? 'user' : 'assistant',
            content: item.querySelector('p')?.textContent || '',
          })),
      }),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || 'Não foi possível obter uma resposta da IA.');
    pending?.querySelector('p') && (pending.querySelector('p').textContent = result.answer);
    pending?.classList.remove('is-pending');
  } catch (error) {
    pending?.querySelector('p') && (pending.querySelector('p').textContent = error.message || 'Falha ao contatar o agente editorial.');
    pending?.classList.remove('is-pending');
  } finally {
    if (submitButton) submitButton.disabled = false;
    input.focus();
  }
});
$('#assistant-input')?.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    $('#assistant-form')?.requestSubmit();
  }
});
$('#ai-status')?.addEventListener('click', checkAiStatus);
$('#mic-btn')?.addEventListener('click', () => showToast('Comando por voz não está disponível neste navegador.'));

if (!projects.length) {
  projects = [{ id: `${Date.now()}`, title: 'Minha primeira obra', content: defaultContent, updatedAt: Date.now() }];
  activeId = projects[0].id;
  saveProjects();
}
openProject(activeId || projects[0].id);
