document.addEventListener('DOMContentLoaded', async () => {
    const data = await chrome.storage.local.get(['history']);
    const history = data.history || [];

    if (history.length === 0) {
        document.querySelector('.chart-container').innerHTML = '<div style="text-align:center; padding: 50px; color: #666;">目前尚無歷史數據</div>';
        return;
    }

    const dashboard = new Dashboard(history);
    dashboard.init();
});

class Dashboard {
    constructor(history) {
        this.fullHistory = history;
        this.filteredHistory = history;
        this.protocols = this.extractProtocols(history);
        this.colors = [
            '#3b82f6', // Blue
            '#10b981', // Green
            '#f59e0b', // Amber
            '#8b5cf6', // Violet
            '#ec4899', // Pink
            '#06b6d4', // Cyan
        ];
        this.protocolColors = {};
        this.protocols.forEach((p, i) => {
            this.protocolColors[p] = this.colors[i % this.colors.length];
        });

        this.canvas = document.getElementById('aprChart');
        this.ctx = this.canvas.getContext('2d');
        this.timeRange = '24h'; // Default
        this.historyFilter = 'all'; // Default filter
        this.hiddenProtocols = new Set(); // Track hidden protocols
    }

    init() {
        this.setupEventListeners();
        this.populateFilter();
        this.filterData();
        this.renderStats();
        this.renderLegend();
        this.renderTable();
        this.drawChart();

        window.addEventListener('resize', () => this.drawChart());
    }

    extractProtocols(history) {
        const set = new Set();
        history.forEach(entry => {
            if (entry.records) {
                entry.records.forEach(r => set.add(r.name));
            }
        });
        return Array.from(set);
    }

    populateFilter() {
        const select = document.getElementById('historyFilter');

        // Get latest APR for each protocol
        const latest = this.fullHistory[this.fullHistory.length - 1];
        const protocolAprs = {};

        if (latest && latest.records) {
            latest.records.forEach(r => {
                protocolAprs[r.name] = r.apr;
            });
        }

        // Sort protocols by latest APR (descending)
        const sortedProtocols = [...this.protocols].sort((a, b) => {
            const aprA = protocolAprs[a] || 0;
            const aprB = protocolAprs[b] || 0;
            return aprB - aprA;
        });

        sortedProtocols.forEach(p => {
            const option = document.createElement('option');
            option.value = p;
            option.textContent = p;
            select.appendChild(option);
        });
    }

