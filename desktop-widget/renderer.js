const { ipcRenderer, shell } = require('electron');
const Chart = require('chart.js/auto');

// State
let chart = null;
let currentHistory = [];
let chartTimeRange = '1d'; // Default to 1 day

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
    ipcRenderer.send('restore-window');
    showMainView();
});

// Listen for window restoration (from user action or back button)
ipcRenderer.on('window-restored', () => {
    showMainView();
});

// Listen for window maximization
ipcRenderer.on('window-maximized', () => {
    switchToHistoryUI();
});

// --- View Switching ---
function showMainView() {
    mainView.style.display = 'flex';
    historyView.style.display = 'none';
}

function showHistoryView() {
    switchToHistoryUI();
    ipcRenderer.send('maximize-window');
}

function switchToHistoryUI() {
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
    setupChartTimeFilter();
    renderChart();
    renderTable();
}

function renderStatsCards() {
    const latestEntry = currentHistory[currentHistory.length - 1];
    const data = latestEntry.data.filter(d => d.apr !== null);

    if (data.length === 0) return;

    // Find Max APR
    const maxItem = data.reduce((prev, current) => (prev.apr > current.apr) ? prev : current);

    // Calculate Average APR for this protocol
    let totalApr = 0;
    let count = 0;
    currentHistory.forEach(entry => {
        const item = entry.data.find(d => d.name === maxItem.name);
        if (item && item.apr != null) {
            const val = Number(item.apr);
            if (!isNaN(val)) {
                totalApr += val;
                count++;
            }
        }
    });
    const avgApr = count > 0 ? (totalApr / count).toFixed(2) : 'N/A';

    const url = maxItem.url || '#';
    const clickHandler = `onclick="openExternal('${url}');"`;

    statsGrid.innerHTML = `
    <div class="stat-card" ${clickHandler}>
      <div class="stat-title">當前最高收益率</div>
      <div class="stat-value" style="color: #e91e63;">${maxItem.apr.toFixed(2)}%</div>
      <div class="stat-trend">
        ${maxItem.name}
        <span style="font-size: 12px; color: #3b82f6; display: block; margin-top: 2px;">平均: ${avgApr}%</span>
      </div>
    </div>
    <div class="stat-card" ${clickHandler}>
      <div class="stat-title">優勢協議</div>
      <div class="stat-value" style="font-size: 18px;">${maxItem.name}</div>
      <div class="stat-trend">最常領先</div>
    </div>
  `;
}

function setupChartTimeFilter() {
    const chartContainer = document.getElementById('aprChart').parentElement;
    let filterContainer = chartContainer.querySelector('.chart-time-filter');

    if (!filterContainer) {
        filterContainer = document.createElement('div');
        filterContainer.className = 'chart-time-filter';
        filterContainer.style.cssText = 'position: absolute; top: 10px; right: 10px; z-index: 10; display: flex; gap: 8px;';
        chartContainer.style.position = 'relative';
        chartContainer.appendChild(filterContainer);
    }

    filterContainer.innerHTML = `
        <button class="time-tab" data-value="12h" style="padding: 6px 12px; border-radius: 6px; border: 1px solid rgba(0,0,0,0.1); background: white; color: #333; cursor: pointer; font-size: 13px; transition: all 0.2s;">12小時</button>
        <button class="time-tab" data-value="1d" style="padding: 6px 12px; border-radius: 6px; border: 1px solid rgba(0,0,0,0.1); background: white; color: #333; cursor: pointer; font-size: 13px; transition: all 0.2s;">1日</button>
        <button class="time-tab" data-value="1m" style="padding: 6px 12px; border-radius: 6px; border: 1px solid rgba(0,0,0,0.1); background: white; color: #333; cursor: pointer; font-size: 13px; transition: all 0.2s;">1月</button>
    `;

    const buttons = filterContainer.querySelectorAll('.time-tab');
    buttons.forEach(btn => {
        if (btn.dataset.value === chartTimeRange) {
            btn.style.background = '#3b82f6';
            btn.style.color = 'white';
            btn.style.borderColor = '#3b82f6';
        }

        btn.addEventListener('click', () => {
            chartTimeRange = btn.dataset.value;

            // Update button styles
            buttons.forEach(b => {
                b.style.background = 'white';
                b.style.color = '#333';
                b.style.borderColor = 'rgba(0,0,0,0.1)';
            });
            btn.style.background = '#3b82f6';
            btn.style.color = 'white';
            btn.style.borderColor = '#3b82f6';

            renderChart();
        });
    });
}

