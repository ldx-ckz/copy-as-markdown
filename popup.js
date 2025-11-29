document.addEventListener('DOMContentLoaded', function() {
  const copyButton = document.getElementById('copyButton');
  const statusDiv = document.getElementById('status');
  const preserveLinks = document.getElementById('preserveLinks');
  const preserveImages = document.getElementById('preserveImages');
  const includeSource = document.getElementById('includeSource');

  // 安全地加载保存的设置
  function loadSettings() {
    if (chrome.storage && chrome.storage.sync) {
      chrome.storage.sync.get({
        preserveLinks: true,
        preserveImages: false,
        includeSource: true
      }, function(settings) {
        preserveLinks.checked = settings.preserveLinks;
        preserveImages.checked = settings.preserveImages;
        includeSource.checked = settings.includeSource;
      });
    } else {
      // 如果 storage 不可用，使用默认值
      preserveLinks.checked = true;
      preserveImages.checked = false;
      includeSource.checked = true;
    }
  }

  // 安全地保存设置
  function saveSettings() {
    if (chrome.storage && chrome.storage.sync) {
      chrome.storage.sync.set({
        preserveLinks: preserveLinks.checked,
        preserveImages: preserveImages.checked,
        includeSource: includeSource.checked
      });
    }
  }

  loadSettings();

  // 保存设置
  [preserveLinks, preserveImages, includeSource].forEach(checkbox => {
    checkbox.addEventListener('change', saveSettings);
  });

  // 监听来自 content script 的复制结果
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'copySuccess') {
      showStatus('✅ 已成功复制到剪贴板！', 'success');
    } else if (message.action === 'copyError') {
      showStatus(`❌ ${message.error}`, 'error');
    }
  });

  copyButton.addEventListener('click', async function() {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      
      showStatus('🔄 处理中...', 'success');
      
      const options = {
        preserveLinks: preserveLinks.checked,
        preserveImages: preserveImages.checked,
        includeSource: includeSource.checked
      };

      // 发送消息到 content script
      const response = await chrome.tabs.sendMessage(tab.id, {
        action: 'copyAsMarkdown',
        options: options
      });

      if (!response) {
        showStatus('❌ 无法与页面通信，请刷新页面重试', 'error');
      }
      
    } catch (error) {
      console.error('Popup error:', error);
      showStatus('❌ 请先在页面上选中一些文本', 'error');
    }
  });

  function showStatus(message, type) {
    statusDiv.textContent = message;
    statusDiv.className = `status ${type}`;
    statusDiv.style.display = 'block';
    
    if (type !== 'success' || !message.includes('处理中')) {
      setTimeout(() => {
        statusDiv.style.display = 'none';
      }, 3000);
    }
  }
});