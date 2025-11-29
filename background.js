console.log('Background script loaded');

function initializeStorage() {
  return new Promise((resolve, reject) => {
    if (chrome.storage && chrome.storage.sync) {
      chrome.storage.sync.get({
        preserveLinks: true,
        preserveImages: false,
        includeSource: true
      }, (items) => {
        if (chrome.runtime.lastError) {
          console.error('Storage error:', chrome.runtime.lastError);
          reject(chrome.runtime.lastError);
        } else {
          console.log('Storage initialized:', items);
          resolve(items);
        }
      });
    } else {
      const error = 'chrome.storage.sync is not available';
      console.error(error);
      reject(new Error(error));
    }
  });
}

chrome.runtime.onInstalled.addListener(async () => {
  console.log('Extension installed');
  try {
    await initializeStorage();
  } catch (error) {
    console.error('Failed to initialize storage:', error);
  }
});

chrome.commands.onCommand.addListener((command) => {
  console.log('Command received:', command);
  
  if (command === 'copy-as-markdown') {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]) {
        const tab = tabs[0];
        console.log('Sending message to tab:', tab.id);
        
        chrome.tabs.sendMessage(tab.id, { action: 'ping' }, (response) => {
          if (chrome.runtime.lastError || !response) {
            console.log('Content script not ready, injecting...');
            chrome.scripting.executeScript({
              target: { tabId: tab.id },
              files: ['content.js']
            }).then(() => {
              console.log('Content script injected');
              setTimeout(() => {
                sendCopyMessage(tab.id);
              }, 100);
            }).catch(err => {
              console.error('Failed to inject content script:', err);
            });
          } else {
            console.log('Content script is ready');
            sendCopyMessage(tab.id);
          }
        });
      }
    });
  }
});

function sendCopyMessage(tabId) {
  chrome.storage.sync.get({
    preserveLinks: true,
    preserveImages: false,
    includeSource: true
  }, (settings) => {
    chrome.tabs.sendMessage(tabId, {
      action: 'copyAsMarkdown',
      options: settings
    }, (response) => {
      if (chrome.runtime.lastError) {
        console.error('Message error:', chrome.runtime.lastError);
      } else {
        console.log('Message sent successfully');
      }
    });
  });
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('Message received in background:', message);
  
  if (message.action === 'copySuccess') {
    console.log('Copy successful');
    chrome.notifications?.create({
      type: 'basic',
      iconUrl: 'icons/icon-48.png',
      title: '复制为 Markdown',
      message: '已成功复制到剪贴板！'
    });
  } else if (message.action === 'copyError') {
    console.error('Copy failed:', message.error);
  }
  
  sendResponse({ received: true });
});