function renderChart() {
    const ctx = document.getElementById('aprChart').getContext('2d');

    // Filter data based on selected time range
    const now = new Date().getTime();
    let timeRangeMs = 24 * 60 * 60 * 1000; // Default to 1 day

    if (chartTimeRange === '12h') {
        timeRangeMs = 12 * 60 * 60 * 1000;
    } else if (chartTimeRange === '1m') {
        timeRangeMs = 30 * 24 * 60 * 60 * 1000; // 1 month (30 days)
    }

    const cutoffTime = now - timeRangeMs;
    const chartData = currentHistory.filter(entry => new Date(entry.timestamp).getTime() >= cutoffTime);

    const labels = chartData.map(d => {
        const date = new Date(d.timestamp);
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        const hours = String(date.getHours()).padStart(2, '0');
        const minutes = String(date.getMinutes()).padStart(2, '0');
        return `${month}-${day} ${hours}:${minutes}`;
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
            pointRadius: 0,
            pointHoverRadius: 4,
            spanGaps: true
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
                    grid: { color: 'rgba(0,0,0,0.05)' },
                    ticks: {
                        font: {
                            family: "'Segoe UI', sans-serif",
                            size: 12
                        }
                    }
                },
                x: {
                    grid: { display: false },
                    reverse: true,
                    ticks: {
                        maxRotation: 0,
                        autoSkip: false,
                        font: {
                            family: "'Segoe UI', sans-serif",
                            size: 12
                        },
                        callback: function (value, index, ticks) {
                            const total = this.chart.data.labels.length;

                            // Always show the last label (Leftmost in reverse mode)
                            if (value === total - 1) {
                                return this.getLabelForValue(value);
                            }

                            // Hide the first label (Rightmost)
                            if (value === 0) return '';

                            // Calculate step to show roughly 6 labels
                            // Anchor from the newest (leftmost) side
                            const step = Math.ceil(total / 6);
                            const distanceFromNewest = (total - 1) - value;

                            if (distanceFromNewest % step === 0) {
                                return this.getLabelForValue(value);
                            }

                            return '';
                        }
                    }
                }
            },
            plugins: {
                legend: {
                    position: 'top',
                    labels: {
                        usePointStyle: true,
                        pointStyle: 'circle',
                        boxWidth: 6,
                        boxHeight: 6,
                        padding: 12,
                        font: {
                            family: "'Segoe UI', sans-serif",
                            size: 14,
                            weight: 500
                        }
                    }
                },
                tooltip: {
                    padding: 16,
                    titleMarginBottom: 12,
                    bodySpacing: 10,
                    itemSort: function (a, b) {
                        // Sort by value descending (highest APR first)
                        const valA = a.raw !== null ? a.raw : -Infinity;
                        const valB = b.raw !== null ? b.raw : -Infinity;
                        return valB - valA;
                    },
                    callbacks: {
                        label: function (context) {
                            const value = context.raw !== null ? context.raw.toFixed(2) + '%' : 'N/A';
                            return context.dataset.label + ': ' + value;
                        }
                    }
                }
            }
        }
    });
}

// --- Filter Logic ---
const historyFilter = document.createElement('select');
historyFilter.id = 'historyFilter';
// No default 'all' option
historyFilter.style.cssText = 'padding: 6px 12px; border-radius: 8px; border: 1px solid rgba(0,0,0,0.1); margin-left: auto;';
historyFilter.addEventListener('change', () => {
    renderTable();
});

