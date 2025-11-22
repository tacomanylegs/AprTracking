const CONFIG = {
  mmt: {
    url: "https://app.mmt.finance/liquidity/0xb0a595cb58d35e07b711ac145b4846c8ed39772c6d6f6716d89d71c64384543b",
    name: "MMT Finance",
  },
  usdt: {
    url: "https://app.takaralend.com/market/USD%E2%82%AE0",
    name: "TakaraLend USDT",
  },
  usdc: {
    url: "https://app.takaralend.com/market/USDC",
    name: "TakaraLend USDC",
  },
  volos: {
    url: "https://www.volosui.com/vaults",
    name: "Volos UI",
  },
};

// 初始化 Alarm
chrome.runtime.onInstalled.addListener(() => {
  console.log("Extension installed");
  chrome.alarms.create("refreshAPR", { periodInMinutes: 5 });
  performScrape(); // 安裝後立即執行一次
});

chrome.runtime.onStartup.addListener(async () => {
  const data = await chrome.storage.local.get(["history"]);
  if (data.history && data.history.length > 0) {
    // 取得最新一筆歷史紀錄的結果
    const latestEntry = data.history[data.history.length - 1];
    if (latestEntry.records) {
      updateBadge(latestEntry.records);
      return;
    }
  }
  // 若沒有歷史紀錄，則顯示現有的 results
  const resultsData = await chrome.storage.local.get(["results"]);
  if (resultsData.results) {
    updateBadge(resultsData.results);
  }
});

// 監聽 Alarm
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "refreshAPR") {
    performScrape();
  }
});

// 監聽來自 Popup 的手動刷新請求
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "refresh") {
    // 不等待 performScrape 完成，立即回覆
    performScrape();
    sendResponse({ status: "started" });
  }
  return false; // 不需要異步回覆
});

async function performScrape() {
  console.log("Starting background scrape...");

  // 標記狀態為正在運行
  await chrome.storage.local.set({ scrapeStatus: "running" });

  // 尋找一個現有的視窗來開啟背景分頁
  // 這樣可以避免彈出新的視窗嚇到使用者
  let targetWindowId = null;
  try {
    const windows = await chrome.windows.getAll({ windowTypes: ["normal"] });
    if (windows.length > 0) {
      // 優先使用當前聚焦的視窗，如果沒有則使用第一個視窗
      const focused = windows.find((w) => w.focused);
      targetWindowId = focused ? focused.id : windows[0].id;
    }
  } catch (e) {
    console.log("Error finding windows:", e);
  }

  // 如果真的沒有視窗（極少見），才創建一個最小化的視窗
  let createdWindowId = null;
  if (!targetWindowId) {
    try {
      const win = await chrome.windows.create({
        url: "about:blank",
        state: "minimized",
        focused: false,
      });
      createdWindowId = win.id;
      targetWindowId = win.id;
    } catch (e) {
      console.error("Failed to create fallback window:", e);
      await chrome.storage.local.set({ scrapeStatus: "idle" });
      return;
    }
  }

  try {
    const results = [];

    // 依序執行爬蟲
    // 1. MMT
    const mmtApr = await scrapeInTab(targetWindowId, CONFIG.mmt.url, "mmt");
    if (mmtApr)
      results.push({ name: CONFIG.mmt.name, apr: mmtApr, url: CONFIG.mmt.url });

    // 2. TakaraLend USDT
    const usdtApr = await scrapeInTab(
      targetWindowId,
      CONFIG.usdt.url,
      "takaralend"
    );
    if (usdtApr)
      results.push({
        name: CONFIG.usdt.name,
        apr: usdtApr,
        url: CONFIG.usdt.url,
      });

    // 3. TakaraLend USDC
    const usdcApr = await scrapeInTab(
      targetWindowId,
      CONFIG.usdc.url,
      "takaralend"
    );
    if (usdcApr)
      results.push({
        name: CONFIG.usdc.name,
        apr: usdcApr,
        url: CONFIG.usdc.url,
      });

    // 4. Volos
    const volosData = await scrapeInTab(
      targetWindowId,
      CONFIG.volos.url,
      "volos"
    );
    if (volosData) {
      if (volosData.vault_1)
        results.push({
          name: "Volos Vault #1",
          apr: volosData.vault_1,
          url: CONFIG.volos.url,
        });
      if (volosData.vault_2)
        results.push({
          name: "Volos Vault #2",
          apr: volosData.vault_2,
          url: CONFIG.volos.url,
        });
    }

    // 儲存結果並重置狀態
    const timestamp = new Date().getTime();

    // 讀取現有的歷史紀錄
    const storage = await chrome.storage.local.get(["history"]);
    const history = storage.history || [];

    // 新增當前紀錄
    history.push({
      timestamp: timestamp,
      records: results,
    });

    // 限制歷史紀錄數量 (例如保留最近 5000 筆)
    if (history.length > 5000) {
      history.shift();
    }

    const data = {
      results: results,
      lastUpdated: timestamp,
      scrapeStatus: "idle",
      history: history,
    };

    await chrome.storage.local.set(data);
    console.log("Scrape complete, data saved:", data);
    updateBadge(results);
  } catch (error) {
    console.error("Scrape failed:", error);
    await chrome.storage.local.set({ scrapeStatus: "idle" });
  } finally {
    // 如果我們創建了臨時視窗，記得關閉它
    if (createdWindowId) {
      await chrome.windows.remove(createdWindowId);
    }
  }
}

