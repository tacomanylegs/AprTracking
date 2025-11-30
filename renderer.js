const { ipcRenderer, shell } = require('electron');
const Chart = require('chart.js/auto');

// URL Mapping - 硬編碼的協議 URL
const PROTOCOL_URLS = {
  'Takara USDT': 'https://app.takaralend.com/market/USD%E2%82%AE0',
  'Takara USDC': 'https://app.takaralend.com/market/USDC',

  'MMT 0.01%': 'https://app.mmt.finance/liquidity/0xb0a595cb58d35e07b711ac145b4846c8ed39772c6d6f6716d89d71c64384543b',
  'MMT 0.001%': 'https://app.mmt.finance/liquidity/0x737ec6a4d3ed0c7e6cc18d8ba04e7ffd4806b726c97efd89867597368c4d06a9',
  'Volos V1': 'https://www.volosui.com/vaults',
  'Volos V2': 'https://www.volosui.com/vaults'
};

// State
let chart = null;
let currentHistory = [];
let chartTimeRange = '1d'; // Default to 1 day
let currentPriceRange = { min: 0.9, max: 1.1 }; // MMT price range
let isAlertState = false; // Price alert state

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

document.getElementById('headerSection').addEventListener('click', () => {
    const sheetsUrl = 'https://docs.google.com/spreadsheets/d/1PKXeI9fq_zzv-zlUzWj_5a9z-PXl-_xd23Svg0MVSz0/edit?gid=0#gid=0';
    shell.openExternal(sheetsUrl);
});

document.getElementById('backBtn').addEventListener('click', () => {
    ipcRenderer.send('restore-window');
    showMainView();
});