const avgAprDisplay = document.createElement('div');
avgAprDisplay.style.cssText = 'margin-left: 15px; padding: 4px 12px; background: #e3f2fd; color: #1976d2; border-radius: 20px; font-size: 13px; font-weight: 600; cursor: pointer; display: none; align-items: center; transition: background 0.2s;';
avgAprDisplay.onmouseover = () => avgAprDisplay.style.background = '#bbdefb';
avgAprDisplay.onmouseout = () => avgAprDisplay.style.background = '#e3f2fd';

// Insert filter into header
const sectionHeader = document.querySelector('.history-table-container .section-header');
sectionHeader.appendChild(avgAprDisplay);
sectionHeader.appendChild(historyFilter);

function updateFilterOptions() {
    if (!currentHistory || currentHistory.length === 0) return;

    // Get all protocols
    const protocols = new Set();
    currentHistory.forEach(entry => {
        entry.data.forEach(item => {
            if (item.name) protocols.add(item.name);
        });
    });

    // Get latest APRs for sorting
    const latestEntry = currentHistory[currentHistory.length - 1];
    const latestAprs = {};
    if (latestEntry && latestEntry.data) {
        latestEntry.data.forEach(item => {
            latestAprs[item.name] = item.apr !== null ? item.apr : -1;
        });
    }

    const currentVal = historyFilter.value;
    historyFilter.innerHTML = '';

    // Sort by APR desc
    const sortedProtocols = Array.from(protocols).sort((a, b) => {
        const aprA = latestAprs[a] !== undefined ? latestAprs[a] : -1;
        const aprB = latestAprs[b] !== undefined ? latestAprs[b] : -1;
        return aprB - aprA;
    });

    sortedProtocols.forEach(name => {
        const option = document.createElement('option');
        option.value = name;
        option.textContent = name;
        historyFilter.appendChild(option);
    });

    // Default to first (highest APR) if current is 'all' or invalid
    if (currentVal === 'all' || !protocols.has(currentVal)) {
        if (sortedProtocols.length > 0) {
            historyFilter.value = sortedProtocols[0];
        }
    } else {
        historyFilter.value = currentVal;
    }
}

function renderTable() {
    // Show last 100 entries (filtered)
    const filterValue = historyFilter.value;

    // If no filter value (e.g. no data yet), do nothing
    if (!filterValue || filterValue === 'all') {
        avgAprDisplay.style.display = 'none';
        return;
    }

    // Calculate Average APR
    let totalApr = 0;
    let aprCount = 0;
    let protocolUrl = '';

    currentHistory.forEach(entry => {
        entry.data.forEach(item => {
            // Check name match and ensure apr is valid
            if (item.name === filterValue && item.apr != null) {
                const val = Number(item.apr);
                if (!isNaN(val)) {
                    totalApr += val;
                    aprCount++;
                    if (item.url) protocolUrl = item.url;
                }
            }
        });
    });

    if (aprCount > 0) {
        avgAprDisplay.innerHTML = `平均收益: ${(totalApr / aprCount).toFixed(2)}% <span style="font-size: 10px; margin-left: 4px;">↗</span>`;
        avgAprDisplay.style.display = 'inline-flex';
        avgAprDisplay.onclick = () => {
            if (protocolUrl) window.openExternal(protocolUrl);
        };
        avgAprDisplay.title = `前往 ${filterValue}`;
    } else {
        avgAprDisplay.style.display = 'none';
    }

    const tableData = [...currentHistory].reverse().slice(0, 200); // Get more to filter

    historyTableBody.innerHTML = '';

    let count = 0;
    for (const entry of tableData) {
        if (count >= 100) break;

        const date = new Date(entry.timestamp).toLocaleString();

        entry.data.forEach(item => {
            if (item.apr === null) return;
            if (item.name !== filterValue) return;

            const tr = document.createElement('tr');
            tr.innerHTML = `
        <td>${date}</td>
        <td>${item.name}</td>
        <td class="apr-cell">${item.apr.toFixed(2)}%</td>
      `;
            historyTableBody.appendChild(tr);
        });

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