async function scrapeInTab(windowId, url, type) {
  let tabId;
  try {
    // 創建一個 "固定" (pinned) 且 "不活躍" (active: false) 的分頁
    // 這樣它會以一個小圖標的形式出現在分頁列的最左側，不會干擾使用者
    const tab = await chrome.tabs.create({
      windowId: windowId,
      url: url,
      active: false,
      pinned: true,
    });
    tabId = tab.id;

    // 等待頁面加載
    await new Promise((resolve) => {
      chrome.tabs.onUpdated.addListener(function listener(tid, info) {
        if (tid === tabId && info.status === "complete") {
          chrome.tabs.onUpdated.removeListener(listener);
          setTimeout(resolve, 3000); // 給予 SPA 渲染時間
        }
      });
    });

    await chrome.scripting.executeScript({
      target: { tabId: tabId },
      func: () => {
        window.scrollBy(0, window.innerHeight);
      },
    });
    // 等待 1 秒讓頁面完成更新
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // 注入腳本
    const result = await chrome.scripting.executeScript({
      target: { tabId: tabId },
      func: getAprFromPage,
      args: [type],
    });

    return result[0].result;
  } catch (e) {
    console.error(`Error scraping ${url}:`, e);
    return null;
  } finally {
    if (tabId) {
      try {
        await chrome.tabs.remove(tabId);
      } catch (e) {}
    }
  }
}

// 注入到頁面的核心邏輯
function getAprFromPage(type) {
  const pageText = document.body.innerText;

  if (type === "mmt") {
    const match = pageText.match(/Estimated APR:\s*[\n\r\s]*([0-9.]+)%/i);
    return match && match[1] ? parseFloat(match[1]) : null;
  }

  if (type === "takaralend") {
    const patterns = [
      /Supply\s+info[\s\S]*?APR[\s\n]*([0-9.]+)%/i,
      /Total[\s\S]*?Supply[\s\S]*?APR[\s\n]*([0-9.]+)%/i,
      /Supply[\s\S]*?APR[\s\n]*([0-9.]+)%/i,
    ];
    for (const pattern of patterns) {
      const match = pageText.match(pattern);
      if (match && match[1]) return parseFloat(match[1]);
    }
    return null;
  }

  if (type === "volos") {
    const lines = pageText.split("\n");
    const results = {};

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      if (
        line.match(/Stable\s+Vault\s+#1\b/) &&
        !line.includes("#12") &&
        !line.includes("#13")
      ) {
        for (let j = 1; j <= 10 && i + j < lines.length; j++) {
          const percentMatch = lines[i + j].match(/(\d+\.\d+)%/);
          if (percentMatch) {
            results.vault_1 = parseFloat(percentMatch[1]);
            break;
          }
        }
      }

      if (
        line.match(/Stable\s+Vault\s+#2\b/) &&
        !line.includes("#12") &&
        !line.includes("#20")
      ) {
        for (let j = 1; j <= 10 && i + j < lines.length; j++) {
          const percentMatch = lines[i + j].match(/(\d+\.\d+)%/);
          if (percentMatch) {
            results.vault_2 = parseFloat(percentMatch[1]);
            break;
          }
        }
      }
    }
    return results;
  }

  return null;
}

function updateBadge(results) {
  if (!results || results.length === 0) {
    chrome.action.setBadgeText({ text: "" });
    chrome.action.setTitle({ title: "DeFi APR Tracker" });
    return;
  }

  const sorted = [...results].sort((a, b) => b.apr - a.apr);
  const top = sorted[0];

  let badgeText = Math.round(top.apr).toString();
  chrome.action.setBadgeText({ text: badgeText + "%" });
  chrome.action.setBadgeBackgroundColor({ color: "#FFFFFF" });
  chrome.action.setBadgeTextColor({ color: "#000000" });

  chrome.action.setTitle({
    title: `${top.name}\nAPR: ${top.apr}%`,
  });
}
