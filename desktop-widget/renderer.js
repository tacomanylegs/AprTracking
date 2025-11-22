const { ipcRenderer, shell } = require('electron');
const Chart = require('chart.js/auto');

// State
let chart = null;
let currentHistory = [];

// DOM Elements
const mainView = document.getElementById('main-view');
const historyView = document.getElementById('history-view');
const resultsContainer = document.getElementById('results');
const statusDiv = document.getElementById('status');
const statsGrid = document.getElementById('statsGrid');
const historyTableBody = document.querySelector('#historyTable tbody');

// Buttons
document.getElementById('scanBtn').addEventListener('click', () => {
    ipcRenderer.send('refresh-request');
    statusDiv.textContent = '刷新中...';
});

document.getElementById('dashboardBtn').addEventListener('click', () => {
    showHistoryView();
});

document.getElementById('backBtn').addEventListener('click', () => {
    showMainView();
});

// --- View Switching ---
function showMainView() {
    mainView.style.display = 'flex';
    historyView.style.display = 'none';
}

function showHistoryView() {
    mainView.style.display = 'none';
    historyView.style.display = 'block';
    renderHistoryView();
}

// --- Icon Generation ---
ipcRenderer.on('generate-icon', (event, text) => {
    const canvas = document.getElementById('iconCanvas');
    const ctx = canvas.getContext('2d');

    // Clear
    ctx.clearRect(0, 0, 32, 32);

    // Background - Dark rounded rect
    ctx.fillStyle = '#222';
    ctx.beginPath();
    ctx.roundRect(0, 0, 32, 32, 8);
    ctx.fill();

    // Text - Large, Green, Integer
    ctx.fillStyle = '#00ff00';
    ctx.font = 'bold 20px Arial'; // Larger font
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    ctx.fillText(text, 16, 17); // Centered

    const dataUrl = canvas.toDataURL('image/png');
    ipcRenderer.send('icon-generated', dataUrl);
});

// --- Data Handling ---
ipcRenderer.on('data-updated', (event, history) => {
    currentHistory = history;
    statusDiv.textContent = '最後更新: ' + new Date().toLocaleTimeString();

    renderMainView();
    if (historyView.style.display === 'block') {
        renderHistoryView();
    }
});

// Initial Load
ipcRenderer.invoke('get-history').then(history => {
    currentHistory = history;
    renderMainView();
});

// --- Render Main View ---
function renderMainView() {
    if (!currentHistory || currentHistory.length === 0) {
        resultsContainer.innerHTML = '<div class="placeholder">暫無數據</div>';
        return;
    }

    const latestEntry = currentHistory[currentHistory.length - 1];
    const data = latestEntry.data; // Array of {name, apr, url}

    // Sort by APR desc
    const sortedData = [...data].sort((a, b) => (b.apr || 0) - (a.apr || 0));

    resultsContainer.innerHTML = '';

    sortedData.forEach((item, index) => {
        if (item.apr === null || item.apr === undefined) return;

        const div = document.createElement('div');
        div.className = 'result-item';
        if (index === 0) div.classList.add('champion');

        const linkHtml = item.url ? `<a href="#" class="link-icon" onclick="openExternal('${item.url}'); return false;">🔗</a>` : '';

        div.innerHTML = `
      <div class="left-col">
        <span class="result-name">${item.name}</span>
        ${linkHtml}
      </div>
      <span class="result-value">${item.apr.toFixed(2)}%</span>
    `;
        resultsContainer.appendChild(div);
    });
}

// Expose function to window for onclick
window.openExternal = (url) => {
    shell.openExternal(url);
};

// --- Render History View ---
function renderHistoryView() {
    if (!currentHistory || currentHistory.length === 0) return;

    renderStatsCards();
    renderChart();
    renderTable();
}

function renderStatsCards() {
    const latestEntry = currentHistory[currentHistory.length - 1];
    const data = latestEntry.data.filter(d => d.apr !== null);

    if (data.length === 0) return;

    // Find Max APR
    const maxItem = data.reduce((prev, current) => (prev.apr > current.apr) ? prev : current);

    const url = maxItem.url || '#';
    const clickHandler = `onclick="openExternal('${url}');"`;

    statsGrid.innerHTML = `
    <div class="stat-card" ${clickHandler}>
      <div class="stat-title">當前最高收益率</div>
      <div class="stat-value" style="color: #e91e63;">${maxItem.apr.toFixed(2)}%</div>
      <div class="stat-trend">${maxItem.name}</div>
    </div>
    <div class="stat-card" ${clickHandler}>
      <div class="stat-title">優勢協議</div>
      <div class="stat-value" style="font-size: 18px;">${maxItem.name}</div>
      <div class="stat-trend">最常領先</div>
    </div>
  `;
}

