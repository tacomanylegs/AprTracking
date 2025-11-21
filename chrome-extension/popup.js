document.addEventListener('DOMContentLoaded', () => {
  loadData();
  document.getElementById('scanBtn').addEventListener('click', manualRefresh);
  document.getElementById('dashboardBtn').addEventListener('click', () => {
    chrome.tabs.create({ url: 'dashboard.html' });
  });

  // 監聽 storage 變化以即時更新 UI
  chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace === 'local') {
      if (changes.scrapeStatus || changes.results) {
        loadData();
      }
    }
  });
});

async function loadData() {
  const status = document.getElementById('status');
  const resultsDiv = document.getElementById('results');
  const btn = document.getElementById('scanBtn');

  // 從 storage 讀取數據
  const data = await chrome.storage.local.get(['results', 'lastUpdated', 'scrapeStatus']);

  // 根據狀態更新 UI
  if (data.scrapeStatus === 'running') {
    btn.disabled = true;
    btn.textContent = '🔄 更新中...';
    status.textContent = '正在後台更新數據...';
  } else {
    btn.disabled = false;
    btn.textContent = '🔄 立即刷新';
    if (data.lastUpdated) {
      const date = new Date(data.lastUpdated);
      status.textContent = `最後更新: ${date.toLocaleTimeString()}`;
    } else {
      status.textContent = '';
    }
  }

  if (data.results && data.results.length > 0) {
    displayResults(data.results);
  } else if (data.scrapeStatus !== 'running') {
    resultsDiv.innerHTML = '<div class="placeholder">尚無數據，請點擊刷新或等待後台更新</div>';
  }
}

async function manualRefresh() {
  const status = document.getElementById('status');

  try {
    // 發送消息給 background script 請求刷新
    // 這裡不需要等待完成，因為我們會監聽 storage 變化
    await chrome.runtime.sendMessage({ action: 'refresh' });

    // 立即更新 UI 狀態 (雖然 storage 監聽也會做，但這樣反應更快)
    const btn = document.getElementById('scanBtn');
    btn.disabled = true;
    btn.textContent = '🔄 更新中...';
    status.textContent = '已發送更新請求...';

  } catch (error) {
    status.textContent = '請求失敗: ' + error.message;
    console.error(error);
  }
}

function displayResults(results) {
  const container = document.getElementById('results');
  container.innerHTML = '';

  // 排序
  results.sort((a, b) => b.apr - a.apr);

  results.forEach((item, index) => {
    const div = document.createElement('div');
    div.className = 'result-item';
    if (index === 0) div.classList.add('champion');

    div.innerHTML = `
      <div class="left-col">
        <span class="result-name">${item.name}</span>
        ${item.url ? `<a href="${item.url}" target="_blank" class="goto-btn" title="前往網頁">🔗</a>` : ''}
      </div>
      <span class="result-value">${item.apr}%</span>
    `;
    container.appendChild(div);
  });
}