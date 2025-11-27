/**
 * MMT Finance Monitor - Desktop Widget 版本
 * 直接引用根目錄的 monitor，確保邏輯統一
 */

const path = require('path');
const rootMonitor = require(path.join(__dirname, '../../monitors/mmt-monitor.js'));

// 直接導出根目錄 monitor 的所有功能
module.exports = rootMonitor;