function renderChart() {
    const ctx = document.getElementById('aprChart').getContext('2d');

    // Limit to last 24 hours (approx 288 points at 5min interval)
    // Or just last 50 points for clarity
    const chartData = currentHistory.slice(-50);

    const labels = chartData.map(d => {
        const date = new Date(d.timestamp);
        return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    });

    // Extract datasets
    const protocols = new Set();
    chartData.forEach(entry => {
        if (entry.data) {
            entry.data.forEach(item => protocols.add(item.name));
        }
    });

    const datasets = Array.from(protocols).map((name, index) => {
        // Generate color
        const colors = ['#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#e91e63'];
        const color = colors[index % colors.length];

        return {
            label: name,
            data: chartData.map(entry => {
                const item = entry.data.find(i => i.name === name);
                return item ? item.apr : null;
            }),
            borderColor: color,
            backgroundColor: color,
            tension: 0.4,
            borderWidth: 2,
            pointRadius: 0
        };
    });

    if (chart) chart.destroy();

    chart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: datasets
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: {
                mode: 'index',
                intersect: false,
            },
            scales: {
                y: {
                    beginAtZero: true,
                    grid: { color: 'rgba(0,0,0,0.05)' }
                },
                x: {
                    grid: { display: false }
                }
            },
            plugins: {
                legend: {
                    position: 'top',
                    labels: { usePointStyle: true }
                }
            }
        }
    });
}

// --- Filter Logic ---
const historyFilter = document.createElement('select');
historyFilter.id = 'historyFilter';
historyFilter.innerHTML = '<option value="all">所有協議</option>';
historyFilter.style.cssText = 'padding: 6px 12px; border-radius: 8px; border: 1px solid rgba(0,0,0,0.1); margin-left: auto;';
historyFilter.addEventListener('change', () => {
    renderTable();
});

// Insert filter into header
const sectionHeader = document.querySelector('.history-table-container .section-header');
sectionHeader.appendChild(historyFilter);

function updateFilterOptions() {
    if (!currentHistory || currentHistory.length === 0) return;

    const protocols = new Set();
    currentHistory.forEach(entry => {
        entry.data.forEach(item => {
            if (item.name) protocols.add(item.name);
        });
    });

    const currentVal = historyFilter.value;
    historyFilter.innerHTML = '<option value="all">所有協議</option>';

    Array.from(protocols).sort().forEach(name => {
        const option = document.createElement('option');
        option.value = name;
        option.textContent = name;
        historyFilter.appendChild(option);
    });

    historyFilter.value = currentVal;
}

function renderTable() {
    // Show last 20 entries (filtered)
    const filterValue = historyFilter.value;
    const tableData = [...currentHistory].reverse().slice(0, 50); // Get more to filter

    historyTableBody.innerHTML = '';

    let count = 0;
    for (const entry of tableData) {
        if (count >= 20) break;

        const date = new Date(entry.timestamp).toLocaleString();

        entry.data.forEach(item => {
            if (item.apr === null) return;
            if (filterValue !== 'all' && item.name !== filterValue) return;

            const tr = document.createElement('tr');
            tr.innerHTML = `
        <td>${date}</td>
        <td>${item.name}</td>
        <td class="apr-cell">${item.apr.toFixed(2)}%</td>
      `;
            historyTableBody.appendChild(tr);
        });

        // Only increment count if we actually showed something? 
        // Or is the limit on timestamps? Let's limit on rows shown.
        // Actually, simpler to just show last 20 timestamps' worth of data matching filter.
        count++;
    }
}

// Update filter options when data loads
ipcRenderer.on('data-updated', (event, history) => {
    currentHistory = history;
    statusDiv.textContent = '最後更新: ' + new Date().toLocaleTimeString();
    updateFilterOptions();
    renderMainView();
    if (historyView.style.display === 'block') {
        renderHistoryView();
    }
});

// Initial Load
ipcRenderer.invoke('get-history').then(history => {
    currentHistory = history;
    updateFilterOptions();
    renderMainView();
});