// Buy price save button
document.getElementById('saveBuyPriceBtn').addEventListener('click', async () => {
    const minInput = document.getElementById('minPriceInput');
    const maxInput = document.getElementById('maxPriceInput');
    
    const min = parseFloat(minInput.value);
    const max = parseFloat(maxInput.value);
    
    if (!isNaN(min) && !isNaN(max) && min < max) {
        const success = await ipcRenderer.invoke('set-buy-price', { min, max });
        if (success) {
            currentPriceRange = { min, max };
            isAlertState = false; // Reset alert state
            renderMainView(); // Re-render to update colors
            alert('價格區間已儲存!');
        } else {
            alert('儲存失敗');
        }
    } else {
        alert('請輸入有效的價格區間 (Min < Max)');
    }
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
ipcRenderer.on('generate-icon', (event, data) => {
    const canvas = document.getElementById('iconCanvas');
    const ctx = canvas.getContext('2d');
    
    // Handle both old format (string) and new format (object)
    const text = typeof data === 'object' ? data.text : data;
    const isAlert = typeof data === 'object' ? data.isAlert : false;

    // Clear
    ctx.clearRect(0, 0, 32, 32);

    // Background - Dark rounded rect (red if alert)
    ctx.fillStyle = isAlert ? '#c62828' : '#222';
    ctx.beginPath();
    ctx.roundRect(0, 0, 32, 32, 8);
    ctx.fill();

    // Text - Large, colored based on alert state
    ctx.fillStyle = isAlert ? '#ffcdd2' : '#00ff00';
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
    updateStatusWithLink();

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
    const data = latestEntry.data; // Array of {name, apr, url, usdcPrice}

    // Sort by APR desc - valid APRs first, then by value
    const sortedData = [...data].sort((a, b) => {
        const aApr = a.apr !== null && a.apr !== undefined ? a.apr : -Infinity;
        const bApr = b.apr !== null && b.apr !== undefined ? b.apr : -Infinity;
        return bApr - aApr;
    });

    resultsContainer.innerHTML = '';

    let championIndex = 0;
    sortedData.forEach((item, index) => {
        const div = document.createElement('div');
        div.className = 'result-item';
        if (item.apr !== null && item.apr !== undefined && championIndex === 0) {
            div.classList.add('champion');
            championIndex++;
        }

        const url = PROTOCOL_URLS[item.name];
        const linkHtml = url ? `<a href="#" class="link-icon" onclick="openExternal('${url}'); return false;">🔗</a>` : '';

        // Check for MMT USDC price and alert state (Logic moved to updateMMTPriceDisplay)
        if (item.name === 'MMT 0.01%' && item.usdcPrice !== null && item.usdcPrice !== undefined) {
            const isPriceAlert = item.usdcPrice < currentPriceRange.min || item.usdcPrice > currentPriceRange.max;
            if (isPriceAlert) {
                div.classList.add('price-alert');
                isAlertState = true;
            }
        }

        const aprDisplay = (item.apr !== null && item.apr !== undefined) ? `${item.apr.toFixed(2)}%` : '<span style="color: #666; font-size: 14px;">Loading...</span>';

        div.innerHTML = `
            <div class="left-col">
                <div>
                    <span class="result-name">${item.name}</span>
                    ${linkHtml}
                </div>
            </div>
            <span class="result-value">${aprDisplay}</span>
        `;
        resultsContainer.appendChild(div);
    });

    // Update the separate MMT Price Display
    const mmtItem = data.find(d => d.name === 'MMT 0.01%');
    updateMMTPriceDisplay(mmtItem);
}

function updateMMTPriceDisplay(item) {
    const display = document.getElementById('mmtPriceDisplay');
    if (item && item.usdcPrice !== null && item.usdcPrice !== undefined) {
        const isPriceAlert = item.usdcPrice < currentPriceRange.min || item.usdcPrice > currentPriceRange.max;
        const color = isPriceAlert ? '#f44336' : '#2196F3'; // Red if alert, Blue if normal
        
        display.style.display = 'block';
        display.innerHTML = `
            當前價格: <span style="font-family: 'Roboto Mono', monospace; font-weight: bold; color: ${color}; font-size: 16px;">
                ${item.usdcPrice.toFixed(8)} USDC
            </span>
        `;
    } else {
        display.style.display = 'none';
    }
}

// Expose function to window for onclick
window.openExternal = (url) => {
    shell.openExternal(url);
};

// --- Rebalance Status Management ---
let rebalanceStateByPool = {}; // { poolId: { enabled, lastResult, lastCheckTime, isProcessing } }
let rebalanceGlobalEnabled = false; // Global toggle for auto-rebalance

const rebalanceToggleBtn = document.getElementById('rebalanceToggle');
const manualRebalanceBtn = document.getElementById('manualRebalanceBtn');
const viewHistoryBtn = document.getElementById('viewHistoryBtn');
const rebalanceStatusDiv = document.querySelector('.rebalance-status');
const rebalanceStatusText = document.getElementById('rebalanceStatusText');
const rebalanceLastCheckDiv = document.getElementById('rebalanceLastCheck');
const rebalanceLastCheckTime = document.getElementById('rebalanceLastCheckTime');
const rebalanceResultsContainer = document.getElementById('rebalanceResultsContainer');
const rebalanceResultsList = document.getElementById('rebalanceResultsList');
const rebalanceHistoryModal = document.getElementById('rebalanceHistoryModal');
const rebalanceHistoryList = document.getElementById('rebalanceHistoryList');
const closeHistoryModal = document.getElementById('closeHistoryModal');
const closeHistoryBtn = document.getElementById('closeHistoryBtn');

// Store all rebalance results for scrolling history
let rebalanceResults = [];
let lastDisplayedDigests = new Set(); // Track last displayed digests to avoid duplicates

// Toggle rebalance on/off (global)
rebalanceToggleBtn.addEventListener('click', async () => {
    const newState = !rebalanceGlobalEnabled;
    const result = await ipcRenderer.invoke('set-rebalance-enabled', newState);
    rebalanceGlobalEnabled = result;
    updateRebalanceUI();
});

// Manual rebalance trigger
manualRebalanceBtn.addEventListener('click', async () => {
    if (Object.values(rebalanceStateByPool).some(s => s.isProcessing)) {
        alert('換倉正在進行中，請稍候...');
        return;
    }
    
    manualRebalanceBtn.disabled = true;
    
    // Mark all pools as processing
    for (const poolId in rebalanceStateByPool) {
        rebalanceStateByPool[poolId].isProcessing = true;
    }
    updateRebalanceUI();
    
    try {
        const result = await ipcRenderer.invoke('trigger-rebalance');
        if (result.resultsByPool) {
            // Update each pool's state with results
            for (const poolId in result.resultsByPool) {
                if (!rebalanceStateByPool[poolId]) {
                    rebalanceStateByPool[poolId] = {
                        enabled: true,
                        lastResult: null,
                        lastCheckTime: null,
                        isProcessing: false
                    };
                }
                rebalanceStateByPool[poolId].lastResult = result.resultsByPool[poolId];
                rebalanceStateByPool[poolId].lastCheckTime = new Date();
                rebalanceStateByPool[poolId].isProcessing = false;
            }
        }
        updateRebalanceUI();
    } catch (error) {
        console.error('❌ Manual rebalance failed:', error);
        for (const poolId in rebalanceStateByPool) {
            rebalanceStateByPool[poolId].lastResult = {
                success: false,
                error: error.message,
                poolId: poolId
            };
            rebalanceStateByPool[poolId].isProcessing = false;
        }
        updateRebalanceUI();
    } finally {
        manualRebalanceBtn.disabled = false;
        updateRebalanceUI();
    }
});

// View history button
viewHistoryBtn.addEventListener('click', () => {
    displayRebalanceHistory();
    rebalanceHistoryModal.style.display = 'flex';
});

// Close modal buttons
closeHistoryModal.addEventListener('click', () => {
    rebalanceHistoryModal.style.display = 'none';
});

closeHistoryBtn.addEventListener('click', () => {
    rebalanceHistoryModal.style.display = 'none';
});

// Close modal when clicking outside
rebalanceHistoryModal.addEventListener('click', (e) => {
    if (e.target === rebalanceHistoryModal) {
        rebalanceHistoryModal.style.display = 'none';
    }
});

function displayRebalanceHistory() {
    if (rebalanceResults.length === 0) {
        rebalanceHistoryList.innerHTML = '<div style="text-align: center; color: #64748b; padding: 20px;">暫無換倉紀錄</div>';
        return;
    }
    
    rebalanceHistoryList.innerHTML = rebalanceResults.map((result, index) => `
        <div class="history-item ${result.resultClass}">
            <div class="history-item-pool">${result.poolName || 'Unknown'}</div>
            <a href="#" onclick="window.openExternal('${result.txUrl}'); return false;" class="history-item-link">${result.digest}</a>
            <span class="history-item-time">${result.timeStr}</span>
        </div>
    `).join('');
}

// Listen for rebalance status changes from main process
ipcRenderer.on('rebalance-status-changed', (event, status) => {
    rebalanceGlobalEnabled = status.enabled;
    updateRebalanceUI();
});

// Listen for rebalance started
ipcRenderer.on('rebalance-started', () => {
    for (const poolId in rebalanceStateByPool) {
        rebalanceStateByPool[poolId].isProcessing = true;
    }
    updateRebalanceUI();
});

// Listen for rebalance completed
ipcRenderer.on('rebalance-completed', (event, result) => {
    if (result.resultsByPool) {
        // Update each pool's state with results
        for (const poolId in result.resultsByPool) {
            if (!rebalanceStateByPool[poolId]) {
                rebalanceStateByPool[poolId] = {
                    enabled: true,
                    lastResult: null,
                    lastCheckTime: null,
                    isProcessing: false
                };
            }
            rebalanceStateByPool[poolId].lastResult = result.resultsByPool[poolId];
            rebalanceStateByPool[poolId].lastCheckTime = new Date();
            rebalanceStateByPool[poolId].isProcessing = false;
        }
    }
    updateRebalanceUI();
});

function updateRebalanceUI() {
    // Update toggle button state
    if (rebalanceGlobalEnabled) {
        rebalanceToggleBtn.textContent = '✓ 已啟用';
        rebalanceToggleBtn.classList.remove('disabled');
    } else {
        rebalanceToggleBtn.textContent = '✗ 已禁用';
        rebalanceToggleBtn.classList.add('disabled');
    }
    
    // Check if any pool is processing
    const anyProcessing = Object.values(rebalanceStateByPool).some(s => s.isProcessing);
    
    // Update status display (show aggregate status of all pools)
    rebalanceStatusDiv.classList.remove('active', 'error', 'processing');
    
    if (anyProcessing) {
        rebalanceStatusDiv.classList.add('processing');
        rebalanceStatusText.textContent = '⏳ 進行中...';
    } else {
        // Calculate aggregate status
        const results = Object.values(rebalanceStateByPool)
            .filter(s => s.lastResult)
            .map(s => s.lastResult);
        
        if (results.length === 0) {
            rebalanceStatusText.textContent = rebalanceGlobalEnabled ? '✓ 已啟用' : '✗ 已禁用';
        } else {
            const allSuccess = results.every(r => r.success);
            const anyExecuted = results.some(r => r.rebalanceExecuted);
            
            if (allSuccess) {
                rebalanceStatusDiv.classList.add('active');
                if (anyExecuted) {
                    rebalanceStatusText.textContent = `✅ 換倉成功 (${results.length} 個 Pool)`;
                } else {
                    rebalanceStatusText.textContent = `✓ 無需換倉 (${results.length} 個 Pool)`;
                }
            } else {
                rebalanceStatusDiv.classList.add('error');
                const failedCount = results.filter(r => !r.success).length;
                rebalanceStatusText.textContent = `❌ ${failedCount}/${results.length} 失敗`;
            }
        }
    }
    
    // Update last check time (latest among all pools)
    const latestCheckTime = Object.values(rebalanceStateByPool)
        .filter(s => s.lastCheckTime)
        .map(s => new Date(s.lastCheckTime).getTime())
        .sort((a, b) => b - a)[0];
    
    if (latestCheckTime) {
        rebalanceLastCheckDiv.style.display = 'flex';
        const timeStr = new Date(latestCheckTime).toLocaleTimeString();
        rebalanceLastCheckTime.textContent = timeStr;
    } else {
        rebalanceLastCheckDiv.style.display = 'none';
    }
    
    // Render all pool results
    if (Object.values(rebalanceStateByPool).some(s => s.lastResult)) {
        let resultsHTML = '';
        
        Object.entries(rebalanceStateByPool).forEach(([poolId, state]) => {
            if (!state.lastResult) return;
            
            const result = state.lastResult;
            const resultClass = result.success ? 'success' : 'error';
            
            let poolLabel = result.poolName || 'Unknown Pool';
            let statusText = '✓ 無需換倉';
            let txHtml = '';
            
            if (result.rebalanceExecuted && result.digest) {
                statusText = '✅ 換倉成功';
                const digestShort = result.digest.substring(0, 12);
                const txUrl = `https://suiscan.xyz/mainnet/tx/${result.digest}`;
                txHtml = `<a href="#" onclick="window.openExternal('${txUrl}'); return false;" class="rebalance-result-tx">${digestShort}</a>`;
                
                // Add to history if new
                if (!lastDisplayedDigests.has(result.digest)) {
                    const timeStr = result.timestamp 
                        ? new Date(result.timestamp).toLocaleTimeString('zh-TW')
                        : '未知';
                    rebalanceResults.unshift({
                        digest: digestShort,
                        poolName: poolLabel,
                        txUrl: txUrl,
                        timeStr: timeStr,
                        resultClass: resultClass
                    });
                    lastDisplayedDigests.add(result.digest);
                    
                    if (rebalanceResults.length > 20) {
                        rebalanceResults.pop();
                    }
                }
            } else if (result.error) {
                statusText = `❌ 失敗: ${result.error}`;
            }
            
            resultsHTML += `
                <div class="rebalance-result-item ${resultClass}">
                    <div class="rebalance-pool-label">${poolLabel}</div>
                    <div class="rebalance-result-status">${statusText}</div>
                    ${txHtml ? `<div>${txHtml}</div>` : ''}
                </div>
            `;
        });
        
        rebalanceResultsList.innerHTML = resultsHTML;
        rebalanceResultsContainer.style.display = 'block';
    } else {
        rebalanceResultsContainer.style.display = 'none';
    }
}

// Load initial rebalance status
ipcRenderer.invoke('get-rebalance-status').then(status => {
    rebalanceGlobalEnabled = status.enabled;
    
    // Initialize per-pool states
    if (status.lastResultsByPool) {
        for (const poolId in status.lastResultsByPool) {
            rebalanceStateByPool[poolId] = {
                enabled: true,
                lastResult: status.lastResultsByPool[poolId],
                lastCheckTime: status.lastResultsByPool[poolId].timestamp 
                    ? new Date(status.lastResultsByPool[poolId].timestamp)
                    : null,
                isProcessing: false
            };
        }
    }
    
    updateRebalanceUI();
});

// Function to update status with hyperlink
function updateStatusWithLink() {
    const time = new Date().toLocaleTimeString();
    const url = 'https://docs.google.com/spreadsheets/d/1PKXeI9fq_zzv-zlUzWj_5a9z-PXl-_xd23Svg0MVSz0/edit?gid=0#gid=0';
    statusDiv.innerHTML = `最後更新: <a href="#" style="color: inherit; text-decoration: none; cursor: pointer;" onclick="openExternal('${url}'); return false;">${time}</a>`;
}

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

    const url = PROTOCOL_URLS[maxItem.name] || '#';
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

    currentHistory.forEach(entry => {
        entry.data.forEach(item => {
            // Check name match and ensure apr is valid
            if (item.name === filterValue && item.apr != null) {
                const val = Number(item.apr);
                if (!isNaN(val)) {
                    totalApr += val;
                    aprCount++;
                }
            }
        });
    });

    if (aprCount > 0) {
        const protocolUrl = PROTOCOL_URLS[filterValue];
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
    updateStatusWithLink();
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
    
    // Update status with last entry time
    if (history && history.length > 0) {
        const lastEntry = history[history.length - 1];
        const lastTime = new Date(lastEntry.timestamp);
        const url = 'https://docs.google.com/spreadsheets/d/1PKXeI9fq_zzv-zlUzWj_5a9z-PXl-_xd23Svg0MVSz0/edit?gid=0#gid=0';
        statusDiv.innerHTML = `最後更新: <a href="#" style="color: inherit; text-decoration: none; cursor: pointer;" onclick="openExternal('${url}'); return false;">${lastTime.toLocaleTimeString()}</a>`;
    }
});

// Load buy price on startup (from main process - sent immediately on window load)
ipcRenderer.on('initial-buy-price', (event, range) => {
    console.log(`📥 Received initial buy price range from main:`, range);
    currentPriceRange = range;
    document.getElementById('minPriceInput').value = range.min;
    document.getElementById('maxPriceInput').value = range.max;
    renderMainView(); // Re-render with correct buy price
});

// Fallback: Load buy price via invoke if not received via event
ipcRenderer.invoke('get-buy-price').then(range => {
    // Only if not already set (check if default)
    if (currentPriceRange.min === 0.9 && currentPriceRange.max === 1.1) { 
        currentPriceRange = range;
        document.getElementById('minPriceInput').value = range.min;
        document.getElementById('maxPriceInput').value = range.max;
        renderMainView(); // Re-render with correct buy price
    }
});

// Get alert state on startup
ipcRenderer.invoke('get-alert-state').then(state => {
    isAlertState = state.isAlert;
    if (state.priceRange) {
        currentPriceRange = state.priceRange;
        document.getElementById('minPriceInput').value = state.priceRange.min;
        document.getElementById('maxPriceInput').value = state.priceRange.max;
    }
});