    setupEventListeners() {
        document.querySelectorAll('.range-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                document.querySelectorAll('.range-btn').forEach(b => b.classList.remove('active'));
                e.target.classList.add('active');
                this.timeRange = e.target.dataset.range;
                this.filterData();
                this.renderStats();
                this.renderTable();
                this.drawChart();
            });
        });

        document.getElementById('historyFilter').addEventListener('change', (e) => {
            this.historyFilter = e.target.value;
            this.renderTable();
        });

        // Simple tooltip implementation
        this.canvas.addEventListener('mousemove', (e) => this.handleMouseMove(e));
        this.canvas.addEventListener('mouseleave', () => this.drawChart()); // Clear tooltip
    }

    filterData() {
        const now = new Date().getTime();
        let cutoff = 0;

        if (this.timeRange === '1h') {
            cutoff = now - 1 * 60 * 60 * 1000;
        } else if (this.timeRange === '6h') {
            cutoff = now - 6 * 60 * 60 * 1000;
        } else if (this.timeRange === '12h') {
            cutoff = now - 12 * 60 * 60 * 1000;
        } else if (this.timeRange === '24h') {
            cutoff = now - 24 * 60 * 60 * 1000;
        } else if (this.timeRange === '7d') {
            cutoff = now - 7 * 24 * 60 * 60 * 1000;
        } else {
            cutoff = 0;
        }

        this.filteredHistory = this.fullHistory.filter(h => h.timestamp >= cutoff);
    }

    renderStats() {
        const grid = document.getElementById('statsGrid');
        grid.innerHTML = '';

        // Find current max APR
        const latest = this.fullHistory[this.fullHistory.length - 1];
        if (!latest || !latest.records) return;

        // 1. Highest APR Now
        const maxNow = latest.records.reduce((prev, current) => (prev.apr > current.apr) ? prev : current, { apr: 0 });

        // 2. Best Protocol (Most frequently top)
        const topCounts = {};
        this.filteredHistory.forEach(h => {
            if (h.records && h.records.length > 0) {
                const top = h.records.reduce((prev, current) => (prev.apr > current.apr) ? prev : current);
                topCounts[top.name] = (topCounts[top.name] || 0) + 1;
            }
        });
        let bestProtocol = '-';
        let maxCount = 0;
        for (const [name, c] of Object.entries(topCounts)) {
            if (c > maxCount) {
                maxCount = c;
                bestProtocol = name;
            }
        }

        this.createStatCard(grid, '當前最高收益率', `${maxNow.apr}%`, maxNow.name, maxNow.url);
        // Find URL for the best protocol
        const bestRecord = latest.records.find(r => r.name === bestProtocol);
        const bestUrl = bestRecord ? bestRecord.url : null;
        this.createStatCard(grid, '優勢協議', bestProtocol, '最常領先', bestUrl);
    }

    createStatCard(container, title, value, subtext, valueUrl = null, subtextUrl = null) {
        const div = document.createElement('div');
        div.className = 'stat-card';

        // Prepare value content (clickable if URL provided)
        let valueContent = value;
        if (valueUrl) {
            valueContent = `<a href="${valueUrl}" target="_blank" style="text-decoration: none; color: inherit; cursor: pointer;">${value}</a>`;
        }

        // Prepare subtext content (clickable if URL provided)
        let subtextContent = subtext;
        if (subtextUrl) {
            subtextContent = `<a href="${subtextUrl}" target="_blank" style="text-decoration: none; color: inherit; cursor: pointer;">${subtext}</a>`;
        }

        div.innerHTML = `
      <div class="stat-title">${title}</div>
      <div class="stat-value">${valueContent}</div>
      <div class="stat-trend">${subtextContent}</div>
    `;
        container.appendChild(div);
    }

    renderLegend() {
        const legend = document.getElementById('chartLegend');
        legend.innerHTML = '';
        this.protocols.forEach(p => {
            const div = document.createElement('div');
            div.className = 'legend-item';
            if (this.hiddenProtocols.has(p)) {
                div.classList.add('hidden');
            }
            div.innerHTML = `
        <div class="legend-color" style="background: ${this.protocolColors[p]}"></div>
        <span>${p}</span>
      `;
            div.addEventListener('click', () => {
                if (this.hiddenProtocols.has(p)) {
                    this.hiddenProtocols.delete(p);
                    div.classList.remove('hidden');
                } else {
                    this.hiddenProtocols.add(p);
                    div.classList.add('hidden');
                }
                this.drawChart();
            });
            legend.appendChild(div);
        });
    }

    renderTable() {
        const tbody = document.querySelector('#historyTable tbody');
        tbody.innerHTML = '';
        const avgDisplay = document.getElementById('avgAprDisplay');

        // Show last 20 entries reversed
        const displayData = [...this.filteredHistory].reverse().slice(0, 20);

        if (this.historyFilter === 'all') {
            // Hide average APR for "all"
            avgDisplay.style.display = 'none';

            // If all, show all protocols for each timestamp
            displayData.forEach(h => {
                if (!h.records) return;

                const sortedRecords = [...h.records].sort((a, b) => b.apr - a.apr);
                const date = new Date(h.timestamp);
                const timeStr = date.toLocaleTimeString() + ' ' + date.toLocaleDateString();

                sortedRecords.forEach((record, index) => {
                    const tr = document.createElement('tr');
                    const protocolNameHtml = record.url 
                        ? `<a href="${record.url}" target="_blank" class="protocol-link">${record.name}</a>` 
                        : record.name;

                    tr.innerHTML = `
                        <td>${index === 0 ? timeStr : ''}</td>
                        <td>
                          <div class="protocol-cell">
                            <div class="legend-color" style="background: ${this.protocolColors[record.name]}"></div>
                            ${protocolNameHtml}
                          </div>
                        </td>
                        <td class="apr-cell">${record.apr}%</td>
                    `;
                    tbody.appendChild(tr);
                });
            });
        } else {
            // If specific protocol, collect all records and sort by APR
            const records = [];
            displayData.forEach(h => {
                if (!h.records) return;
                const targetRecord = h.records.find(r => r.name === this.historyFilter);
                if (targetRecord) {
                    records.push({
                        timestamp: h.timestamp,
                        record: targetRecord
                    });
                }
            });

            // Calculate and display average APR for this protocol
            let totalApr = 0;
            this.filteredHistory.forEach(h => {
                if (h.records) {
                    const r = h.records.find(rec => rec.name === this.historyFilter);
                    if (r) totalApr += r.apr;
                }
            });
            const avgApr = records.length > 0 ? (totalApr / records.length).toFixed(2) : 0;
            avgDisplay.textContent = `（平均: ${avgApr}%）`;
            avgDisplay.style.display = 'inline';

            // Sort by APR descending
            records.sort((a, b) => b.record.apr - a.record.apr);

            // Render sorted records
            records.forEach(item => {
                const tr = document.createElement('tr');
                const date = new Date(item.timestamp);
                const timeStr = date.toLocaleTimeString() + ' ' + date.toLocaleDateString();

                const protocolNameHtml = item.record.url 
                    ? `<a href="${item.record.url}" target="_blank" class="protocol-link">${item.record.name}</a>` 
                    : item.record.name;

                tr.innerHTML = `
                    <td>${timeStr}</td>
                    <td>
                      <div class="protocol-cell">
                        <div class="legend-color" style="background: ${this.protocolColors[item.record.name]}"></div>
                        ${protocolNameHtml}
                      </div>
                    </td>
                    <td class="apr-cell">${item.record.apr}%</td>
                `;
                tbody.appendChild(tr);
            });
        }
    }

    drawChart(highlightIndex = -1) {
        const container = this.canvas.parentElement;
        const width = container.clientWidth;
        const height = 320;

        // High DPI scaling
        const dpr = window.devicePixelRatio || 1;
        this.canvas.width = width * dpr;
        this.canvas.height = height * dpr;
        this.canvas.style.width = `${width}px`;
        this.canvas.style.height = `${height}px`;

        const ctx = this.ctx;
        ctx.scale(dpr, dpr);

        ctx.clearRect(0, 0, width, height);

        if (this.filteredHistory.length < 2) return;

        const padding = { top: 20, right: 20, bottom: 30, left: 40 };
        const chartWidth = width - padding.left - padding.right;
        const chartHeight = height - padding.top - padding.bottom;

        // Find Min/Max for Y axis
        let maxApr = 0;
        this.filteredHistory.forEach(h => {
            if (h.records) h.records.forEach(r => maxApr = Math.max(maxApr, r.apr));
        });
        maxApr = Math.ceil(maxApr * 1.1); // Add 10% headroom

        // Draw Grid & Axis
        ctx.strokeStyle = 'rgba(0, 0, 0, 0.05)';
        ctx.lineWidth = 1;
        ctx.beginPath();

        // Horizontal lines
        for (let i = 0; i <= 5; i++) {
            const y = padding.top + (chartHeight * i / 5);
            ctx.moveTo(padding.left, y);
            ctx.lineTo(width - padding.right, y);

            // Y Labels
            ctx.fillStyle = '#64748b';
            ctx.font = '10px Inter';
            ctx.textAlign = 'right';
            const labelVal = Math.round(maxApr * (1 - i / 5));
            ctx.fillText(labelVal + '%', padding.left - 8, y + 3);
        }
        ctx.stroke();

        // Draw Lines
        this.protocols.forEach(protocol => {
            // Skip if protocol is hidden
            if (this.hiddenProtocols.has(protocol)) return;

            const points = [];
            this.filteredHistory.forEach((h, i) => {
                const record = h.records ? h.records.find(r => r.name === protocol) : null;
                if (record) {
                    const x = padding.left + (i / (this.filteredHistory.length - 1)) * chartWidth;
                    const y = padding.top + chartHeight - (record.apr / maxApr) * chartHeight;
                    points.push({ x, y });
                }
            });

            if (points.length > 0) {
                ctx.strokeStyle = this.protocolColors[protocol];
                ctx.lineWidth = 2;
                ctx.beginPath();
                ctx.moveTo(points[0].x, points[0].y);
                for (let i = 1; i < points.length; i++) {
                    // Smooth curve (simple bezier or straight lines) - using straight for performance/simplicity
                    ctx.lineTo(points[i].x, points[i].y);
                }
                ctx.stroke();
            }
        });

        // Draw Highlight Line if hovering
        if (highlightIndex !== -1 && highlightIndex < this.filteredHistory.length) {
            const x = padding.left + (highlightIndex / (this.filteredHistory.length - 1)) * chartWidth;

            ctx.strokeStyle = 'rgba(0, 0, 0, 0.2)';
            ctx.lineWidth = 1;
            ctx.setLineDash([5, 5]);
            ctx.beginPath();
            ctx.moveTo(x, padding.top);
            ctx.lineTo(x, height - padding.bottom);
            ctx.stroke();
            ctx.setLineDash([]);

            // Draw Tooltip
            this.drawTooltip(ctx, x, highlightIndex);
        }
    }

    handleMouseMove(e) {
        const rect = this.canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const padding = { left: 40, right: 20 };
        
        // 使用邏輯像素寬度，而非物理像素寬度
        const container = this.canvas.parentElement;
        const logicalWidth = container.clientWidth;
        const chartWidth = logicalWidth - padding.left - padding.right;

        if (x < padding.left || x > logicalWidth - padding.right) return;

        const ratio = (x - padding.left) / chartWidth;
        const index = Math.round(ratio * (this.filteredHistory.length - 1));

        this.drawChart(index);
    }

    drawTooltip(ctx, x, index) {
        const data = this.filteredHistory[index];
        if (!data || !data.records) return;

        const date = new Date(data.timestamp);
        const title = date.toLocaleTimeString();

        // Sort records by APR
        const sorted = [...data.records].sort((a, b) => b.apr - a.apr);

        const boxWidth = 160;
        const boxHeight = 30 + (sorted.length * 20);
        let boxX = x + 10;
        let boxY = 20;

        if (boxX + boxWidth > this.canvas.width) {
            boxX = x - boxWidth - 10;
        }

        // Background
        ctx.fillStyle = 'rgba(255, 255, 255, 0.95)';
        ctx.strokeStyle = 'rgba(0, 0, 0, 0.1)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.roundRect(boxX, boxY, boxWidth, boxHeight, 8);
        ctx.fill();
        ctx.stroke();

        // Title
        ctx.fillStyle = '#64748b';
        ctx.font = '12px Inter';
        ctx.textAlign = 'left';
        ctx.fillText(title, boxX + 10, boxY + 20);

        // Items
        sorted.forEach((item, i) => {
            const y = boxY + 40 + (i * 20);

            // Color dot
            ctx.fillStyle = this.protocolColors[item.name];
            ctx.beginPath();
            ctx.arc(boxX + 15, y - 4, 3, 0, Math.PI * 2);
            ctx.fill();

            // Name
            ctx.fillStyle = '#1e293b';
            ctx.fillText(item.name, boxX + 25, y);

            // Value
            ctx.textAlign = 'right';
            ctx.fillText(item.apr.toFixed(2) + '%', boxX + boxWidth - 10, y);
            ctx.textAlign = 'left';
        });
    }
}
